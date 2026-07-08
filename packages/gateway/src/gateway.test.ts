import { describe, expect, it } from "vitest";
import {
  GMODE_HEADERS,
  verifyGatewayContext,
  type CloudflareRateLimitBinding,
  type FetcherLike,
} from "@gmode/core";
import { createGateway } from "./create-gateway";
import { requestId } from "./middleware/request-id";
import { jsonErrors } from "./middleware/json-errors";
import { cloudflareRateLimit } from "./middleware/cloudflare-rate-limit";
import { cors } from "./middleware/cors";
import { idempotency } from "./middleware/idempotency";

const SIGNING = "internal-signing-secret";

type FetcherCall = {
  request: Request;
  init: RequestInit<RequestInitCfProperties> | undefined;
};

function mockFetcher(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fetchCalls: FetcherCall[] = [];
  const fetcher: FetcherLike & {
    calls: Request[];
    fetchCalls: FetcherCall[];
  } = {
    calls,
    fetchCalls,
    async fetch(input, init) {
      const req = input instanceof Request ? input : new Request(input);
      calls.push(req);
      fetchCalls.push({ request: req, init });
      return handler(req);
    },
  };
  return fetcher;
}

function mockRateLimit(allow = true) {
  const calls: { key: string }[] = [];
  const binding: CloudflareRateLimitBinding & {
    calls: { key: string }[];
    setAllow(v: boolean): void;
  } = {
    calls,
    async limit(input) {
      calls.push(input);
      return { success: allow };
    },
    setAllow(v) {
      allow = v;
    },
  };
  return binding;
}

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

type MockKv = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
  entries: Map<string, string>;
};

function mockKv(): MockKv {
  const entries = new Map<string, string>();
  return {
    entries,
    async get(key) {
      return entries.get(key) ?? null;
    },
    async put(key, value) {
      entries.set(key, value);
    },
  };
}

type Env = {
  USERS_API: FetcherLike;
  RL: CloudflareRateLimitBinding;
  IDEMPOTENCY?: MockKv;
  INTERNAL_SIGNING_SECRET: string;
};

describe("gateway", () => {
  it("forwards to mocked service and rewrites path", async () => {
    const users = mockFetcher(
      (req) =>
        new Response(JSON.stringify({ path: new URL(req.url).pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
    });

    const env: Env = {
      USERS_API: users,
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/users/123"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe("/123");
    expect(users.calls).toHaveLength(1);
  });

  it("passes inherited gateway cache policy to downstream services", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
      cache: {
        enabled: true,
        default: {
          cacheControl: "public, max-age=60, stale-while-revalidate=300",
        },
      },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
    });

    const res = await gateway.fetch(
      new Request("https://api.test/users/123"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    expect(users.fetchCalls).toHaveLength(1);
    expect(users.fetchCalls[0]!.init?.cf?.cacheControl).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  it("lets a service override inherited cache policy and cache key", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
      cache: {
        enabled: true,
        default: {
          cacheControl: "public, max-age=30",
        },
      },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
      cache: {
        cacheControl: "public, max-age=300",
        cacheKey: (ctx) => `users:${ctx.url.pathname}`,
      },
    });

    await gateway.fetch(
      new Request("https://api.test/users/123"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(users.fetchCalls[0]!.init?.cf?.cacheControl).toBe(
      "public, max-age=300",
    );
    expect(users.fetchCalls[0]!.init?.cf?.cacheKey).toBe("users:/users/123");
  });

  it("lets services opt out of gateway cache inheritance", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
      cache: {
        enabled: true,
        default: {
          cacheControl: "public, max-age=60",
        },
      },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
      cache: false,
    });

    await gateway.fetch(
      new Request("https://api.test/users/123"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(users.fetchCalls[0]!.init).toBeUndefined();
  });

  it("fails when a service requests cache inheritance without a gateway default", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
      cache: { enabled: true },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
      cache: true,
    });

    const res = await gateway.fetch(
      new Request("https://api.test/users/123"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(500);
    expect(users.fetchCalls).toHaveLength(0);
  });

  it("does not pass downstream cache policy for non-GET requests", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
      cache: {
        enabled: true,
        default: {
          cacheControl: "public, max-age=60",
        },
      },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
    });

    await gateway.fetch(
      new Request("https://api.test/users", {
        method: "POST",
        body: JSON.stringify({ name: "A" }),
      }),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(users.fetchCalls[0]!.init).toBeUndefined();
  });

  it("strips client-supplied x-gmode-* headers and signs context", async () => {
    let captured: Request | null = null;
    const users = mockFetcher((req) => {
      captured = req;
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    });

    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
    });

    const env: Env = {
      USERS_API: users,
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };

    await gateway.fetch(
      new Request("https://api.test/users/x", {
        headers: {
          "x-gmode-context": "tampered",
          "x-gmode-user-id": "evil",
        },
      }),
      env,
      execCtx(),
    );

    const req = captured as unknown as Request;
    expect(req.headers.get("x-gmode-context")).not.toBe("tampered");
    expect(req.headers.get("x-gmode-user-id")).toBeNull();

    const token = req.headers.get(GMODE_HEADERS.gatewayContext)!;
    const verified = await verifyGatewayContext(token, SIGNING, {
      audience: "users",
    });
    expect(verified.iss).toBe("gmode-gateway");
  });

  it("serves an HTML landing page at /", async () => {
    const gateway = createGateway<Env>({
      name: "Cool API",
      version: "2.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    gateway.service("billing", { mount: "/billing", binding: "USERS_API" });

    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("Cool API");
    expect(html).toContain("v2.0.0");
    expect(html).toContain("/openapi.json");
    expect(html).toContain("/docs");
    expect(html).toContain("/users");
    expect(html).toContain("/billing");
  });

  it("links Scalar from the landing page when configured", async () => {
    const gateway = createGateway<Env>({
      name: "Cool API",
      version: "2.0.0",
      docs: { scalar: "/reference", ui: "scalar" },
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/reference");
    expect(html).toContain("Modern API reference · default");
  });

  it("returns 204 on /favicon.ico", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/favicon.ico"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(204);
  });

  it("disables the landing page when docs.index is null", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      docs: { index: null },
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(404);
  });

  it("landing page surfaces feature-flag info when middleware is mounted", async () => {
    const { createMockFlagship } = await import("@gmode/testing");
    const { featureFlags } = await import("./middleware/feature-flags");
    const flagsBinding = createMockFlagship({
      booleans: { "new-checkout": true, "billing-enabled": false },
    });

    type FlagsEnv = Env & { FLAGS: typeof flagsBinding };
    const gateway = createGateway<FlagsEnv>({
      name: "Cool API",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(async (ctx, next) => {
      ctx.auth = {
        authenticated: true,
        user: { id: "u1" },
        scopes: ["users:read"],
        permissions: [],
      };
      return next();
    });
    gateway.use(
      featureFlags<FlagsEnv, "FLAGS">({
        binding: "FLAGS",
        gates: { "/billing": "billing-enabled" },
        forward: ["new-checkout"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const env: FlagsEnv = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      FLAGS: flagsBinding,
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Feature flags/);
    expect(html).toContain("FLAGS");
    expect(html).toContain("Evaluation context");
    expect(html).toContain("userId");
    expect(html).toContain("Service-mount gates");
    expect(html).toContain("/billing");
    expect(html).toContain("Forwarded flags");
    expect(html).toContain("new-checkout");
  });

  it("landing page surfaces MCP info when an mcp middleware writes the state key", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    // Stand-in for `mountMcp` — same state-key contract.
    gateway.use(async (ctx, next) => {
      ctx.state.set("gmode.mcp", {
        path: "/mcp",
        mode: "catalog",
        serverInfo: { name: "MyAPI MCP", version: "1.0.0" },
      });
      return next();
    });

    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    const html = await res.text();
    expect(html).toMatch(/<h2>MCP/);
    expect(html).toContain("MyAPI MCP");
    expect(html).toContain("/mcp");
    expect(html).toContain("streamable-http");
    expect(html).toContain("discover");
    // Connect-from-Claude card with JSON config snippet (HTML-escaped)
    expect(html).toContain("Connect from Claude Desktop");
    expect(html).toContain("&quot;mcpServers&quot;");
    expect(html).toContain("&quot;streamable-http&quot;");
    // Quick-test card with curl snippets — full origin appears
    expect(html).toContain("Quick test from your terminal");
    expect(html).toContain("https://api.test/mcp");
    expect(html).toContain("initialize");
    expect(html).toContain("tools/list");
    expect(html).toContain("tools/call");
  });

  it("landing page omits the flag section when featureFlags is not mounted", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    const html = await res.text();
    expect(html).not.toMatch(/Feature flags/);
  });

  it("a root-mounted service wins over the landing page", async () => {
    const root = mockFetcher(
      () => new Response(JSON.stringify({ at: "root" }), { status: 200 }),
    );
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.service("root", { mount: "/", binding: "USERS_API" });
    const env: Env = {
      USERS_API: root,
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
    expect(root.calls).toHaveLength(1);
  });

  it("returns 404 when no service matches", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("x")),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/nope"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns x-request-id response header", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      } as Env,
      execCtx(),
    );
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("cloudflareRateLimit returns 429 when binding denies", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const rl = mockRateLimit(false);
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(cloudflareRateLimit({ binding: "RL", key: () => "k1" }));
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        RL: rl,
        INTERNAL_SIGNING_SECRET: SIGNING,
      } as Env,
      execCtx(),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(rl.calls).toEqual([{ key: "k1" }]);
  });

  it("cloudflareRateLimit forwards through when binding allows", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const rl = mockRateLimit(true);
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(cloudflareRateLimit({ binding: "RL", key: () => "k1" }));
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        RL: rl,
        INTERNAL_SIGNING_SECRET: SIGNING,
      } as Env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-rate-limit-policy")).toBe("cloudflare-native");
  });

  it("CORS preflight returns 204", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(cors());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1", {
        method: "OPTIONS",
        headers: { origin: "https://foo" },
      }),
      {
        USERS_API: mockFetcher(() => new Response("{}")),
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      } as Env,
      execCtx(),
    );
    expect(res.status).toBe(204);
  });

  it("rejects anonymous request when service requires auth", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      auth: true,
    });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      } as Env,
      execCtx(),
    );
    expect(res.status).toBe(401);
    expect(users.calls).toHaveLength(0);
  });

  it("preserves request body when forwarding", async () => {
    let captured: string | null = null;
    const users = mockFetcher(async (req) => {
      captured = await req.text();
      return new Response("{}");
    });
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    await gateway.fetch(
      new Request("https://api.test/users/1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      } as Env,
      execCtx(),
    );
    expect(captured).toBe(JSON.stringify({ hello: "world" }));
  });
});

describe("memoryRateLimit", () => {
  it("returns 429 when exceeded", async () => {
    const { memoryRateLimit, __resetMemoryRateLimit } = await import(
      "./middleware/memory-rate-limit"
    );
    __resetMemoryRateLimit();
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      memoryRateLimit<Env>({
        limit: 2,
        windowSeconds: 60,
        key: () => "k",
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const env = {
      USERS_API: users,
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    } as Env;
    const r1 = await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    const r2 = await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    const r3 = await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
  });
});

describe("idempotency", () => {
  it("requires an idempotency key for configured unsafe requests", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.use(
      idempotency<Env, "IDEMPOTENCY">({
        binding: "IDEMPOTENCY",
        ttlSeconds: 60,
        paths: ["/users"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users", { method: "POST" }),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        IDEMPOTENCY: mockKv(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(400);
    expect(users.calls).toHaveLength(0);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
    });
  });

  it("stores and replays the original response for duplicate requests", async () => {
    let count = 0;
    const users = mockFetcher(() =>
      Response.json({ count: ++count }, {
        status: 201,
        headers: { "x-created-by": "service" },
      }),
    );
    const kv = mockKv();
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.use(
      idempotency<Env, "IDEMPOTENCY">({
        binding: "IDEMPOTENCY",
        ttlSeconds: 60,
        paths: ["/users"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const env: Env = {
      USERS_API: users,
      RL: mockRateLimit(),
      IDEMPOTENCY: kv,
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "create-user-1",
      },
      body: JSON.stringify({ email: "a@example.test" }),
    };

    const first = await gateway.fetch(
      new Request("https://api.test/users", init),
      env,
      execCtx(),
    );
    const second = await gateway.fetch(
      new Request("https://api.test/users", init),
      env,
      execCtx(),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(first.json()).resolves.toEqual({ count: 1 });
    await expect(second.json()).resolves.toEqual({ count: 1 });
    expect(second.headers.get("x-created-by")).toBe("service");
    expect(second.headers.get("x-idempotency-replayed")).toBe("true");
    expect(users.calls).toHaveLength(1);
    expect(kv.entries.size).toBe(1);
  });

  it("rejects idempotency key reuse with a different fingerprint", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.use(
      idempotency<Env, "IDEMPOTENCY">({
        binding: "IDEMPOTENCY",
        ttlSeconds: 60,
        paths: ["/users"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const env: Env = {
      USERS_API: users,
      RL: mockRateLimit(),
      IDEMPOTENCY: mockKv(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "create-user-2",
    };

    await gateway.fetch(
      new Request("https://api.test/users", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "a@example.test" }),
      }),
      env,
      execCtx(),
    );
    const conflict = await gateway.fetch(
      new Request("https://api.test/users", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "b@example.test" }),
      }),
      env,
      execCtx(),
    );

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_CONFLICT" },
    });
    expect(users.calls).toHaveLength(1);
  });

  it("does not apply to paths outside the configured prefixes", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.use(
      idempotency<Env, "IDEMPOTENCY">({
        binding: "IDEMPOTENCY",
        ttlSeconds: 60,
        paths: ["/billing"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users", { method: "POST" }),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        IDEMPOTENCY: mockKv(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    expect(users.calls).toHaveLength(1);
  });

  it("does not cache 5xx responses by default", async () => {
    const users = mockFetcher(() => new Response("failed", { status: 500 }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(jsonErrors());
    gateway.use(
      idempotency<Env, "IDEMPOTENCY">({
        binding: "IDEMPOTENCY",
        ttlSeconds: 60,
        paths: ["/users"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const env: Env = {
      USERS_API: users,
      RL: mockRateLimit(),
      IDEMPOTENCY: mockKv(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const init: RequestInit = {
      method: "POST",
      headers: { "idempotency-key": "retry-after-500" },
    };

    const first = await gateway.fetch(
      new Request("https://api.test/users", init),
      env,
      execCtx(),
    );
    const second = await gateway.fetch(
      new Request("https://api.test/users", init),
      env,
      execCtx(),
    );

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(second.headers.get("x-idempotency-replayed")).toBeNull();
    expect(users.calls).toHaveLength(2);
  });

  it("mounts services through apiVersion helpers", async () => {
    const users = mockFetcher(
      (req) =>
        new Response(JSON.stringify({ path: new URL(req.url).pathname }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway
      .apiVersion({ name: "v2", prefix: "/v2" })
      .service("users-v2", {
        mount: "/users",
        binding: "USERS_API",
        audience: "users",
      });

    const res = await gateway.fetch(
      new Request("https://api.test/v2/users/123"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe("/123");
  });

  it("adds deprecation headers for deprecated api versions", async () => {
    const users = mockFetcher(() => Response.json({ ok: true }));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway
      .apiVersion({
        name: "v1",
        prefix: "/v1",
        deprecated: {
          sunset: "Wed, 31 Dec 2025 23:59:59 GMT",
          link: "https://docs.example.test/deprecations/v1",
          message: "Use v2.",
        },
      })
      .service("users-v1", {
        mount: "/users",
        binding: "USERS_API",
        audience: "users",
      });

    const res = await gateway.fetch(
      new Request("https://api.test/v1/users"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).toBe("true");
    expect(res.headers.get("sunset")).toBe("Wed, 31 Dec 2025 23:59:59 GMT");
    expect(res.headers.get("link")).toBe(
      '<https://docs.example.test/deprecations/v1>; rel="deprecation"',
    );
    expect(res.headers.get("x-gmode-api-version")).toBe("v1");
    expect(res.headers.get("x-gmode-deprecation-message")).toBe("Use v2.");
  });

  it("marks deprecated api versions in aggregated OpenAPI", async () => {
    const users = mockFetcher((req) => {
      if (new URL(req.url).pathname !== "/__gmode/openapi.json") {
        return Response.json({ ok: true });
      }
      return Response.json({
        openapi: "3.1.0",
        info: { title: "Users", version: "1.0.0" },
        paths: {
          "/{id}": {
            get: {
              operationId: "getUser",
              responses: { 200: { description: "OK" } },
            },
          },
        },
      });
    });
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway
      .apiVersion({
        name: "v1",
        prefix: "/v1",
        deprecated: {
          sunset: "Wed, 31 Dec 2025 23:59:59 GMT",
          link: "https://docs.example.test/deprecations/v1",
        },
      })
      .service("users-v1", {
        mount: "/users",
        binding: "USERS_API",
        openapi: true,
      });

    const res = await gateway.fetch(
      new Request("https://api.test/openapi.json"),
      {
        USERS_API: users,
        RL: mockRateLimit(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      paths: {
        "/v1/users/{id}": {
          get: {
            deprecated: boolean;
            "x-gmode-api-version": string;
            "x-gmode-sunset": string;
            "x-gmode-deprecation-link": string;
          };
        };
      };
    };
    expect(spec.paths["/v1/users/{id}"].get.deprecated).toBe(true);
    expect(spec.paths["/v1/users/{id}"].get["x-gmode-api-version"]).toBe(
      "v1",
    );
    expect(spec.paths["/v1/users/{id}"].get["x-gmode-sunset"]).toBe(
      "Wed, 31 Dec 2025 23:59:59 GMT",
    );
    expect(
      spec.paths["/v1/users/{id}"].get["x-gmode-deprecation-link"],
    ).toBe("https://docs.example.test/deprecations/v1");
  });
});

describe("requestLogger", () => {
  it("emits structured JSON", async () => {
    const { requestLogger } = await import("./middleware/logger");
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(requestLogger());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const logs: string[] = [];
    const original = console.log;
    console.log = (msg: unknown) => {
      logs.push(String(msg));
    };
    try {
      await gateway.fetch(
        new Request("https://api.test/users/1"),
        {
          USERS_API: users,
          RL: mockRateLimit(),
          INTERNAL_SIGNING_SECRET: SIGNING,
        } as Env,
        execCtx(),
      );
    } finally {
      console.log = original;
    }
    const parsed = logs
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((x): x is Record<string, unknown> => !!x);
    expect(parsed.some((p) => p["type"] === "gmode.request")).toBe(true);
  });
});
