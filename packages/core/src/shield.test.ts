import { describe, expect, it } from "vitest";
import {
  listOpenApiOperations,
  openApiOperationKey,
  pruneOpenApiDocument,
  toShieldCompatibleSpec,
} from "./openapi";
import { redact } from "./redact";

describe("toShieldCompatibleSpec", () => {
  it("downgrades the openapi version to 3.0.3", () => {
    const { spec } = toShieldCompatibleSpec({
      openapi: "3.1.0",
      info: { title: "T", version: "1.0.0" },
      paths: {},
    });
    expect(spec.openapi).toBe("3.0.3");
  });

  it("collapses anyOf in parameter schemas and reports a warning", () => {
    const { spec, warnings } = toShieldCompatibleSpec({
      openapi: "3.1.0",
      info: { title: "T", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: {
                  anyOf: [{ type: "string" }, { type: "number" }],
                },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });
    const param = (
      spec.paths!["/users/{id}"]!["get"] as {
        parameters: { name: string; schema: Record<string, unknown> }[];
      }
    ).parameters[0]!;
    expect(param.schema.type).toBe("string");
    expect(param.schema["anyOf"]).toBeUndefined();
    expect(warnings.some((w) => w.reason === "anyOf-in-parameter")).toBe(true);
  });

  it("strips uniqueItems from arrays", () => {
    const { spec, warnings } = toShieldCompatibleSpec({
      openapi: "3.1.0",
      info: { title: "T", version: "1.0.0" },
      paths: {
        "/list": {
          get: {
            operationId: "list",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      uniqueItems: true,
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const schema = (
      (spec.paths!["/list"]!["get"] as Record<string, unknown>)[
        "responses"
      ] as Record<string, { content: Record<string, { schema: unknown }> }>
    )["200"]!.content["application/json"]!.schema as Record<string, unknown>;
    expect(schema["uniqueItems"]).toBeUndefined();
    expect(warnings.some((w) => w.reason === "uniqueItems-stripped")).toBe(
      true,
    );
  });

  it("converts type: ['string','null'] to nullable: true", () => {
    const { spec, warnings } = toShieldCompatibleSpec({
      openapi: "3.1.0",
      info: { title: "T", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          Nullable: {
            type: ["string", "null"],
          },
        },
      },
    });
    const sch = spec.components!.schemas!["Nullable"] as Record<
      string,
      unknown
    >;
    expect(sch["type"]).toBe("string");
    expect(sch["nullable"]).toBe(true);
    expect(warnings.some((w) => w.reason === "null-type-converted")).toBe(
      true,
    );
  });
});

describe("OpenAPI Shield pruning", () => {
  it("lists public operation keys", () => {
    const operations = listOpenApiOperations({
      openapi: "3.0.3",
      info: { title: "T", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          parameters: [{ name: "id", in: "path" }],
          get: { operationId: "getUser", responses: {} },
        },
      },
    });

    expect(operations).toEqual([
      {
        key: "GET /users/{id}",
        method: "GET",
        path: "/users/{id}",
        operationId: "getUser",
      },
    ]);
  });

  it("prunes unselected operations and unused schemas", () => {
    const result = pruneOpenApiDocument({
      spec: {
        openapi: "3.0.3",
        info: { title: "T", version: "1.0.0" },
        paths: {
          "/users/{id}": {
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            get: {
              operationId: "getUser",
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/User" },
                    },
                  },
                },
              },
            },
            delete: {
              operationId: "deleteUser",
              responses: {
                "204": { description: "ok" },
              },
            },
          },
        },
        components: {
          schemas: {
            User: {
              type: "object",
              properties: {
                profile: { $ref: "#/components/schemas/Profile" },
              },
            },
            Profile: {
              type: "object",
              properties: {
                displayName: { type: "string" },
              },
            },
            Unused: {
              type: "object",
            },
          },
        },
      },
      operationKeys: [openApiOperationKey("GET", "/users/{id}")],
    });

    expect(Object.keys(result.spec.paths ?? {})).toEqual(["/users/{id}"]);
    expect(result.spec.paths?.["/users/{id}"]?.["get"]).toBeDefined();
    expect(result.spec.paths?.["/users/{id}"]?.["delete"]).toBeUndefined();
    expect(result.spec.components?.schemas).toEqual({
      Profile: {
        type: "object",
        properties: {
          displayName: { type: "string" },
        },
      },
      User: {
        type: "object",
        properties: {
          profile: { $ref: "#/components/schemas/Profile" },
        },
      },
    });
    expect(result.included.map((operation) => operation.key)).toEqual([
      "GET /users/{id}",
    ]);
    expect(result.removed.map((operation) => operation.key)).toEqual([
      "DELETE /users/{id}",
    ]);
  });

  it("prunes unused security schemes", () => {
    const result = pruneOpenApiDocument({
      spec: {
        openapi: "3.0.3",
        info: { title: "T", version: "1.0.0" },
        paths: {
          "/secure": {
            get: {
              operationId: "secure",
              security: [{ bearerAuth: [] }],
              responses: { "200": { description: "ok" } },
            },
          },
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
            unusedAuth: { type: "apiKey", name: "x-key", in: "header" },
          },
        },
      },
      operationKeys: [openApiOperationKey("GET", "/secure")],
    });

    expect(result.spec.components?.securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer" },
    });
  });
});

describe("redact", () => {
  it("redacts a single top-level field", () => {
    const result = redact({ id: "u1", email: "u@x.com" }, ["email"]);
    expect(result).toEqual({ id: "u1", email: "[REDACTED]" });
  });

  it("redacts a nested field via dot path", () => {
    const result = redact(
      { id: "u1", profile: { ssn: "111-22-3333", name: "Jane" } },
      ["profile.ssn"],
    );
    expect(result).toEqual({
      id: "u1",
      profile: { ssn: "[REDACTED]", name: "Jane" },
    });
  });

  it("respects custom placeholder", () => {
    const result = redact({ ssn: "111" }, ["ssn"], { placeholder: "***" });
    expect(result).toEqual({ ssn: "***" });
  });

  it("removes keys when removeKeys is true", () => {
    const result = redact({ ssn: "111", name: "x" }, ["ssn"], {
      removeKeys: true,
    });
    expect(result).toEqual({ name: "x" });
  });

  it("walks into arrays of objects", () => {
    const result = redact(
      { users: [{ id: "u1", ssn: "1" }, { id: "u2", ssn: "2" }] },
      ["users.ssn"],
    );
    expect(result).toEqual({
      users: [
        { id: "u1", ssn: "[REDACTED]" },
        { id: "u2", ssn: "[REDACTED]" },
      ],
    });
  });
});
