import { describe, expect, it } from "vitest";
import type { GatewayInternalsHandle } from "@gmode/gateway";
import { buildMountIndex } from "./mount-index";
import type { ResolvedMcpOptions } from "./types";

function options(
  partial: Partial<ResolvedMcpOptions> = {},
): ResolvedMcpOptions {
  return {
    path: "/mcp",
    mode: "catalog",
    serverInfo: { name: "T", version: "1.0.0" },
    include: [],
    exclude: [],
    maxToolsInToolsMode: 100,
    ...partial,
  };
}

function makeInternals<Env = unknown>(
  services: Array<{
    name: string;
    mount: `/${string}`;
    binding: string;
    auth?: boolean;
    scopes?: string[];
  }>,
): GatewayInternalsHandle<Env> {
  return {
    services: services.map((s) => ({
      name: s.name,
      config: {
        mount: s.mount,
        binding: s.binding as never,
        ...(s.auth !== undefined ? { auth: s.auth } : {}),
        ...(s.scopes ? { scopes: s.scopes } : {}),
      },
    })),
    defaults: {
      auth: false,
      scopes: [],
      permissions: [],
      requestIdHeader: "x-request-id",
      openapiPath: "/openapi.json",
      swaggerPath: "/docs",
      indexPath: "/",
      tokenTtlSeconds: 60,
      basePath: "",
    },
    signingSecret: "test-secret",
  };
}

const SPEC_USERS_BILLING = {
  openapi: "3.1.0",
  info: { title: "Test", version: "1.0.0" },
  paths: {
    "/users/{id}": {
      get: {
        operationId: "getUser",
        summary: "Get a user",
        tags: ["Users"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { "200": { description: "ok" } },
        "x-gmode-scopes": ["users:read"],
      },
    },
    "/users": {
      get: {
        operationId: "listUsers",
        summary: "List users",
        tags: ["Users"],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer" },
          },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
    "/billing/invoices": {
      post: {
        operationId: "createInvoice",
        summary: "Create an invoice",
        tags: ["Billing"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["total", "currency"],
                properties: {
                  total: { type: "integer" },
                  currency: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "ok" } },
        "x-gmode-scopes": ["billing:write"],
        "x-gmode-feature-flag": "billing-enabled",
      },
    },
  },
} as const;

describe("buildMountIndex", () => {
  it("indexes every operation against its owning service", () => {
    const internals = makeInternals([
      { name: "users", mount: "/users", binding: "USERS_API" },
      { name: "billing", mount: "/billing", binding: "BILLING_API" },
    ]);
    const catalog = buildMountIndex({
      spec: SPEC_USERS_BILLING,
      internals,
      options: options(),
    });
    expect(catalog.operations).toHaveLength(3);

    const getUser = catalog.operations.find(
      (o) => o.operationId === "getUser",
    );
    expect(getUser).toBeDefined();
    expect(getUser!.serviceName).toBe("users");
    expect(getUser!.mount).toBe("/users");
    expect(getUser!.binding).toBe("USERS_API");
    expect(getUser!.method).toBe("GET");
    expect(getUser!.path).toBe("/{id}");
    expect(getUser!.scopes).toEqual(["users:read"]);
  });

  it("picks the longest-prefix mount when multiple match", () => {
    const internals = makeInternals([
      { name: "root", mount: "/", binding: "ROOT" },
      { name: "users", mount: "/users", binding: "USERS_API" },
    ]);
    const catalog = buildMountIndex({
      spec: SPEC_USERS_BILLING,
      internals,
      options: options(),
    });
    const getUser = catalog.operations.find(
      (o) => o.operationId === "getUser",
    );
    expect(getUser!.serviceName).toBe("users");
  });

  it("propagates x-gmode-feature-flag and synthesizes a body schema", () => {
    const internals = makeInternals([
      { name: "billing", mount: "/billing", binding: "BILLING_API" },
    ]);
    const catalog = buildMountIndex({
      spec: SPEC_USERS_BILLING,
      internals,
      options: options(),
    });
    const create = catalog.operations.find(
      (o) => o.operationId === "createInvoice",
    );
    expect(create!.featureFlag).toBe("billing-enabled");
    expect(create!.inputSchema).toMatchObject({
      type: "object",
      properties: {
        body: { type: "object", required: ["total", "currency"] },
      },
    });
  });

  it("respects include/exclude glob patterns", () => {
    const internals = makeInternals([
      { name: "users", mount: "/users", binding: "USERS_API" },
      { name: "billing", mount: "/billing", binding: "BILLING_API" },
    ]);
    const onlyUsers = buildMountIndex({
      spec: SPEC_USERS_BILLING,
      internals,
      options: options({ include: ["getUser", "listUsers"] }),
    });
    expect(onlyUsers.operations.map((o) => o.operationId).sort()).toEqual(
      ["getUser", "listUsers"],
    );

    const noBilling = buildMountIndex({
      spec: SPEC_USERS_BILLING,
      internals,
      options: options({ exclude: ["create*"] }),
    });
    expect(
      noBilling.operations.find((o) => o.operationId === "createInvoice"),
    ).toBeUndefined();
  });

  it("skips operations with no operationId", () => {
    const internals = makeInternals([
      { name: "x", mount: "/x", binding: "X" },
    ]);
    const catalog = buildMountIndex({
      spec: {
        openapi: "3.1.0",
        info: { title: "T", version: "1.0.0" },
        paths: {
          "/x/thing": { get: { responses: { "200": { description: "ok" } } } },
        },
      },
      internals,
      options: options(),
    });
    expect(catalog.operations).toHaveLength(0);
  });
});
