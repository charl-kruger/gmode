import {
  apiErrorJsonSchema,
  mergeServiceSpecs,
  type OpenApiDocument,
} from "@gmode/core";
import { fetchBindingGet, internalPathForEntry } from "./internal-fetch";
import type {
  GatewayRequestContext,
  GatewayServiceEntry,
} from "./types";

const DEFAULT_INTERNAL_PATH = "/__gmode/openapi.json";

/** A service whose OpenAPI document could not be fetched during aggregation. */
export type UnavailableOpenApiService = {
  serviceName: string;
  mount: string;
  reason: string;
};

async function fetchServiceSpec<Env>(
  entry: GatewayServiceEntry<Env>,
  env: Env,
  context: GatewayRequestContext<Env>,
): Promise<OpenApiDocument> {
  const defaultPath =
    typeof entry.config.openapi === "object" && entry.config.openapi.path
      ? entry.config.openapi.path
      : DEFAULT_INTERNAL_PATH;
  const path = internalPathForEntry(entry, defaultPath);

  // Optional dev URL override for web apps.
  const devUrl = entry.kind === "web" ? entry.web?.devUrl?.(env) : undefined;
  let res: Response;
  if (devUrl) {
    res = await fetch(new URL(path, devUrl).toString());
  } else {
    res = await fetchBindingGet(entry, env, defaultPath);
  }

  // Vite-backed web apps in local dev often reject binding probes (403) while
  // the same path works when routed through the gateway's public HTTP surface.
  if (!res.ok && entry.kind === "web" && entry.web?.openapi) {
    const publicPath = `${joinWebMount(entry.config.mount, entry.web.apiMount)}/openapi.json`;
    res = await fetch(new URL(publicPath, context.url.origin).toString());
  }

  if (!res.ok) {
    throw new Error(
      `Service "${entry.name}" OpenAPI fetch returned ${res.status}`,
    );
  }

  try {
    return (await res.json()) as OpenApiDocument;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Service "${entry.name}" OpenAPI JSON parse failed: ${message}`,
    );
  }
}

/** Join an app mount and its API sub-mount into a single OpenAPI path prefix. */
function joinWebMount(mount: string, apiMount: string): string {
  const left = mount === "/" ? "" : mount.replace(/\/$/, "");
  const right = apiMount === "/" ? "" : apiMount;
  return `${left}${right}` || "/";
}

/**
 * Fetch and merge internal OpenAPI documents from registered services.
 *
 * The gateway uses this for `/openapi.json`; integrators can call it when they
 * need the same aggregated document outside the normal route.
 *
 * Aggregation degrades gracefully: services whose spec fetch fails are listed
 * under the document's `x-gmode-unavailable` extension (and tagged as
 * unavailable) instead of failing the whole document.
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
  const unavailable: UnavailableOpenApiService[] = [];

  const enabled = input.services.filter((entry) =>
    entry.kind === "web" ? entry.web?.openapi === true : entry.config.openapi,
  );
  const results = await Promise.allSettled(
    enabled.map((entry) =>
      fetchServiceSpec(entry, input.context.env, input.context),
    ),
  );

  for (let i = 0; i < enabled.length; i++) {
    const entry = enabled[i]!;
    const result = results[i]!;
    if (result.status === "fulfilled") {
      // Web app API routes live under `<app mount><api mount>` publicly.
      const mount =
        entry.kind === "web" && entry.web
          ? joinWebMount(entry.config.mount, entry.web.apiMount)
          : entry.config.mount;
      services.push({
        serviceName: entry.name,
        mount,
        spec: applyApiVersionMetadata(result.value, entry),
      });
    } else {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      unavailable.push({
        serviceName: entry.name,
        mount: entry.config.mount,
        reason,
      });
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

  const merged = mergeServiceSpecs({
    base,
    services,
    injectErrorSchema: apiErrorJsonSchema,
  });

  if (unavailable.length > 0) {
    const doc = merged as OpenApiDocument & {
      "x-gmode-unavailable"?: UnavailableOpenApiService[];
      tags?: { name: string; description?: string }[];
    };
    doc["x-gmode-unavailable"] = unavailable;
    const tags = Array.isArray(doc.tags) ? doc.tags : [];
    for (const entry of unavailable) {
      tags.push({
        name: entry.serviceName,
        description: `Unavailable during aggregation: ${entry.reason}`,
      });
    }
    doc.tags = tags;
    return doc;
  }

  return merged;
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
