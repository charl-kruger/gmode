import { apiErrorJsonSchema, type OpenApiDocument } from "@gmode/core";
import { schemaToJsonSchema, type GModeSchema } from "./schema";
import type { RegisteredRoute } from "./types";

type ParamObject = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: Record<string, unknown>;
  description?: string;
};

function pathParamNames(path: string): string[] {
  const matches = path.match(/:([A-Za-z0-9_]+)/g) ?? [];
  return matches.map((m) => m.slice(1));
}

function honoToOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function joinPaths(basePath: string | undefined, path: string): string {
  if (!basePath) return path;
  if (path === "/") return basePath;
  return `${basePath}${path}`;
}

/**
 * Generate a stable operationId from method + path when a route omits one,
 * e.g. `GET /users/:id` -> `getUsersId`. MCP and client codegen skip
 * operations without a string operationId, so every route must have one.
 */
function generateOperationId(method: string, path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/^:/, ""))
    .map((segment) => segment.replace(/[^A-Za-z0-9]+/g, " ").trim())
    .filter(Boolean)
    .map((segment) =>
      segment
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(""),
    );
  return method.toLowerCase() + (segments.join("") || "Root");
}

function buildParams(
  location: "query" | "header",
  schema: GModeSchema | undefined,
): ParamObject[] {
  if (!schema) return [];
  const json = schemaToJsonSchema(schema);
  const properties =
    (json["properties"] as Record<string, Record<string, unknown>>) ?? {};
  const required = new Set((json["required"] as string[] | undefined) ?? []);
  const params: ParamObject[] = [];
  for (const [name, sub] of Object.entries(properties)) {
    params.push({
      name,
      in: location,
      required: required.has(name),
      schema: sub,
    });
  }
  return params;
}

function buildPathParams(
  path: string,
  schema: GModeSchema | undefined,
): ParamObject[] {
  const names = pathParamNames(path);
  if (!schema) {
    return names.map((name) => ({
      name,
      in: "path" as const,
      required: true,
      schema: { type: "string" },
    }));
  }
  const json = schemaToJsonSchema(schema);
  const properties =
    (json["properties"] as Record<string, Record<string, unknown>>) ?? {};
  return names.map((name) => ({
    name,
    in: "path" as const,
    required: true,
    schema: properties[name] ?? { type: "string" },
  }));
}

export function buildServiceOpenApi<Env>(input: {
  name: string;
  version: string;
  routes: RegisteredRoute<Env>[];
  basePath?: string;
}): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of input.routes) {
    const oasPath = honoToOpenApiPath(joinPaths(input.basePath, route.path));
    const parameters: ParamObject[] = [
      ...buildPathParams(route.path, route.config.params),
      ...buildParams("query", route.config.query),
      ...buildParams("header", route.config.headers),
    ];

    const responses: Record<string, unknown> = {};
    for (const [statusStr, schema] of Object.entries(
      route.config.responses,
    )) {
      const status = Number(statusStr);
      responses[statusStr] = {
        description: status >= 400 ? "Error" : "Success",
        content: {
          "application/json": {
            schema: schemaToJsonSchema(schema),
          },
        },
      };
    }

    const operation: Record<string, unknown> = {
      operationId:
        route.config.operationId ??
        generateOperationId(route.method, route.path),
      summary: route.config.summary,
      description: route.config.description,
      tags: route.config.tags,
      parameters,
      responses,
    };

    if (route.config.body) {
      operation["requestBody"] = {
        required: true,
        content: {
          "application/json": {
            schema: schemaToJsonSchema(route.config.body),
          },
        },
      };
    }

    if ((route.config.scopes?.length ?? 0) > 0) {
      operation["security"] = [{ GatewayContext: [] }];
      operation["x-gmode-scopes"] = route.config.scopes;
    }
    if ((route.config.permissions?.length ?? 0) > 0) {
      operation["x-gmode-permissions"] = route.config.permissions;
    }
    if (route.config.featureFlag) {
      const gate = route.config.featureFlag;
      operation["x-gmode-feature-flag"] =
        typeof gate === "string" ? gate : gate.key;
    }
    if (
      route.config.sensitiveFields &&
      route.config.sensitiveFields.length > 0
    ) {
      operation["x-gmode-sensitive"] = route.config.sensitiveFields;
    }
    if (route.config.shieldAction) {
      operation["x-gmode-shield-action"] = route.config.shieldAction;
    }

    paths[oasPath] = {
      ...(paths[oasPath] ?? {}),
      [route.method]: operation,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: input.name,
      version: input.version,
    },
    paths,
    components: {
      schemas: {
        ApiError: apiErrorJsonSchema,
      },
      securitySchemes: {
        GatewayContext: {
          type: "apiKey",
          in: "header",
          name: "x-gmode-context",
        },
      },
    },
  };
}
