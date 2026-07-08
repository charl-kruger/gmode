import {
  apiErrorJsonSchema,
  mergeServiceSpecs,
  type FetcherLike,
  type OpenApiDocument,
} from "@gmode/core";
import type {
  GatewayRequestContext,
  GatewayServiceEntry,
} from "./types";

const DEFAULT_INTERNAL_PATH = "/__gmode/openapi.json";

function isFetcherLike(value: unknown): value is FetcherLike {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["fetch"] === "function";
}

/**
 * Fetch and merge internal OpenAPI documents from registered services.
 *
 * The gateway uses this for `/openapi.json`; integrators can call it when they
 * need the same aggregated document outside the normal route.
 */
export async function aggregateOpenApi<Env>(input: {
  /** Current gateway request context. */
  context: GatewayRequestContext<Env>;
  /** Gateway Worker env bindings. */
  env: Env;
  /** Gateway name/version metadata for the merged document. */
  gateway: { name: string; version: string };
  /** Registered services to include when `openapi` is enabled. */
  services: GatewayServiceEntry<Env>[];
}): Promise<OpenApiDocument> {
  const services: {
    serviceName: string;
    mount: string;
    spec: OpenApiDocument;
  }[] = [];

  for (const entry of input.services) {
    if (!entry.config.openapi) continue;
    const path =
      typeof entry.config.openapi === "object" && entry.config.openapi.path
        ? entry.config.openapi.path
        : DEFAULT_INTERNAL_PATH;

    const binding = (input.context.env as Record<string, unknown>)[
      entry.config.binding
    ];
    if (!isFetcherLike(binding)) {
      throw new Error(
        `Service binding "${entry.config.binding}" is not configured`,
      );
    }

    const url = new URL(path, "https://internal.gmode");
    const req = new Request(url.toString(), { method: "GET" });
    const res = await binding.fetch(req);
    if (!res.ok) {
      throw new Error(
        `Service "${entry.name}" OpenAPI fetch returned ${res.status}`,
      );
    }

    try {
      const spec = (await res.json()) as OpenApiDocument;
      services.push({
        serviceName: entry.name,
        mount: entry.config.mount,
        spec: applyApiVersionMetadata(spec, entry),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Service "${entry.name}" OpenAPI JSON parse failed: ${message}`,
      );
    }
  }

  const base: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: input.gateway.name,
      version: input.gateway.version,
    },
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
    },
  };

  return mergeServiceSpecs({
    base,
    services,
    injectErrorSchema: apiErrorJsonSchema,
  });
}

function applyApiVersionMetadata<Env>(
  spec: OpenApiDocument,
  entry: GatewayServiceEntry<Env>,
): OpenApiDocument {
  if (!entry.apiVersion) return spec;

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const nextPathItem: Record<string, unknown> = {};
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isOpenApiOperation(operation)) {
        nextPathItem[method] = operation;
        continue;
      }

      const nextOperation: Record<string, unknown> = {
        ...operation,
        "x-gmode-api-version": entry.apiVersion.name,
      };
      if (entry.apiVersion.deprecated) {
        nextOperation.deprecated = true;
        nextOperation["x-gmode-deprecated-version"] = true;
        if (typeof entry.apiVersion.deprecated === "object") {
          const deprecation = entry.apiVersion.deprecated;
          if (deprecation.sunset) {
            nextOperation["x-gmode-sunset"] = deprecation.sunset;
          }
          if (deprecation.link) {
            nextOperation["x-gmode-deprecation-link"] = deprecation.link;
          }
          if (deprecation.message) {
            nextOperation["x-gmode-deprecation-message"] =
              deprecation.message;
          }
        }
      }
      nextPathItem[method] = nextOperation;
    }
    paths[path] = nextPathItem;
  }

  return {
    ...spec,
    paths,
  };
}

function isOpenApiOperation(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function swaggerUiHtml(specUrl: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
    />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(specUrl)},
          dom_id: "#swagger-ui",
          deepLinking: true,
        });
      };
    </script>
  </body>
</html>`;
}

export function scalarUiHtml(specUrl: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: ${JSON.stringify(specUrl)}
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
