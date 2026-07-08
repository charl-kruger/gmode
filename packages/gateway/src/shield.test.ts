import { describe, expect, it } from "vitest";
import {
  base64urlEncodeString,
  hmacSign,
  type FetcherLike,
} from "@gmode/core";
import { z, createService } from "@gmode/service";
import { createGateway } from "./create-gateway";
import { jsonErrors } from "./middleware/json-errors";
import { requestId } from "./middleware/request-id";
import { jwtAuth } from "./middleware/auth";
import { mtls } from "./middleware/mtls";
import { sessionHeader } from "./middleware/session-header";

const SIGNING = "internal-signing-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function mockFetcher(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fetcher: FetcherLike & { calls: Request[] } = {
    calls,
    async fetch(req) {
      calls.push(req);
      return handler(req);
    },
  };
  return fetcher;
}

function bindService<E>(
  svc: {
    fetch(req: Request, env: E, ctx: ExecutionContext): Promise<Response>;
  },
  env: E,
): FetcherLike {
  return {
    fetch: (req) => svc.fetch(req, env, execCtx()),
  };
}

function reqWithCert(
  url: string,
  cert: Record<string, string> | undefined,
  init?: RequestInit,
): Request {
  const req = new Request(url, init);
  if (cert) {
    Object.defineProperty(req, "cf", {
      value: { tlsClientAuth: cert },
      configurable: true,
    });
  }
  return req;
}

type Env = {
  USERS_API: FetcherLike;
  INTERNAL_SIGNING_SECRET: string;
  JWT_SECRET: string;
};

describe("mtls middleware", () => {
  it("rejects requests without a client cert when required", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(mtls<Env>());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      reqWithCert("https://api.test/users/1", undefined),
      {
        USERS_API: mockFetcher(() => new Response("{}")),
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MTLS_REQUIRED");
  });

  it("rejects requests with an invalid cert", async () => {
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(mtls<Env>());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      reqWithCert("https://api.test/users/1", {
        certVerified: "FAILED:self signed certificate",
        certPresented: "1",
      }),
      {
        USERS_API: mockFetcher(() => new Response("{}")),
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MTLS_INVALID");
  });

  it("forwards when cert is verified", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(mtls<Env>());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      reqWithCert("https://api.test/users/1", {
        certVerified: "SUCCESS",
        certPresented: "1",
        certFingerprintSHA256: "abc123",
        certSubjectDN: "CN=client-1",
      }),
      {
        USERS_API: users,
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(users.calls).toHaveLength(1);
  });
});

describe("sessionHeader middleware", () => {
  it("emits cf-session-id derived from user/tenant", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(async (ctx, next) => {
      ctx.auth = {
        authenticated: true,
        user: { id: "u1" },
        tenant: { id: "t1" },
        scopes: [],
        permissions: [],
      };
      return next();
    });
    gateway.use(sessionHeader<Env>());
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );
    expect(res.headers.get("cf-session-id")).toBe("t1:u1");
  });

  it("hashes the key when a secret is provided", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(async (ctx, next) => {
      ctx.auth = {
        authenticated: true,
        user: { id: "u1" },
        scopes: [],
        permissions: [],
      };
      return next();
    });
    gateway.use(
      sessionHeader<Env>({ secret: (e) => e.INTERNAL_SIGNING_SECRET }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );
    const sid = res.headers.get("cf-session-id");
    expect(sid).not.toBe("u1");
    expect(sid).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("jwtAuth assumeShieldVerified", () => {
  it("accepts a JWT that fails signature check when assumeShieldVerified=true", async () => {
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      jwtAuth<Env>({
        secret: () => "this-is-not-the-real-secret",
        assumeShieldVerified: true,
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const header = base64urlEncodeString(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    );
    const payload = base64urlEncodeString(
      JSON.stringify({ sub: "u1", scope: "users:read" }),
    );
    const sig = await hmacSign("a-different-secret", `${header}.${payload}`);
    const token = `${header}.${payload}.${sig}`;

    const res = await gateway.fetch(
      new Request("https://api.test/users/1", {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        USERS_API: users,
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );
    expect(res.status).toBe(200);
  });

  it("still maps claims into auth context when shield-verified", async () => {
    let observedAuthenticated = false;
    let observedUserId: string | undefined;
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: () => SIGNING },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      jwtAuth<Env>({
        secret: () => "ignored",
        assumeShieldVerified: true,
      }),
    );
    gateway.use(async (ctx, next) => {
      observedAuthenticated = ctx.auth.authenticated;
      observedUserId = ctx.auth.user?.id;
      return next();
    });
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const header = base64urlEncodeString(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    );
    const payload = base64urlEncodeString(
      JSON.stringify({ sub: "u_xyz", scope: "users:read" }),
    );
    const token = `${header}.${payload}.signature-does-not-matter`;

    await gateway.fetch(
      new Request("https://api.test/users/1", {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        USERS_API: users,
        INTERNAL_SIGNING_SECRET: SIGNING,
        JWT_SECRET: "x",
      },
      execCtx(),
    );

    expect(observedAuthenticated).toBe(true);
    expect(observedUserId).toBe("u_xyz");
  });
});

describe("/openapi.json?profile=shield", () => {
  it("returns a 3.0.3 spec with the warning count header", async () => {
    type SvcEnv = { INTERNAL_SIGNING_SECRET: string };
    const svc = createService<SvcEnv>({
      name: "Users API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    });
    svc.get("/:id", {
      operationId: "getUser",
      summary: "Get user",
      params: z.object({ id: z.union([z.string(), z.number()]) }),
      responses: { 200: z.object({ id: z.string() }) },
      handler: async ({ params }) => ({
        id: String((params as { id: string | number }).id),
      }),
    });

    const gateway = createGateway<{
      USERS_API: FetcherLike;
      INTERNAL_SIGNING_SECRET: string;
    }>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      openapi: true,
    });

    const env = {
      USERS_API: bindService(svc, { INTERNAL_SIGNING_SECRET: SIGNING }),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };

    const res = await gateway.fetch(
      new Request("https://api.test/openapi.json?profile=shield"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gmode-shield-warnings")).toBeTruthy();
    const spec = (await res.json()) as { openapi: string };
    expect(spec.openapi).toBe("3.0.3");
  });
});
