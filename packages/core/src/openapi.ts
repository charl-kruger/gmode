export type OpenApiDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    [key: string]: unknown;
  };
  paths?: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ShieldDowngradeWarning = {
  path: string;
  method: string;
  parameter?: string | undefined;
  reason:
    | "anyOf-in-parameter"
    | "uniqueItems-stripped"
    | "null-type-converted"
    | "prefixItems-stripped";
};

export type ShieldDowngradeResult = {
  spec: OpenApiDocument;
  warnings: ShieldDowngradeWarning[];
};

const OPENAPI_HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
] as const;

type OpenApiHttpMethod = (typeof OPENAPI_HTTP_METHODS)[number];

const OPENAPI_HTTP_METHOD_SET = new Set<string>(OPENAPI_HTTP_METHODS);

export type OpenApiOperationKey = `${string} ${string}`;

export type OpenApiOperationSummary = {
  key: OpenApiOperationKey;
  method: Uppercase<OpenApiHttpMethod>;
  path: string;
  operationId?: string;
};

export type PruneOpenApiDocumentResult = {
  spec: OpenApiDocument;
  included: OpenApiOperationSummary[];
  removed: OpenApiOperationSummary[];
};

function joinPath(prefix: string, path: string): string {
  if (!prefix || prefix === "/") return path;
  const trimmedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (path === "/" || path === "") return trimmedPrefix;
  if (path.startsWith("/")) return trimmedPrefix + path;
  return `${trimmedPrefix}/${path}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type MergeServiceSpec = {
  serviceName: string;
  mount: string;
  spec: OpenApiDocument;
};

export function mergeServiceSpecs(input: {
  base: OpenApiDocument;
  services: MergeServiceSpec[];
  injectErrorSchema?: unknown;
}): OpenApiDocument {
  const result: OpenApiDocument = {
    ...input.base,
    paths: { ...(input.base.paths ?? {}) },
    components: {
      schemas: { ...(input.base.components?.schemas ?? {}) },
      securitySchemes: { ...(input.base.components?.securitySchemes ?? {}) },
    },
  };

  if (input.injectErrorSchema && result.components?.schemas) {
    result.components.schemas["ApiError"] = input.injectErrorSchema;
  }

  for (const svc of input.services) {
    const renames = new Map<string, string>();

    for (const [name, schema] of Object.entries(
      svc.spec.components?.schemas ?? {},
    )) {
      const existing = result.components?.schemas?.[name];
      if (existing === undefined) {
        result.components!.schemas![name] = schema;
        continue;
      }
      if (deepEqual(existing, schema)) continue;
      const renamed = `${svc.serviceName}_${name}`;
      result.components!.schemas![renamed] = schema;
      renames.set(name, renamed);
    }

    for (const [name, scheme] of Object.entries(
      svc.spec.components?.securitySchemes ?? {},
    )) {
      if (result.components!.securitySchemes![name] === undefined) {
        result.components!.securitySchemes![name] = scheme;
      }
    }

    const rewriteRefs = (value: unknown): unknown => {
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(rewriteRefs);
      const obj = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "$ref" && typeof v === "string") {
          const match = /^#\/components\/schemas\/(.+)$/.exec(v);
          if (match) {
            const original = match[1]!;
            const renamed = renames.get(original);
            next[k] = renamed
              ? `#/components/schemas/${renamed}`
              : v;
            continue;
          }
        }
        next[k] = rewriteRefs(v);
      }
      return next;
    };

    const operationIds = new Set<string>();
    for (const ops of Object.values(result.paths ?? {})) {
      for (const op of Object.values(ops)) {
        const id = (op as Record<string, unknown>)["operationId"];
        if (typeof id === "string") operationIds.add(id);
      }
    }

    for (const [path, ops] of Object.entries(svc.spec.paths ?? {})) {
      const finalPath = joinPath(svc.mount, path);
      const adjustedOps: Record<string, unknown> = {};
      for (const [method, op] of Object.entries(ops)) {
        const rewritten = rewriteRefs(op) as Record<string, unknown>;
        const opId = rewritten["operationId"];
        if (typeof opId === "string" && operationIds.has(opId)) {
          rewritten["operationId"] = `${svc.serviceName}_${opId}`;
        }
        if (typeof rewritten["operationId"] === "string") {
          operationIds.add(rewritten["operationId"] as string);
        }
        adjustedOps[method] = rewritten;
      }
      result.paths![finalPath] = {
        ...(result.paths![finalPath] ?? {}),
        ...adjustedOps,
      };
    }
  }

  return result;
}

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function listOpenApiOperations(
  spec: OpenApiDocument,
): OpenApiOperationSummary[] {
  const operations: OpenApiOperationSummary[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!OPENAPI_HTTP_METHOD_SET.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        continue;
      }
      const operationRecord = operation as Record<string, unknown>;
      const operationId = operationRecord["operationId"];
      const summary: OpenApiOperationSummary = {
        key: openApiOperationKey(method, path),
        method: method.toUpperCase() as Uppercase<OpenApiHttpMethod>,
        path,
      };
      if (typeof operationId === "string") {
        summary.operationId = operationId;
      }
      operations.push(summary);
    }
  }
  return operations;
}

export function openApiOperationKey(
  method: string,
  path: string,
): OpenApiOperationKey {
  return `${method.toUpperCase()} ${path}` as OpenApiOperationKey;
}

export function pruneOpenApiDocument(input: {
  spec: OpenApiDocument;
  operationKeys: Iterable<OpenApiOperationKey>;
}): PruneOpenApiDocumentResult {
  const selected = new Set(input.operationKeys);
  const source = cloneDeep(input.spec);
  const paths: NonNullable<OpenApiDocument["paths"]> = {};
  const included: OpenApiOperationSummary[] = [];
  const removed: OpenApiOperationSummary[] = [];
  const refs = new Set<string>();
  const securitySchemes = new Set<string>();

  collectSecuritySchemeNames(source["security"], securitySchemes);

  for (const [path, pathItem] of Object.entries(source.paths ?? {})) {
    const nextPathItem: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pathItem)) {
      if (!OPENAPI_HTTP_METHOD_SET.has(key.toLowerCase())) {
        nextPathItem[key] = value;
      }
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!OPENAPI_HTTP_METHOD_SET.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        continue;
      }
      const operationRecord = operation as Record<string, unknown>;
      const summary = operationSummary(path, method, operationRecord);
      if (!selected.has(summary.key)) {
        removed.push(summary);
        continue;
      }
      included.push(summary);
      nextPathItem[method] = operationRecord;
      collectRefs(operationRecord, refs);
      collectSecuritySchemeNames(operationRecord["security"], securitySchemes);
      collectRefs(nextPathItem["parameters"], refs);
    }

    const operationCount = Object.keys(nextPathItem).filter((key) =>
      OPENAPI_HTTP_METHOD_SET.has(key.toLowerCase()),
    ).length;
    if (operationCount > 0) {
      paths[path] = nextPathItem;
    }
  }

  const schemas = pruneSchemas(source.components?.schemas, refs);
  const nextComponents = pruneComponents({
    components: source.components,
    schemas,
    securitySchemes,
  });

  const pruned: OpenApiDocument = {
    ...source,
    paths,
  };
  if (nextComponents) {
    pruned.components = nextComponents;
  } else {
    delete pruned.components;
  }

  return { spec: pruned, included, removed };
}

function operationSummary(
  path: string,
  method: string,
  operation: Record<string, unknown>,
): OpenApiOperationSummary {
  const operationId = operation["operationId"];
  const summary: OpenApiOperationSummary = {
    key: openApiOperationKey(method, path),
    method: method.toUpperCase() as Uppercase<OpenApiHttpMethod>,
    path,
  };
  if (typeof operationId === "string") {
    summary.operationId = operationId;
  }
  return summary;
}

function collectRefs(value: unknown, refs: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref" && typeof child === "string") {
      refs.add(child);
      continue;
    }
    collectRefs(child, refs);
  }
}

function collectSecuritySchemeNames(
  value: unknown,
  names: Set<string>,
): void {
  if (!Array.isArray(value)) return;
  for (const requirement of value) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      continue;
    }
    for (const name of Object.keys(requirement)) {
      names.add(name);
    }
  }
}

function pruneSchemas(
  schemas: Record<string, unknown> | undefined,
  initialRefs: Set<string>,
): Record<string, unknown> | undefined {
  if (!schemas) return undefined;
  const selected = new Set<string>();
  const queue = [...initialRefs];

  while (queue.length > 0) {
    const ref = queue.shift()!;
    const name = schemaNameFromRef(ref);
    if (!name || selected.has(name)) continue;
    const schema = schemas[name];
    if (schema === undefined) continue;
    selected.add(name);
    const nested = new Set<string>();
    collectRefs(schema, nested);
    queue.push(...nested);
  }

  const pruned: Record<string, unknown> = {};
  for (const name of [...selected].sort()) {
    const schema = schemas[name];
    if (schema !== undefined) {
      pruned[name] = schema;
    }
  }
  return Object.keys(pruned).length > 0 ? pruned : undefined;
}

function schemaNameFromRef(ref: string): string | undefined {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return undefined;
  return decodeURIComponent(ref.slice(prefix.length));
}

function pruneComponents(input: {
  components: OpenApiDocument["components"] | undefined;
  schemas: Record<string, unknown> | undefined;
  securitySchemes: Set<string>;
}): OpenApiDocument["components"] | undefined {
  if (!input.components) return undefined;
  const next: NonNullable<OpenApiDocument["components"]> = {};
  for (const [key, value] of Object.entries(input.components)) {
    if (key !== "schemas" && key !== "securitySchemes") {
      next[key] = value;
    }
  }
  if (input.schemas) {
    next.schemas = input.schemas;
  }
  const securitySchemes = pruneSecuritySchemes(
    input.components.securitySchemes,
    input.securitySchemes,
  );
  if (securitySchemes) {
    next.securitySchemes = securitySchemes;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function pruneSecuritySchemes(
  schemes: Record<string, unknown> | undefined,
  selected: Set<string>,
): Record<string, unknown> | undefined {
  if (!schemes) return undefined;
  const pruned: Record<string, unknown> = {};
  for (const name of [...selected].sort()) {
    const scheme = schemes[name];
    if (scheme !== undefined) {
      pruned[name] = scheme;
    }
  }
  return Object.keys(pruned).length > 0 ? pruned : undefined;
}

function downgradeSchema(
  schema: unknown,
  warnings: ShieldDowngradeWarning[],
  meta: { path: string; method: string; parameter?: string | undefined },
  options: { stripAnyOf: boolean },
): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) =>
      downgradeSchema(item, warnings, meta, options),
    );
  }
  const obj = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };

  if (Array.isArray(out["type"]) && out["type"].includes("null")) {
    const nonNull = (out["type"] as string[]).filter((t) => t !== "null");
    out["type"] = nonNull.length === 1 ? nonNull[0]! : nonNull;
    out["nullable"] = true;
    warnings.push({ ...meta, reason: "null-type-converted" });
  }

  if ("uniqueItems" in out) {
    delete out["uniqueItems"];
    warnings.push({ ...meta, reason: "uniqueItems-stripped" });
  }

  if ("prefixItems" in out) {
    delete out["prefixItems"];
    warnings.push({ ...meta, reason: "prefixItems-stripped" });
  }

  if (options.stripAnyOf && Array.isArray(out["anyOf"])) {
    const variants = out["anyOf"] as unknown[];
    if (variants.length > 0) {
      const first = variants[0];
      delete out["anyOf"];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        for (const [k, v] of Object.entries(
          first as Record<string, unknown>,
        )) {
          if (!(k in out)) out[k] = v;
        }
      }
      warnings.push({ ...meta, reason: "anyOf-in-parameter" });
    } else {
      delete out["anyOf"];
    }
  }

  for (const key of Object.keys(out)) {
    if (key === "anyOf" || key === "oneOf" || key === "allOf") {
      const arr = out[key];
      if (Array.isArray(arr)) {
        out[key] = arr.map((item) =>
          downgradeSchema(item, warnings, meta, options),
        );
      }
      continue;
    }
    if (
      key === "properties" ||
      key === "patternProperties" ||
      key === "definitions"
    ) {
      const props = out[key] as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [propName, propValue] of Object.entries(props)) {
        next[propName] = downgradeSchema(
          propValue,
          warnings,
          meta,
          options,
        );
      }
      out[key] = next;
      continue;
    }
    if (key === "items" || key === "additionalProperties") {
      out[key] = downgradeSchema(out[key], warnings, meta, options);
      continue;
    }
  }

  return out;
}

export function toShieldCompatibleSpec(
  spec: OpenApiDocument,
): ShieldDowngradeResult {
  const out = cloneDeep(spec);
  const warnings: ShieldDowngradeWarning[] = [];

  out.openapi = "3.0.3";

  for (const [path, ops] of Object.entries(out.paths ?? {})) {
    for (const [method, opUnknown] of Object.entries(ops)) {
      const op = opUnknown as Record<string, unknown>;

      const params = op["parameters"];
      if (Array.isArray(params)) {
        op["parameters"] = params.map((paramUnknown) => {
          const param = paramUnknown as Record<string, unknown>;
          if (!param["schema"]) return param;
          const downgraded = downgradeSchema(
            param["schema"],
            warnings,
            {
              path,
              method,
              parameter: param["name"] as string | undefined,
            },
            { stripAnyOf: true },
          );
          return { ...param, schema: downgraded };
        });
      }

      const requestBody = op["requestBody"] as
        | { content?: Record<string, { schema?: unknown }> }
        | undefined;
      if (requestBody?.content) {
        for (const mediaType of Object.keys(requestBody.content)) {
          const entry = requestBody.content[mediaType]!;
          if (entry.schema) {
            entry.schema = downgradeSchema(
              entry.schema,
              warnings,
              { path, method },
              { stripAnyOf: false },
            );
          }
        }
      }

      const responses = op["responses"];
      if (responses && typeof responses === "object") {
        for (const status of Object.keys(responses)) {
          const response = (responses as Record<string, unknown>)[status] as
            | { content?: Record<string, { schema?: unknown }> }
            | undefined;
          if (response?.content) {
            for (const mediaType of Object.keys(response.content)) {
              const entry = response.content[mediaType]!;
              if (entry.schema) {
                entry.schema = downgradeSchema(
                  entry.schema,
                  warnings,
                  { path, method },
                  { stripAnyOf: false },
                );
              }
            }
          }
        }
      }
    }
  }

  for (const name of Object.keys(out.components?.schemas ?? {})) {
    out.components!.schemas![name] = downgradeSchema(
      out.components!.schemas![name],
      warnings,
      { path: `#/components/schemas/${name}`, method: "schema" },
      { stripAnyOf: false },
    );
  }

  return { spec: out, warnings };
}
