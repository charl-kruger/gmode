import { describe, expect, it } from "vitest";
import {
  GMODE_HEADERS,
  signGatewayContext,
  type GatewayContext,
} from "@gmode/core";
import { createMockFlagship } from "@gmode/testing";
import { z } from "zod";
import { createService } from "./create-service";
import { withJsonSchema, type StandardSchemaV1 } from "./schema";

const SIGNING = "internal-signing-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

async function makeContextToken(
  override: Partial<GatewayContext> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ctx: GatewayContext = {
    iss: "gmode-gateway",
    aud: "users",
    requestId: "req_1",
    authenticated: true,
    scopes: ["users:read"],
    permissions: [],
    issuedAt: now,
    expiresAt: now + 60,
    ...override,
  };
  return signGatewayContext(ctx, SIGNING);
}

function buildService() {
  type Env = { INTERNAL_SIGNING_SECRET: string };
  const service = createService<Env>({
    name: "Users API",
    version: "1.0.0",
    trustGateway: {
      signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
      audience: "users",
    },
  });

  service.get("/", {
    operationId: "list",
    summary: "list",
    responses: { 200: z.object({ ok: z.boolean() }) },
    scopes: ["users:read"],
    handler: async () => ({ ok: true }),
  });

  service.get("/:id", {
    operationId: "get",
    summary: "get",
    params: z.object({ id: z.string() }),
    responses: { 200: z.object({ id: z.string() }) },
    scopes: ["users:read"],
    shieldAction: "log",
    handler: async ({ params }) => ({ id: params.id }),
  });

  service.post("/", {
    operationId: "create",
    summary: "create",
    body: z.object({ name: z.string() }),
    responses: {
      201: z.object({ id: z.string() }),
      400: service.errors.schema,
    },
    scopes: ["users:write"],
    handler: async ({ body, created }) =>
      created({ id: `u_${(body as { name: string }).name}` }),
  });

  return service;
}

describe("service", () => {
  it("rejects when gateway context missing", async () => {
    const service = buildService();
    const res = await service.fetch(
      new Request("https://svc.test/"),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MISSING_GATEWAY_CONTEXT");
  });

  it("rejects expired context", async () => {
    const service = buildService();
    const now = Math.floor(Date.now() / 1000);
    const token = await makeContextToken({ expiresAt: now - 120 });
    const res = await service.fetch(
      new Request("https://svc.test/", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(401);
  });

  it("rejects wrong audience", async () => {
    const service = buildService();
    const token = await makeContextToken({ aud: "billing" });
    const res = await service.fetch(
      new Request("https://svc.test/", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(401);
  });

  it("accepts valid context and runs handler", async () => {
    const service = buildService();
    const token = await makeContextToken();
    const res = await service.fetch(
      new Request("https://svc.test/123", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("123");
  });

  it("rejects insufficient scope", async () => {
    const service = buildService();
    const token = await makeContextToken({ scopes: ["other:read"] });
    const res = await service.fetch(
      new Request("https://svc.test/123", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(403);
  });

  it("accepts wildcard scope", async () => {
    const service = buildService();
    const token = await makeContextToken({ scopes: ["users:*"] });
    const res = await service.fetch(
      new Request("https://svc.test/123", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(200);
  });

  it("returns 415 for missing JSON content-type on POST", async () => {
    const service = buildService();
    const token = await makeContextToken({ scopes: ["users:write"] });
    const res = await service.fetch(
      new Request("https://svc.test/", {
        method: "POST",
        headers: {
          [GMODE_HEADERS.gatewayContext]: token,
          "content-type": "text/plain",
        },
        body: "hello",
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(415);
  });

  it("returns 400 on invalid JSON", async () => {
    const service = buildService();
    const token = await makeContextToken({ scopes: ["users:write"] });
    const res = await service.fetch(
      new Request("https://svc.test/", {
        method: "POST",
        headers: {
          [GMODE_HEADERS.gatewayContext]: token,
          "content-type": "application/json",
        },
        body: "not json",
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("returns 400 on body validation failure", async () => {
    const service = buildService();
    const token = await makeContextToken({ scopes: ["users:write"] });
    const res = await service.fetch(
      new Request("https://svc.test/", {
        method: "POST",
        headers: {
          [GMODE_HEADERS.gatewayContext]: token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ wrong: "field" }),
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("plain object handler response becomes JSON 200", async () => {
    const service = buildService();
    const token = await makeContextToken();
    const res = await service.fetch(
      new Request("https://svc.test/", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("serves internal openapi.json", async () => {
    const service = buildService();
    const res = await service.fetch(
      new Request("https://svc.test/__gmode/openapi.json"),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths).toBeDefined();
    expect(body.paths["/{id}"]?.["get"]?.["x-gmode-shield-action"]).toBe(
      "log",
    );
  });

  it("accepts Standard Schema validators with explicit JSON Schema for OpenAPI", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const createBodySchema: StandardSchemaV1<
      unknown,
      { name: string }
    > = {
      "~standard": {
        version: 1,
        vendor: "gmode-test",
        validate: (value) => {
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            typeof (value as Record<string, unknown>)["name"] === "string"
          ) {
            return {
              value: {
                name: (value as Record<string, string>)["name"]!,
              },
            };
          }
          return {
            issues: [{ message: "name is required", path: ["name"] }],
          };
        },
      },
    };
    const service = createService<Env>({
      name: "Standard Schema API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    });
    service.post("/standard", {
      operationId: "createStandard",
      body: withJsonSchema(createBodySchema, {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      }),
      responses: {
        201: z.object({ id: z.string() }),
      },
      handler: ({ body, created }) => {
        const input = body as { name: string };
        return created({ id: `std_${input.name}` });
      },
    });

    const token = await makeContextToken({ scopes: [] });
    const valid = await service.fetch(
      new Request("https://svc.test/standard", {
        method: "POST",
        headers: {
          [GMODE_HEADERS.gatewayContext]: token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "ada" }),
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(valid.status).toBe(201);
    expect((await valid.json()) as { id: string }).toEqual({ id: "std_ada" });

    const invalid = await service.fetch(
      new Request("https://svc.test/standard", {
        method: "POST",
        headers: {
          [GMODE_HEADERS.gatewayContext]: token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ wrong: "field" }),
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as {
      error: { code: string; details: { vendor: string } };
    };
    expect(invalidBody.error.code).toBe("VALIDATION_ERROR");
    expect(invalidBody.error.details.vendor).toBe("gmode-test");

    const openapi = await service.fetch(
      new Request("https://svc.test/__gmode/openapi.json"),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    const doc = (await openapi.json()) as {
      paths: Record<
        string,
        {
          post?: {
            requestBody?: {
              content?: Record<string, { schema?: Record<string, unknown> }>;
            };
          };
        }
      >;
    };
    const schema =
      doc.paths["/standard"]?.post?.requestBody?.content?.[
        "application/json"
      ]?.schema;
    expect(schema).toEqual({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    });
  });

  it("fails clearly when a Standard Schema route has no JSON Schema for OpenAPI", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const schema: StandardSchemaV1<unknown, { id: string }> = {
      "~standard": {
        version: 1,
        vendor: "gmode-test",
        validate: (value) =>
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          typeof (value as Record<string, unknown>)["id"] === "string"
            ? {
                value: {
                  id: (value as Record<string, string>)["id"]!,
                },
              }
            : { issues: [{ message: "id is required" }] },
      },
    };
    const service = createService<Env>({
      name: "Unsupported Standard Schema API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    });
    service.post("/unsupported-openapi", {
      operationId: "unsupportedOpenApi",
      body: schema,
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const res = await service.fetch(
      new Request("https://svc.test/__gmode/openapi.json"),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/withJsonSchema/);
  });
});

describe("service feature flags", () => {
  type Env = {
    INTERNAL_SIGNING_SECRET: string;
    FLAGS: ReturnType<typeof createMockFlagship>;
  };

  function buildFlagService() {
    const service = createService<Env>({
      name: "Users API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
      flags: { binding: (env) => env.FLAGS },
    });

    service.get("/gated", {
      operationId: "gated",
      summary: "gated",
      featureFlag: "users-v2",
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: async () => ({ ok: true }),
    });

    service.get("/inline", {
      operationId: "inline",
      summary: "inline",
      responses: { 200: z.object({ show: z.boolean() }) },
      handler: async ({ flags }) => ({
        show: (await flags?.getBooleanValue("show-email", false)) ?? false,
      }),
    });

    return service;
  }

  async function ctxToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return signGatewayContext(
      {
        iss: "gmode-gateway",
        aud: "users",
        requestId: "req_1",
        authenticated: true,
        scopes: [],
        permissions: [],
        issuedAt: now,
        expiresAt: now + 60,
      },
      SIGNING,
    );
  }

  it("returns 404 when feature flag is off (service-side eval)", async () => {
    const service = buildFlagService();
    const flags = createMockFlagship({ booleans: { "users-v2": false } });
    const token = await ctxToken();
    const res = await service.fetch(
      new Request("https://svc.test/gated", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING, FLAGS: flags },
      execCtx(),
    );
    expect(res.status).toBe(404);
    expect(
      flags.calls.some(
        (c) => c.method === "getBooleanValue" && c.key === "users-v2",
      ),
    ).toBe(true);
  });

  it("runs handler when feature flag is on", async () => {
    const service = buildFlagService();
    const flags = createMockFlagship({ booleans: { "users-v2": true } });
    const token = await ctxToken();
    const res = await service.fetch(
      new Request("https://svc.test/gated", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING, FLAGS: flags },
      execCtx(),
    );
    expect(res.status).toBe(200);
  });

  it("exposes flags client to handler for inline checks", async () => {
    const service = buildFlagService();
    const flags = createMockFlagship({ booleans: { "show-email": true } });
    const token = await ctxToken();
    const res = await service.fetch(
      new Request("https://svc.test/inline", {
        headers: { [GMODE_HEADERS.gatewayContext]: token },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING, FLAGS: flags },
      execCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { show: boolean };
    expect(body.show).toBe(true);
  });

  it("falls back to gateway-forwarded flags when no service binding", async () => {
    type EnvNoBinding = { INTERNAL_SIGNING_SECRET: string };
    const service = createService<EnvNoBinding>({
      name: "Users API",
      version: "1.0.0",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    });
    service.get("/gated", {
      operationId: "gated",
      summary: "gated",
      featureFlag: "from-gateway",
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: async () => ({ ok: true }),
    });

    const now = Math.floor(Date.now() / 1000);
    const tokenOn = await signGatewayContext(
      {
        iss: "gmode-gateway",
        aud: "users",
        requestId: "r1",
        authenticated: true,
        scopes: [],
        permissions: [],
        issuedAt: now,
        expiresAt: now + 60,
        flags: { "from-gateway": true },
      },
      SIGNING,
    );
    const onRes = await service.fetch(
      new Request("https://svc.test/gated", {
        headers: { [GMODE_HEADERS.gatewayContext]: tokenOn },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(onRes.status).toBe(200);

    const tokenOff = await signGatewayContext(
      {
        iss: "gmode-gateway",
        aud: "users",
        requestId: "r2",
        authenticated: true,
        scopes: [],
        permissions: [],
        issuedAt: now,
        expiresAt: now + 60,
        flags: { "from-gateway": false },
      },
      SIGNING,
    );
    const offRes = await service.fetch(
      new Request("https://svc.test/gated", {
        headers: { [GMODE_HEADERS.gatewayContext]: tokenOff },
      }),
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(offRes.status).toBe(404);
  });

  it("emits x-gmode-feature-flag in OpenAPI", async () => {
    const service = buildFlagService();
    const res = await service.fetch(
      new Request("https://svc.test/__gmode/openapi.json"),
      {
        INTERNAL_SIGNING_SECRET: SIGNING,
        FLAGS: createMockFlagship(),
      },
      execCtx(),
    );
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(spec.paths["/gated"]?.["get"]?.["x-gmode-feature-flag"]).toBe(
      "users-v2",
    );
  });
});
