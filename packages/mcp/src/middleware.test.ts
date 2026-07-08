import { describe, expect, it } from "vitest";
import {
  createGateway,
  featureFlags,
  jsonErrors,
  jwtAuth,
  requestId,
} from "@gmode/gateway";
import { z, createService } from "@gmode/service";
import {
  base64urlEncodeString,
  hmacSign,
  type FlagshipBinding,
  type FetcherLike,
} from "@gmode/core";
import { mountMcp } from "./middleware";
import { bearerTokenOAuthProvider } from "./oauth";

const JWT_SECRET = "jwt-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() { },
    passThroughOnException() { },
  } as ExecutionContext;
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

async function makeJwt(claims: Record<string, unknown>): Promise<string> {
  const header = base64urlEncodeString(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncodeString(
    JSON.stringify({ iat: now, exp: now + 60, ...claims }),
  );
  const sig = await hmacSign(JWT_SECRET, `${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

type SvcEnv = Record<string, never>;
type GwEnv = {
  USERS_API: FetcherLike;
  BILLING_API: FetcherLike;
  JWT_SECRET: string;
  FLAGS?: FlagshipBinding;
};

function mockFlagship(booleans: Record<string, boolean>): FlagshipBinding {
  return {
    async get(flagKey, defaultValue) {
      return booleans[flagKey] ?? defaultValue;
    },
    async getBooleanValue(flagKey, defaultValue) {
      return booleans[flagKey] ?? defaultValue;
    },
    async getStringValue(_flagKey, defaultValue) {
      return defaultValue;
    },
    async getNumberValue(_flagKey, defaultValue) {
      return defaultValue;
    },
    async getObjectValue(_flagKey, defaultValue) {
      return defaultValue;
    },
    async getBooleanDetails(flagKey, defaultValue) {
      const value = booleans[flagKey] ?? defaultValue;
      return { flagKey, value, reason: "mock" };
    },
    async getStringDetails(flagKey, defaultValue) {
      return { flagKey, value: defaultValue, reason: "mock" };
    },
    async getNumberDetails(flagKey, defaultValue) {
      return { flagKey, value: defaultValue, reason: "mock" };
    },
    async getObjectDetails(flagKey, defaultValue) {
      return { flagKey, value: defaultValue, reason: "mock" };
    },
  };
}

function buildUsersService() {
  const svc = createService<SvcEnv>({
    name: "Users API",
    version: "1.0.0",
    trustGateway: {
      audience: "users",
    },
  });
  svc.get("/", {
    operationId: "listUsers",
    summary: "List users",
    tags: ["Users"],
    scopes: ["users:read"],
    responses: { 200: z.object({ users: z.array(z.string()) }) },
    handler: async () => ({ users: ["u1", "u2"] }),
  });
  svc.get("/:id", {
    operationId: "getUser",
    summary: "Get a single user by id",
    tags: ["Users"],
    scopes: ["users:read"],
    params: z.object({ id: z.string() }),
    responses: { 200: z.object({ id: z.string(), email: z.string() }) },
    handler: async ({ params }) => ({
      id: params.id,
      email: `${params.id}@example.com`,
    }),
  });
  return svc;
}

function buildBillingService() {
  const svc = createService<SvcEnv>({
    name: "Billing API",
    version: "1.0.0",
    trustGateway: {
      audience: "billing",
    },
  });
  svc.post("/invoices", {
    operationId: "createInvoice",
    summary: "Create an invoice",
    tags: ["Billing"],
    scopes: ["billing:write"],
    body: z.object({
      total: z.number().int().positive(),
      currency: z.string().length(3),
    }),
    responses: {
      201: z.object({
        id: z.string(),
        total: z.number(),
        currency: z.string(),
      }),
    },
    handler: async ({ body, created }) => {
      const input = body as { total: number; currency: string; };
      return created({
        id: "inv_test",
        total: input.total,
        currency: input.currency,
      });
    },
  });
  return svc;
}

function buildGateway() {
  const users = buildUsersService();
  const billing = buildBillingService();
  const env: GwEnv = {
    USERS_API: bindService(users, {}),
    BILLING_API: bindService(billing, {}), JWT_SECRET,
  };
  const gateway = createGateway<GwEnv>({
    name: "Example API",
    version: "1.0.0",
  });
  gateway.use(requestId());
  gateway.use(jsonErrors());
  gateway.use(jwtAuth<GwEnv>({
    secret: (e) => e.JWT_SECRET,
    required: false
  }));
  gateway.use(
    mountMcp<GwEnv>({
      path: "/mcp",
      serverInfo: { name: "Example API MCP", version: "1.0.0" },
    }),
  );
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
    auth: true,
    scopes: ["billing:*"],
    openapi: true,
  });
  return { gateway, env };
}

function buildOAuthGateway() {
  const users = buildUsersService();
  const billing = buildBillingService();
  const env: GwEnv = {
    USERS_API: bindService(users, {}),
    BILLING_API: bindService(billing, {}), JWT_SECRET,
  };
  const gateway = createGateway<GwEnv>({
    name: "Example API",
    version: "1.0.0",
  });
  gateway.use(requestId());
  gateway.use(jsonErrors());
  gateway.use(
    mountMcp<GwEnv>({
      path: "/mcp",
      serverInfo: { name: "Example API MCP", version: "1.0.0" },
      oauth: bearerTokenOAuthProvider<GwEnv>({
        requiredScopes: ["mcp:access"],
        verifyToken: ({ token }) => {
          if (token === "valid-users") {
            return {
              subject: "oauth-user",
              scopes: ["mcp:access", "users:read"],
              clientId: "test-client",
            };
          }
          if (token === "valid-billing") {
            return {
              subject: "oauth-billing",
              scopes: ["mcp:access", "billing:*"],
              clientId: "test-client",
            };
          }
          if (token === "missing-mcp-scope") {
            return {
              subject: "oauth-limited",
              scopes: ["users:read"],
            };
          }
          return null;
        },
      }),
    }),
  );
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
    auth: true,
    scopes: ["billing:*"],
    openapi: true,
  });
  return { gateway, env };
}

function buildGatedGateway() {
  const users = buildUsersService();
  const billing = buildBillingService();
  let billingCalls = 0;
  const billingFetcher: FetcherLike = {
    fetch: async (req) => {
      if (!new URL(req.url).pathname.endsWith("/openapi.json")) {
        billingCalls += 1;
      }
      return billing.fetch(req, {}, execCtx());
    },
  };
  const env: GwEnv = {
    USERS_API: bindService(users, {}),
    BILLING_API: billingFetcher,
    JWT_SECRET,
    FLAGS: mockFlagship({ "billing-enabled": false }),
  };
  const gateway = createGateway<GwEnv>({
    name: "Example API",
    version: "1.0.0",
  });
  gateway.use(requestId());
  gateway.use(jsonErrors());
  gateway.use(jwtAuth<GwEnv>({
    secret: (e) => e.JWT_SECRET,
    required: false
  }));
  gateway.use(
    featureFlags<GwEnv, "FLAGS">({
      binding: "FLAGS",
      gates: { "/billing": "billing-enabled" },
    }),
  );
  gateway.use(
    mountMcp<GwEnv>({
      path: "/mcp",
      serverInfo: { name: "Example API MCP", version: "1.0.0" },
    }),
  );
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
    auth: true,
    scopes: ["billing:*"],
    openapi: true,
  });
  return {
    gateway,
    env,
    getBillingCalls: () => billingCalls,
  };
}

async function postRpc(
  gateway: ReturnType<typeof createGateway<GwEnv>>,
  env: GwEnv,
  body: unknown,
  init?: { headers?: Record<string, string>; },
): Promise<unknown> {
  const res = await gateway.fetch(
    new Request("https://api.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    execCtx(),
  );
  expect(res.status).toBe(200);
  return res.json();
}

async function postRawRpc(
  gateway: ReturnType<typeof createGateway<GwEnv>>,
  env: GwEnv,
  body: unknown,
  init?: { headers?: Record<string, string>; },
): Promise<Response> {
  return gateway.fetch(
    new Request("https://api.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    execCtx(),
  );
}

describe("mountMcp middleware", () => {
  it("passes through non-MCP paths to the regular gateway routing", async () => {
    const { gateway, env } = buildGateway();
    const res = await gateway.fetch(
      new Request("https://api.test/openapi.json"),
      env,
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("returns a clear error for legacy SSE GET requests", async () => {
    const { gateway, env } = buildGateway();
    const res = await gateway.fetch(
      new Request("https://api.test/mcp", {
        method: "GET",
        headers: { accept: "text/event-stream" },
      }),
      env,
      execCtx(),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("x-gmode-mcp-transport")).toBe("streamable-http");
    const body = (await res.json()) as {
      error: string;
      transport: string;
      method: string;
      path: string;
    };
    expect(body.error).toContain("Legacy SSE transport is not supported");
    expect(body.transport).toBe("streamable-http");
    expect(body.method).toBe("POST");
    expect(body.path).toBe("/mcp");
  });
});

describe("MCP protocol over POST /mcp", () => {
  it("responds to initialize with the server info + protocol version", async () => {
    const { gateway, env } = buildGateway();
    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    })) as { result: { serverInfo: { name: string; }; protocolVersion: string; }; };
    expect(reply.result.serverInfo.name).toBe("Example API MCP");
    expect(reply.result.protocolVersion).toBe("2025-06-18");
  });

  it("returns 202 with no body for JSON-RPC notifications", async () => {
    const { gateway, env } = buildGateway();
    const res = await postRawRpc(gateway, env, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("advertises tools, resources, and prompts capabilities", async () => {
    const { gateway, env } = buildGateway();
    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 17,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    })) as {
      result: {
        capabilities: {
          tools?: { listChanged: boolean; };
          resources?: { listChanged: boolean; };
          prompts?: { listChanged: boolean; };
        };
      };
    };
    expect(reply.result.capabilities.tools?.listChanged).toBe(false);
    expect(reply.result.capabilities.resources?.listChanged).toBe(false);
    expect(reply.result.capabilities.prompts?.listChanged).toBe(false);
  });

  it("lists discover + invoke tools in catalog mode (default)", async () => {
    const { gateway, env } = buildGateway();
    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })) as { result: { tools: { name: string; }[]; }; };
    const names = reply.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["discover", "invoke"]);
  });

  it("discover returns operations indexed from the aggregated OpenAPI", async () => {
    const { gateway, env } = buildGateway();
    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discover", arguments: {} },
    })) as { result: { content: { text: string; }[]; }; };
    const payload = JSON.parse(reply.result.content[0]!.text) as {
      operations: { operationId: string; }[];
    };
    const ids = payload.operations.map((o) => o.operationId).sort();
    expect(ids).toContain("getUser");
    expect(ids).toContain("listUsers");
    expect(ids).toContain("createInvoice");
  });

  it("discover honors the query filter", async () => {
    const { gateway, env } = buildGateway();
    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discover", arguments: { query: "user" } },
    })) as { result: { content: { text: string; }[]; }; };
    const payload = JSON.parse(reply.result.content[0]!.text) as {
      operations: { operationId: string; }[];
    };
    const ids = payload.operations.map((o) => o.operationId).sort();
    expect(ids).toEqual(["getUser", "listUsers"]);
  });

  it("invoke dispatches through forwardToService and returns the response", async () => {
    const { gateway, env } = buildGateway();
    const token = await makeJwt({
      sub: "u1",
      scope: "users:read",
    });
    const reply = (await postRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: {
            operationId: "getUser",
            pathParams: { id: "abc" },
          },
        },
      },
      { headers: { authorization: `Bearer ${token}` } },
    )) as { result: { content: { text: string; }[]; isError?: boolean; }; };
    const payload = JSON.parse(reply.result.content[0]!.text) as {
      status: number;
      body: { id: string; email: string; };
    };
    expect(payload.status).toBe(200);
    expect(payload.body.id).toBe("abc");
    expect(payload.body.email).toBe("abc@example.com");
    expect(reply.result.isError).toBeFalsy();
  });

  it("invoke rejects calls that don't have the required scopes", async () => {
    const { gateway, env } = buildGateway();
    const token = await makeJwt({ sub: "u1", scope: "other:scope" });
    const reply = (await postRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: {
            operationId: "createInvoice",
            body: { total: 4999, currency: "USD" },
          },
        },
      },
      { headers: { authorization: `Bearer ${token}` } },
    )) as { error?: { data?: { code: string; }; }; };
    expect(reply.error?.data?.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("invoke respects gateway feature-flag mount gates", async () => {
    const { gateway, env, getBillingCalls } = buildGatedGateway();
    const token = await makeJwt({ sub: "u1", scope: "billing:*" });
    const reply = (await postRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: {
            operationId: "createInvoice",
            body: { total: 4999, currency: "USD" },
          },
        },
      },
      { headers: { authorization: `Bearer ${token}` } },
    )) as { error?: { data?: { code: string; status: number; }; }; };
    expect(reply.error?.data?.code).toBe("NOT_FOUND");
    expect(reply.error?.data?.status).toBe(404);
    expect(getBillingCalls()).toBe(0);
  });

  it("invoke surfaces missing-path-param as InvalidParams", async () => {
    const { gateway, env } = buildGateway();
    const token = await makeJwt({ sub: "u1", scope: "users:read" });
    const reply = (await postRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: { operationId: "getUser" },
        },
      },
      { headers: { authorization: `Bearer ${token}` } },
    )) as { error?: { code: number; message: string; }; };
    expect(reply.error?.code).toBeDefined();
    expect(reply.error?.message).toMatch(/path parameter/);
  });

  it("returns method-not-found for unknown JSON-RPC methods", async () => {
    const { gateway, env } = buildGateway();
    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 8,
      method: "rituals/dance",
    })) as { error?: { code: number; message: string; }; };
    expect(reply.error?.code).toBe(-32601);
    expect(reply.error?.message).toMatch(/Method not found/);
  });

  it("lists and reads OpenAPI MCP resources", async () => {
    const { gateway, env } = buildGateway();
    const listReply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 18,
      method: "resources/list",
    })) as { result: { resources: { uri: string; mimeType: string; }[]; }; };
    expect(listReply.result.resources).toContainEqual({
      uri: "gmode://openapi.json",
      name: "Aggregated OpenAPI",
      description:
        "Gateway-level OpenAPI document with all exposed service operations.",
      mimeType: "application/json",
    });

    const readReply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 19,
      method: "resources/read",
      params: { uri: "gmode://openapi.json" },
    })) as { result: { contents: { text: string; mimeType: string; }[]; }; };
    const spec = JSON.parse(readReply.result.contents[0]!.text) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(readReply.result.contents[0]!.mimeType).toBe("application/json");
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/users/{id}");
  });

  it("lists and returns generated MCP prompts", async () => {
    const { gateway, env } = buildGateway();
    const listReply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 20,
      method: "prompts/list",
    })) as { result: { prompts: { name: string; }[]; }; };
    expect(listReply.result.prompts.map((prompt) => prompt.name)).toEqual([
      "inspect-api",
      "invoke-operation",
    ]);

    const getReply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 21,
      method: "prompts/get",
      params: {
        name: "invoke-operation",
        arguments: { operationId: "getUser" },
      },
    })) as {
      result: {
        messages: { role: "user"; content: { type: "text"; text: string; }; }[];
      };
    };
    expect(getReply.result.messages[0]!.role).toBe("user");
    expect(getReply.result.messages[0]!.content.text).toContain("getUser");
  });

  it("tools mode lists one tool per operation", async () => {
    const users = buildUsersService();
    const billing = buildBillingService();
    const env: GwEnv = {
      USERS_API: bindService(users, {}),
      BILLING_API: bindService(billing, {}), JWT_SECRET,
    };
    const gateway = createGateway<GwEnv>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.use(mountMcp<GwEnv>({ mode: "tools" }));
    gateway.service("users", { mount: "/users", binding: "USERS_API", openapi: true });
    gateway.service("billing", { mount: "/billing", binding: "BILLING_API", openapi: true });

    const reply = (await postRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/list",
    })) as { result: { tools: { name: string; }[]; }; };
    const names = reply.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["createInvoice", "getUser", "listUsers"]);
  });
});

describe("MCP OAuth provider", () => {
  it("rejects missing bearer tokens before JSON-RPC dispatch", async () => {
    const { gateway, env } = buildOAuthGateway();
    const res = await postRawRpc(gateway, env, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; }; };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects invalid bearer tokens before JSON-RPC dispatch", async () => {
    const { gateway, env } = buildOAuthGateway();
    const res = await postRawRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
      },
      { headers: { authorization: "Bearer wrong" } },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; }; };
    expect(body.error.code).toBe("INVALID_AUTH_TOKEN");
  });

  it("enforces provider-level required scopes", async () => {
    const { gateway, env } = buildOAuthGateway();
    const res = await postRawRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/list",
      },
      { headers: { authorization: "Bearer missing-mcp-scope" } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; }; };
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("uses OAuth scopes for service authorization during tool invocation", async () => {
    const { gateway, env } = buildOAuthGateway();
    const reply = (await postRpc(
      gateway,
      env,
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: {
            operationId: "createInvoice",
            body: { total: 1234, currency: "USD" },
          },
        },
      },
      { headers: { authorization: "Bearer valid-billing" } },
    )) as { result: { content: { text: string; }[]; isError?: boolean; }; };
    const payload = JSON.parse(reply.result.content[0]!.text) as {
      status: number;
      body: { id: string; total: number; currency: string; };
    };
    expect(payload.status).toBe(201);
    expect(payload.body).toEqual({
      id: "inv_test",
      total: 1234,
      currency: "USD",
    });
    expect(reply.result.isError).toBeFalsy();
  });
});
