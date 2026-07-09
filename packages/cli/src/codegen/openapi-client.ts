/**
 * OpenAPI 3.x -> typed TypeScript client generator.
 *
 * Produces a single self-contained file (zero runtime dependencies) with:
 * - named types for every `components.schemas` entry
 * - one typed method per operation, keyed by operationId
 * - a tiny fetch runtime with structured `ApiClientError`s
 */

type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  description?: string;
};

type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: JsonSchema;
  description?: string;
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JsonSchema }>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: JsonSchema }> }
  >;
};

type OpenApiDoc = {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>;
  components?: { schemas?: Record<string, JsonSchema> };
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function sanitizeTypeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `T${cleaned}` : cleaned;
}

function sanitizeMethodName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_$]/g, "_");
  return /^[0-9]/.test(cleaned) ? `op${cleaned}` : cleaned;
}

function refName(ref: string): string {
  const last = ref.split("/").pop() ?? "unknown";
  return sanitizeTypeName(last);
}

/** Convert a JSON schema fragment to a TypeScript type expression. */
function schemaToType(schema: JsonSchema | undefined, depth = 0): string {
  if (!schema || depth > 12) return "unknown";
  if (schema.$ref) return refName(schema.$ref);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ") || "never";
  }
  if (schema.allOf && schema.allOf.length > 0) {
    return schema.allOf.map((s) => schemaToType(s, depth + 1)).join(" & ");
  }
  const union = schema.oneOf ?? schema.anyOf;
  if (union && union.length > 0) {
    return union.map((s) => schemaToType(s, depth + 1)).join(" | ");
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];

  const render = (t: string): string => {
    switch (t) {
      case "string":
        return "string";
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return `${wrap(schemaToType(schema.items, depth + 1))}[]`;
      case "object": {
        const props = schema.properties ?? {};
        const required = new Set(schema.required ?? []);
        const fields = Object.entries(props).map(([key, value]) => {
          const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
            ? key
            : JSON.stringify(key);
          const optional = required.has(key) ? "" : "?";
          return `${safeKey}${optional}: ${schemaToType(value, depth + 1)}`;
        });
        const extra =
          schema.additionalProperties === true
            ? ["[key: string]: unknown"]
            : typeof schema.additionalProperties === "object"
              ? [
                  `[key: string]: ${schemaToType(schema.additionalProperties, depth + 1)}`,
                ]
              : [];
        const all = [...fields, ...extra];
        return all.length > 0 ? `{ ${all.join("; ")} }` : "Record<string, unknown>";
      }
      default:
        return "unknown";
    }
  };

  const wrap = (t: string): string => (t.includes("|") || t.includes("&") ? `(${t})` : t);

  let rendered: string;
  if (types.length === 0) {
    rendered = schema.properties ? render("object") : "unknown";
  } else {
    rendered = types.map(render).join(" | ");
  }
  if (schema.nullable && !rendered.includes("null")) {
    rendered = `${rendered} | null`;
  }
  return rendered;
}

function jsonResponseSchema(
  op: OpenApiOperation,
): { status: string; schema: JsonSchema | undefined } | null {
  const responses = op.responses ?? {};
  const successCodes = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort();
  const code = successCodes[0];
  if (!code) return null;
  const content = responses[code]?.content ?? {};
  const media =
    content["application/json"] ??
    Object.entries(content).find(([type]) => type.includes("json"))?.[1];
  return { status: code, schema: media?.schema };
}

type GeneratedOperation = {
  methodName: string;
  httpMethod: string;
  path: string;
  summary: string;
  pathParams: OpenApiParameter[];
  queryParams: OpenApiParameter[];
  bodySchema: JsonSchema | undefined;
  bodyRequired: boolean;
  responseType: string;
};

export function generateClientSource(specInput: unknown): {
  source: string;
  operationCount: number;
  title: string;
} {
  const spec = specInput as OpenApiDoc;
  const title = spec.info?.title ?? "API";
  const schemas = spec.components?.schemas ?? {};

  const typeDefs = Object.entries(schemas)
    .map(([name, schema]) => {
      const doc = schema.description
        ? `/** ${schema.description.replace(/\*\//g, "*\\/")} */\n`
        : "";
      return `${doc}export type ${sanitizeTypeName(name)} = ${schemaToType(schema)};`;
    })
    .join("\n\n");

  const operations: GeneratedOperation[] = [];
  const seen = new Set<string>();
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | OpenApiOperation
        | undefined;
      if (!op || typeof op !== "object") continue;
      const baseName = sanitizeMethodName(
        op.operationId ?? `${method}${path.replace(/[/{}]/g, "_")}`,
      );
      let methodName = baseName;
      let counter = 2;
      while (seen.has(methodName)) {
        methodName = `${baseName}${counter++}`;
      }
      seen.add(methodName);

      const params = op.parameters ?? [];
      const responseInfo = jsonResponseSchema(op);
      operations.push({
        methodName,
        httpMethod: method.toUpperCase(),
        path,
        summary: op.summary ?? op.description ?? "",
        pathParams: params.filter((p) => p.in === "path"),
        queryParams: params.filter((p) => p.in === "query"),
        bodySchema: op.requestBody?.content?.["application/json"]?.schema,
        bodyRequired: op.requestBody?.required ?? false,
        responseType: responseInfo?.schema
          ? schemaToType(responseInfo.schema)
          : "unknown",
      });
    }
  }

  const methods = operations
    .map((op) => {
      const argFields: string[] = [];
      if (op.pathParams.length > 0) {
        const fields = op.pathParams
          .map((p) => `${JSON.stringify(p.name).slice(1, -1)}: string | number`)
          .join("; ");
        argFields.push(`params: { ${fields} }`);
      }
      if (op.queryParams.length > 0) {
        const fields = op.queryParams
          .map(
            (p) =>
              `${/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p.name) ? p.name : JSON.stringify(p.name)}${p.required ? "" : "?"}: ${schemaToType(p.schema)}`,
          )
          .join("; ");
        argFields.push(`query${op.queryParams.every((p) => !p.required) ? "?" : ""}: { ${fields} }`);
      }
      if (op.bodySchema) {
        argFields.push(
          `body${op.bodyRequired ? "" : "?"}: ${schemaToType(op.bodySchema)}`,
        );
      }
      const hasArgs = argFields.length > 0;
      const allOptional =
        op.pathParams.length === 0 &&
        !op.bodyRequired &&
        op.queryParams.every((p) => !p.required);
      const argsType = hasArgs
        ? `args${allOptional ? "?" : ""}: { ${argFields.join("; ")}; init?: RequestInit }`
        : "args?: { init?: RequestInit }";

      const doc = op.summary ? `  /** ${op.summary.replace(/\*\//g, "*\\/")} */\n` : "";
      return `${doc}  ${op.methodName}(${argsType}): Promise<${op.responseType}> {
    return this.request(${JSON.stringify(op.httpMethod)}, ${JSON.stringify(op.path)}, args as RequestArgs);
  }`;
    })
    .join("\n\n");

  const source = `// Code generated by \`gmode generate client\` from "${title}". DO NOT EDIT.
/* eslint-disable */

${typeDefs || "// No component schemas in the source document."}

/** Structured error thrown for non-2xx responses. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ClientOptions = {
  /** Base URL of the gateway, e.g. "https://api.example.com". */
  baseUrl: string;
  /** Static headers or an async factory (e.g. for bearer tokens). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Custom fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
};

type RequestArgs = {
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  init?: RequestInit;
};

class ClientCore {
  protected readonly options: ClientOptions;
  constructor(options: ClientOptions) {
    this.options = options;
  }

  protected async request(
    method: string,
    pathTemplate: string,
    args: RequestArgs = {},
  ): Promise<never> {
    let path = pathTemplate;
    for (const [key, value] of Object.entries(args.params ?? {})) {
      path = path.replace(\`{\${key}}\`, encodeURIComponent(String(value)));
    }
    const url = new URL(
      this.options.baseUrl.replace(/\\/$/, "") + path,
    );
    for (const [key, value] of Object.entries(args.query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const baseHeaders =
      typeof this.options.headers === "function"
        ? await this.options.headers()
        : this.options.headers;
    const headers = new Headers(baseHeaders);
    const init: RequestInit = { method, ...args.init };
    if (args.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(args.body);
    }
    new Headers(args.init?.headers).forEach((v, k) => headers.set(k, v));
    init.headers = headers;

    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch(url.toString(), init);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const errorBody = parsed as
        | { error?: { code?: string; message?: string; details?: unknown } }
        | undefined;
      throw new ApiClientError(
        res.status,
        errorBody?.error?.code ?? "HTTP_ERROR",
        errorBody?.error?.message ?? \`Request failed with \${res.status}\`,
        errorBody?.error?.details,
      );
    }
    return parsed as never;
  }
}

/** Typed client for ${title}. */
export class Client extends ClientCore {
${methods || "  // No operations found in the source document."}
}

/** Create a typed client for ${title}. */
export function createClient(options: ClientOptions): Client {
  return new Client(options);
}
`;

  return { source, operationCount: operations.length, title };
}
