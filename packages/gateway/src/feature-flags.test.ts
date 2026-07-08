import { describe, expect, it } from "vitest";
import {
  decodeGatewayContext,
  type FetcherLike,
  type FlagshipBinding,
} from "@gmode/core";
import { createMockFlagship } from "@gmode/testing";
import { createGateway } from "./create-gateway";
import { requestId } from "./middleware/request-id";
import { jsonErrors } from "./middleware/json-errors";
import { featureFlags } from "./middleware/feature-flags";

function execCtx(): ExecutionContext {
  return {
    waitUntil() { },
    passThroughOnException() { },
  } as ExecutionContext;
}

function mockFetcher(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  return {
    calls,
    async fetch(req: Request) {
      calls.push(req);
      return handler(req);
    },
  };
}

type Env = {
  USERS_API: FetcherLike;
  BILLING_API: FetcherLike;
  FLAGS: FlagshipBinding;
};

describe("featureFlags middleware", () => {
  it("attaches a flags client to the request context", async () => {
    const flags = createMockFlagship({ booleans: { "new-list": true } });
    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env, "FLAGS">({ binding: "FLAGS" }),
    );
    // custom middleware to assert client is attached
    let observed: boolean | null = null;
    gateway.use(async (ctx, next) => {
      observed = (await ctx.flags?.getBooleanValue("new-list", false)) ?? null;
      return next();
    });
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const env: Env = {
      USERS_API: users,
      BILLING_API: mockFetcher(() => new Response("{}")),
      FLAGS: flags,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(observed).toBe(true);
    expect(flags.calls.some((c) => c.key === "new-list")).toBe(true);
  });

  it("gates a service mount: 404 when off", async () => {
    const flags = createMockFlagship({ booleans: { "billing-enabled": false } });
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env, "FLAGS">({
        binding: "FLAGS",
        gates: { "/billing": "billing-enabled" },
      }),
    );
    gateway.service("billing", { mount: "/billing", binding: "BILLING_API" });

    const billing = mockFetcher(() => new Response("{}"));
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      BILLING_API: billing,
      FLAGS: flags,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/billing/invoices/1"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(404);
    expect(billing.calls).toHaveLength(0);
  });

  it("gates a service mount: forwards when on", async () => {
    const flags = createMockFlagship({ booleans: { "billing-enabled": true } });
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env, "FLAGS">({
        binding: "FLAGS",
        gates: { "/billing": "billing-enabled" },
      }),
    );
    gateway.service("billing", { mount: "/billing", binding: "BILLING_API" });

    const billing = mockFetcher(() => new Response("{}"));
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      BILLING_API: billing,
      FLAGS: flags,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/billing/invoices/1"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(billing.calls).toHaveLength(1);
  });

  it("503 gate behavior", async () => {
    const flags = createMockFlagship({ booleans: { ok: false } });
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env, "FLAGS">({
        binding: "FLAGS",
        gates: { "/users": "ok" },
        gateBehavior: "503",
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });
    const env: Env = {
      USERS_API: mockFetcher(() => new Response("{}")),
      BILLING_API: mockFetcher(() => new Response("{}")),
      FLAGS: flags,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; }; };
    expect(body.error.code).toBe("SERVICE_DISABLED");
  });

  it("forwards pre-evaluated flags into the private gateway context", async () => {
    const flags = createMockFlagship({
      booleans: { "new-checkout": true },
      strings: { "tier": "gold" },
    });
    let captured: Request | null = null;
    const users = mockFetcher((req) => {
      captured = req;
      return new Response("{}");
    });
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env, "FLAGS">({
        binding: "FLAGS",
        forward: ["new-checkout", "tier"],
      }),
    );
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
    });

    const env: Env = {
      USERS_API: users,
      BILLING_API: mockFetcher(() => new Response("{}")),
      FLAGS: flags,
    };
    await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    const token = (captured as unknown as Request).headers.get(
      "x-gmode-context",
    )!;
    const verified = decodeGatewayContext(token, {
      audience: "users",
    });
    expect(verified.flags).toEqual({
      "new-checkout": true,
      "tier": "gold",
    });
  });

  it("does not 500 when a forwarded flag is missing from the Flagship app", async () => {
    const flags: FlagshipBinding = {
      async get(_key) {
        throw new Error("Flag 'missing-one' not found");
      },
      async getBooleanValue(_k, def) {
        return def;
      },
      async getStringValue(_k, def) {
        return def;
      },
      async getNumberValue(_k, def) {
        return def;
      },
      async getObjectValue(_k, def) {
        return def as object;
      },
      async getBooleanDetails(k, def) {
        return { flagKey: k, value: def };
      },
      async getStringDetails(k, def) {
        return { flagKey: k, value: def };
      },
      async getNumberDetails(k, def) {
        return { flagKey: k, value: def };
      },
      async getObjectDetails(k, def) {
        return { flagKey: k, value: def as object };
      },
    };

    const users = mockFetcher(() => new Response("{}"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env, "FLAGS">({
        binding: "FLAGS",
        forward: ["missing-one"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const env: Env = {
      USERS_API: users,
      BILLING_API: mockFetcher(() => new Response("{}")),
      FLAGS: flags,
    };
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
  });
});
