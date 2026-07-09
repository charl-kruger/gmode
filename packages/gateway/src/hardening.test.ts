import { describe, expect, it } from "vitest";
import {
  GMODE_HEADERS,
  verifyGatewayContext,
  type FetcherLike,
} from "@gmode/core";
import { createGateway } from "./create-gateway";
import { requestId } from "./middleware/request-id";
import { jsonErrors } from "./middleware/json-errors";

function mockFetcher(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fetcher: FetcherLike & { calls: Request[] } = {
    calls,
    async fetch(input) {
      const req = input instanceof Request ? input : new Request(input);
      calls.push(req);
      return handler(req);
    },
  };
  return fetcher;
}

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function serviceSpec(operationId: string) {
  return {
    openapi: "3.1.0",
    info: { title: "svc", version: "1.0.0" },
    paths: {
      "/things": {
        get: { operationId, responses: { "200": { description: "ok" } } },
      },
    },
  };
}

function specFetcher(operationId: string) {
  return mockFetcher((req) => {
    const url = new URL(req.url);
    if (url.pathname === "/__gmode/openapi.json") {
      return new Response(JSON.stringify(serviceSpec(operationId)), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/__gmode/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("ok");
  });
}

type Env = {
  USERS_API: FetcherLike;
  BILLING_API?: FetcherLike;
  GMODE_CONTEXT_SECRET?: string;
};

describe("signed gateway context forwarding", () => {
  it("sends a signed token when GMODE_CONTEXT_SECRET is set", async () => {
    const users = mockFetcher(() => new Response("ok"));
    const gateway = createGateway<Env>({ name: "T", version: "1.0.0" });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
    });

    const res = await gateway.fetch(
      new Request("https://api.example.com/users/1"),
      { USERS_API: users, GMODE_CONTEXT_SECRET: "s3cret" },
      execCtx(),
    );
    expect(res.status).toBe(200);

    const forwarded = users.calls[0]!;
    const token = forwarded.headers.get(GMODE_HEADERS.gatewayContext)!;
    expect(token).toContain(".");
    const verified = await verifyGatewayContext(token, {
      audience: "users",
      secret: "s3cret",
    });
    expect(verified.iss).toBe("gmode-gateway");
  });

  it("sends an unsigned token when no secret is configured", async () => {
    const users = mockFetcher(() => new Response("ok"));
    const gateway = createGateway<Env>({ name: "T", version: "1.0.0" });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
    });

    await gateway.fetch(
      new Request("https://api.example.com/users/1"),
      { USERS_API: users },
      execCtx(),
    );
    const token = users.calls[0]!.headers.get(GMODE_HEADERS.gatewayContext)!;
    expect(token).not.toContain(".");
  });

  it("never signs when signing is disabled", async () => {
    const users = mockFetcher(() => new Response("ok"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signing: false },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      auth: false,
    });

    await gateway.fetch(
      new Request("https://api.example.com/users/1"),
      { USERS_API: users, GMODE_CONTEXT_SECRET: "s3cret" },
      execCtx(),
    );
    const token = users.calls[0]!.headers.get(GMODE_HEADERS.gatewayContext)!;
    expect(token).not.toContain(".");
  });
});

describe("resilient OpenAPI aggregation", () => {
  it("degrades gracefully when a service spec fetch fails", async () => {
    const users = specFetcher("listThings");
    const billing = mockFetcher(() => new Response("boom", { status: 500 }));

    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      docs: { openapiCacheTtlSeconds: 0 },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      auth: false,
      openapi: true,
    });
    gateway.service("billing", {
      mount: "/billing",
      binding: "BILLING_API",
      auth: false,
      openapi: true,
    });

    const res = await gateway.fetch(
      new Request("https://api.example.com/openapi.json"),
      { USERS_API: users, BILLING_API: billing },
      execCtx(),
    );
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, unknown>;
      "x-gmode-unavailable": { serviceName: string; reason: string }[];
      tags: { name: string; description?: string }[];
    };
    expect(Object.keys(doc.paths)).toContain("/users/things");
    expect(doc["x-gmode-unavailable"]).toHaveLength(1);
    expect(doc["x-gmode-unavailable"][0]!.serviceName).toBe("billing");
    expect(
      doc.tags.some(
        (t) => t.name === "billing" && /unavailable/i.test(t.description ?? ""),
      ),
    ).toBe(true);
  });

  it("caches the aggregated document and honors ?refresh=1", async () => {
    const users = specFetcher("listThings");
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      docs: { openapiCacheTtlSeconds: 300 },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      auth: false,
      openapi: true,
    });

    const env = { USERS_API: users };
    const url = "https://api.example.com/openapi.json";
    await gateway.fetch(new Request(url), env, execCtx());
    await gateway.fetch(new Request(url), env, execCtx());
    const specCalls = () =>
      users.calls.filter(
        (r) => new URL(r.url).pathname === "/__gmode/openapi.json",
      ).length;
    expect(specCalls()).toBe(1);

    await gateway.fetch(new Request(`${url}?refresh=1`), env, execCtx());
    expect(specCalls()).toBe(2);
  });
});

describe("gateway health", () => {
  it("reports per-service health at /__gmode/health", async () => {
    const users = specFetcher("listThings");
    const billing = mockFetcher(() => new Response("down", { status: 503 }));

    const gateway = createGateway<Env>({ name: "T", version: "1.0.0" });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      auth: false,
    });
    gateway.service("billing", {
      mount: "/billing",
      binding: "BILLING_API",
      auth: false,
    });

    const res = await gateway.fetch(
      new Request("https://api.example.com/__gmode/health"),
      { USERS_API: users, BILLING_API: billing },
      execCtx(),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      services: { name: string; ok: boolean }[];
    };
    expect(body.ok).toBe(false);
    expect(body.services.find((s) => s.name === "users")?.ok).toBe(true);
    expect(body.services.find((s) => s.name === "billing")?.ok).toBe(false);
  });
});
