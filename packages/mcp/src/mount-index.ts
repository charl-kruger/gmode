import type { OpenApiDocument } from "@gmode/core";
import type { GatewayInternalsHandle } from "@gmode/gateway";
import type {
  McpOperationEntry,
  McpServerCatalog,
  ResolvedMcpOptions,
} from "./types";

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
]);

function normalizeMount(mount: string): string {
  if (mount === "/" || mount === "") return "/";
  return mount.endsWith("/") ? mount.slice(0, -1) : mount;
}

function matchMount<Env>(
  pathname: string,
  services: GatewayInternalsHandle<Env>["services"],
): { name: string; mount: string; binding: string } | null {
  const sorted = [...services].sort(
    (a, b) => b.config.mount.length - a.config.mount.length,
  );
  for (const svc of sorted) {
    const mount = normalizeMount(svc.config.mount);
    if (mount === "/") {
      return {
        name: svc.name,
        mount: svc.config.mount,
        binding: "binding" in svc.config ? svc.config.binding : svc.name,
      };
    }
    if (pathname === mount || pathname.startsWith(`${mount}/`)) {
      return {
        name: svc.name,
        mount: svc.config.mount,
        binding: "binding" in svc.config ? svc.config.binding : svc.name,
      };
    }
  }
  return null;
}

function stripMount(pathname: string, mount: string): string {
  const normalized = normalizeMount(mount);
  if (normalized === "/") return pathname;
  const remainder = pathname.slice(normalized.length);
  return remainder === "" ? "/" : remainder;
}

/** Convert a glob pattern (with `*` and `?`) into a RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expanded = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${expanded}$`);
}

function operationMatchesPatterns(
  operationId: string,
  patterns: string[],
): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((p) => globToRegExp(p).test(operationId));
}

function synthesizeInputSchema(
  parameters: Array<Record<string, unknown>>,
  requestBodySchema?: Record<string, unknown>,
): Record<string, unknown> {
  const groups: Record<
    "params" | "query" | "headers",
    { props: Record<string, unknown>; required: string[] }
  > = {
    params: { props: {}, required: [] },
    query: { props: {}, required: [] },
    headers: { props: {}, required: [] },
  };

  for (const p of parameters) {
    const loc = p["in"];
    const name = p["name"];
    if (typeof loc !== "string" || typeof name !== "string") continue;
    const target =
      loc === "path"
        ? "params"
        : loc === "query"
          ? "query"
          : loc === "header"
            ? "headers"
            : null;
    if (!target) continue;
    const schema = (p["schema"] as Record<string, unknown>) ?? {
      type: "string",
    };
    groups[target].props[name] = {
      ...schema,
      ...(typeof p["description"] === "string"
        ? { description: p["description"] }
        : {}),
    };
    if (p["required"] === true) groups[target].required.push(name);
  }

  const properties: Record<string, unknown> = {};

  if (Object.keys(groups.params.props).length > 0) {
    properties["params"] = {
      type: "object",
      properties: groups.params.props,
      ...(groups.params.required.length > 0
        ? { required: groups.params.required }
        : {}),
    };
  }
  if (Object.keys(groups.query.props).length > 0) {
    properties["query"] = {
      type: "object",
      properties: groups.query.props,
      ...(groups.query.required.length > 0
        ? { required: groups.query.required }
        : {}),
    };
  }
  if (Object.keys(groups.headers.props).length > 0) {
    properties["headers"] = {
      type: "object",
      properties: groups.headers.props,
      ...(groups.headers.required.length > 0
        ? { required: groups.headers.required }
        : {}),
    };
  }
  if (requestBodySchema) {
    properties["body"] = requestBodySchema;
  }

  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

function extractRequestBodySchema(
  op: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const rb = op["requestBody"];
  if (!rb || typeof rb !== "object") return undefined;
  const content = (rb as { content?: Record<string, unknown> }).content;
  if (!content) return undefined;
  const json = content["application/json"];
  if (!json || typeof json !== "object") return undefined;
  const schema = (json as { schema?: Record<string, unknown> }).schema;
  if (!schema || typeof schema !== "object") return undefined;
  return schema;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Walk the aggregated OpenAPI document, reverse-map every operation to its
 * owning service mount + binding, and collect the metadata MCP needs to
 * advertise and dispatch tools. Applies include/exclude globs against the
 * operationId (post gateway collision-rewriting).
 */
export function buildMountIndex<Env>(input: {
  spec: OpenApiDocument;
  internals: GatewayInternalsHandle<Env>;
  options: ResolvedMcpOptions<Env>;
}): McpServerCatalog {
  const operations: McpOperationEntry[] = [];

  for (const [path, ops] of Object.entries(input.spec.paths ?? {})) {
    const match = matchMount(path, input.internals.services);
    if (!match) continue;

    const relativePath = stripMount(path, match.mount);

    for (const [methodLower, opUnknown] of Object.entries(ops)) {
      if (!HTTP_METHODS.has(methodLower.toLowerCase())) continue;
      const op = opUnknown as Record<string, unknown>;
      const operationId = op["operationId"];
      if (typeof operationId !== "string") continue;

      if (
        input.options.exclude.length > 0 &&
        operationMatchesPatterns(operationId, input.options.exclude)
      ) {
        continue;
      }
      if (
        input.options.include.length > 0 &&
        !operationMatchesPatterns(operationId, input.options.include)
      ) {
        continue;
      }

      const parameters = Array.isArray(op["parameters"])
        ? (op["parameters"] as Array<Record<string, unknown>>)
        : [];
      const requestBodySchema = extractRequestBodySchema(op);
      const inputSchema = synthesizeInputSchema(
        parameters,
        requestBodySchema,
      );

      const entry: McpOperationEntry = {
        operationId,
        serviceName: match.name,
        mount: match.mount,
        binding: match.binding,
        method: methodLower.toUpperCase() as McpOperationEntry["method"],
        path: relativePath,
        inputSchema,
      };
      if (typeof op["summary"] === "string") {
        entry.summary = op["summary"];
      }
      if (typeof op["description"] === "string") {
        entry.description = op["description"];
      }
      const tags = arrayOfStrings(op["tags"]);
      if (tags.length > 0) entry.tags = tags;

      const scopes = arrayOfStrings(op["x-gmode-scopes"]);
      if (scopes.length > 0) entry.scopes = scopes;
      const perms = arrayOfStrings(op["x-gmode-permissions"]);
      if (perms.length > 0) entry.permissions = perms;
      if (typeof op["x-gmode-feature-flag"] === "string") {
        entry.featureFlag = op["x-gmode-feature-flag"];
      }

      operations.push(entry);
    }
  }

  return { spec: input.spec, operations };
}

/** Resolve an operationId back to its catalog entry, for `tools/call` dispatch. */
export function findOperation(
  catalog: McpServerCatalog,
  operationId: string,
): McpOperationEntry | undefined {
  return catalog.operations.find((o) => o.operationId === operationId);
}
