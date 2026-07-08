import { describe, expect, it } from "vitest";
import {
  type CloudflareRateLimitBinding,
  type FetcherLike,
  type FlagshipBinding,
} from "@gmode/core";
import { z, createService } from "@gmode/service";
import { createMockFlagship } from "@gmode/testing";
import { createGateway } from "./create-gateway";
import { requestId } from "./middleware/request-id";
import { jsonErrors } from "./middleware/json-errors";
import { cloudflareRateLimit } from "./middleware/cloudflare-rate-limit";
import { featureFlags } from "./middleware/feature-flags";

const SIGNING = "internal-signing-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function bindService<E>(svc: {
  fetch(req: Request, env: E, ctx: ExecutionContext): Promise<Response>;
}, env: E): FetcherLike {
  return {
    fetch: (req) => svc.fetch(req, env, execCtx()),
  };
}

function mockRateLimit(allow = true): CloudflareRateLimitBinding & {
  calls: { key: string }[];
} {
  const calls: { key: string }[] = [];
  return {
    calls,
    async limit(input) {
      calls.push(input);
      return { success: allow };
    },
  };
}

describe("integration: gateway → service", () => {
  type ServiceEnv = { INTERNAL_SIGNING_SECRET: string };
  type GatewayEnv = {
    USERS_API: FetcherLike;
    BILLING_API: FetcherLike;
    RL: CloudflareRateLimitBinding;
    INTERNAL_SIGNING_SECRET: string;
  };

  function buildUsers() {
    const service = createService<ServiceEnv>({
      name: "Users API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    });
    service.get("/:id", {
      operationId: "getUser",
      summary: "get user",
      params: z.object({ id: z.string() }),
      responses: { 200: z.object({ id: z.string() }) },
      handler: async ({ params }) => ({ id: params.id }),
    });
    return service;
  }

  function buildBilling() {
    const service = createService<ServiceEnv>({
      name: "Billing API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "billing",
      },
    });
    service.get("/ping", {
      operationId: "billingPing",
      summary: "ping",
      responses: { 200: z.object({ pong: z.boolean() }) },
      handler: async () => ({ pong: true }),
    });
    return service;
  }

  function buildGateway(env: GatewayEnv) {
    const gateway = createGateway<GatewayEnv>({
      name: "Test API",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(cloudflareRateLimit({ binding: "RL", key: () => "k" }));
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      openapi: true,
    });
    gateway.service("billing", {
      mount: "/billing",
      binding: "BILLING_API",
      audience: "billing",
      openapi: true,
    });
    return gateway;
  }

  it("GET /users/123 reaches the users service", async () => {
    const usersSvc = buildUsers();
    const billingSvc = buildBilling();
    const rl = mockRateLimit();
    const env: GatewayEnv = {
      USERS_API: bindService(usersSvc, { INTERNAL_SIGNING_SECRET: SIGNING }),
      BILLING_API: bindService(billingSvc, {
        INTERNAL_SIGNING_SECRET: SIGNING,
      }),
      RL: rl,
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const gateway = buildGateway(env);
    const res = await gateway.fetch(
      new Request("https://api.test/users/123"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("123");
    expect(rl.calls).toHaveLength(1);
  });

  it("aggregates OpenAPI spec from both services", async () => {
    const usersSvc = buildUsers();
    const billingSvc = buildBilling();
    const rl = mockRateLimit();
    const env: GatewayEnv = {
      USERS_API: bindService(usersSvc, { INTERNAL_SIGNING_SECRET: SIGNING }),
      BILLING_API: bindService(billingSvc, {
        INTERNAL_SIGNING_SECRET: SIGNING,
      }),
      RL: rl,
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const gateway = buildGateway(env);
    const res = await gateway.fetch(
      new Request("https://api.test/openapi.json"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/users/{id}"]).toBeDefined();
    expect(spec.paths["/billing/ping"]).toBeDefined();
  });

  it("forwards pre-evaluated flags to service via signed context", async () => {
    type SvcEnv = { INTERNAL_SIGNING_SECRET: string };
    const usersSvc = createService<SvcEnv>({
      name: "Users API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    });
    usersSvc.get("/:id", {
      operationId: "getUser",
      summary: "get user",
      params: z.object({ id: z.string() }),
      responses: {
        200: z.object({
          id: z.string(),
          newCheckout: z.boolean(),
        }),
      },
      handler: async ({ params, gateway }) => ({
        id: params.id,
        newCheckout: gateway.flags?.["new-checkout"] === true,
      }),
    });
    const billingSvc = buildBilling();
    const flags = createMockFlagship({ booleans: { "new-checkout": true } });
    type Env2 = GatewayEnv & { FLAGS: FlagshipBinding };
    const env: Env2 = {
      USERS_API: bindService(usersSvc, { INTERNAL_SIGNING_SECRET: SIGNING }),
      BILLING_API: bindService(billingSvc, {
        INTERNAL_SIGNING_SECRET: SIGNING,
      }),
      RL: mockRateLimit(),
      FLAGS: flags,
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const gateway = createGateway<Env2>({
      name: "Test API",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(
      featureFlags<Env2, "FLAGS">({
        binding: "FLAGS",
        forward: ["new-checkout"],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users/123"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; newCheckout: boolean };
    expect(body.id).toBe("123");
    expect(body.newCheckout).toBe(true);
  });

  it("serves Swagger UI HTML at /docs", async () => {
    const usersSvc = buildUsers();
    const billingSvc = buildBilling();
    const env: GatewayEnv = {
      USERS_API: bindService(usersSvc, { INTERNAL_SIGNING_SECRET: SIGNING }),
      BILLING_API: bindService(billingSvc, {
        INTERNAL_SIGNING_SECRET: SIGNING,
      }),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const gateway = buildGateway(env);
    const res = await gateway.fetch(
      new Request("https://api.test/docs"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("swagger-ui");
  });

  it("serves optional Scalar UI HTML at configured path", async () => {
    const usersSvc = buildUsers();
    const billingSvc = buildBilling();
    const env: GatewayEnv = {
      USERS_API: bindService(usersSvc, { INTERNAL_SIGNING_SECRET: SIGNING }),
      BILLING_API: bindService(billingSvc, {
        INTERNAL_SIGNING_SECRET: SIGNING,
      }),
      RL: mockRateLimit(),
      INTERNAL_SIGNING_SECRET: SIGNING,
    };
    const gateway = createGateway<GatewayEnv>({
      name: "Test API",
      version: "1.0.0",
      docs: { scalar: "/reference", ui: "scalar" },
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      audience: "users",
      openapi: true,
    });

    const res = await gateway.fetch(
      new Request("https://api.test/reference"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("@scalar/api-reference");
    expect(html).toContain("Scalar.createApiReference");
    expect(html).toContain("/openapi.json");
  });
});
