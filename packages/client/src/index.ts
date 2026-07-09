/**
 * Typed fetch client runtime for GMode gateways.
 *
 * Two ways to use it:
 *
 * 1. Generated (recommended): run `gmode generate client --url <gateway>/openapi.json`.
 *    The generated file is fully self-contained; this package is not required.
 *
 * 2. Hand-written operation maps with full type inference:
 *
 * ```ts
 * type Api = {
 *   getUser: { params: { id: string }; response: User };
 *   listUsers: { query: { limit?: number }; response: { data: User[] } };
 *   createUser: { body: { email: string }; response: User };
 * };
 *
 * const api = createClient<Api>({
 *   baseUrl: "https://api.example.com",
 *   operations: {
 *     getUser: { method: "GET", path: "/users/{id}" },
 *     listUsers: { method: "GET", path: "/users" },
 *     createUser: { method: "POST", path: "/users" },
 *   },
 * });
 *
 * const user = await api.getUser({ params: { id: "u_1" } }); // typed User
 * ```
 */

/** Structured error thrown for non-2xx responses (mirrors the gateway error shape). */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
  }
}

/** Type-level description of one operation's inputs and output. */
export type OperationTypes = {
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  response: unknown;
};

/** Runtime description of one operation: HTTP method + path template. */
export type OperationDef = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  /** OpenAPI-style path template, e.g. `/users/{id}`. */
  path: string;
};

type OperationArgs<Op extends OperationTypes> = (Op extends {
  params: infer P;
}
  ? { params: P }
  : { params?: never }) &
  (Op extends { query: infer Q } ? { query?: Q } : { query?: never }) &
  (Op extends { body: infer B } ? { body: B } : { body?: never }) & {
    /** Extra fetch options merged into the request. */
    init?: RequestInit;
  };

type HasRequiredInput<Op extends OperationTypes> = Op extends {
  params: unknown;
}
  ? true
  : Op extends { body: unknown }
    ? true
    : false;

/** Typed method surface derived from an `Api` operation type map. */
export type TypedClient<Api extends Record<string, OperationTypes>> = {
  [K in keyof Api]: HasRequiredInput<Api[K]> extends true
    ? (args: OperationArgs<Api[K]>) => Promise<Api[K]["response"]>
    : (args?: OperationArgs<Api[K]>) => Promise<Api[K]["response"]>;
};

export type ClientOptions<Api extends Record<string, OperationTypes>> = {
  /** Base URL of the gateway, e.g. `https://api.example.com`. */
  baseUrl: string;
  /** Runtime operation map: method + path template per operation. */
  operations: { [K in keyof Api]: OperationDef };
  /** Static headers or an async factory (e.g. for bearer tokens). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
};

type AnyArgs = {
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  init?: RequestInit;
};

async function performRequest(
  options: ClientOptions<Record<string, OperationTypes>>,
  def: OperationDef,
  args: AnyArgs,
): Promise<unknown> {
  let path = def.path;
  for (const [key, value] of Object.entries(args.params ?? {})) {
    path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const url = new URL(options.baseUrl.replace(/\/$/, "") + path);
  for (const [key, value] of Object.entries(args.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const baseHeaders =
    typeof options.headers === "function"
      ? await options.headers()
      : options.headers;
  const headers = new Headers(baseHeaders);
  const init: RequestInit = { method: def.method, ...args.init };
  if (args.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(args.body);
  }
  new Headers(args.init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  init.headers = headers;

  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(url.toString(), init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const body = parsed as
      | {
          error?: {
            code?: string;
            message?: string;
            details?: unknown;
            requestId?: string;
          };
        }
      | undefined;
    throw new ApiClientError({
      status: res.status,
      code: body?.error?.code ?? "HTTP_ERROR",
      message: body?.error?.message ?? `Request failed with ${res.status}`,
      details: body?.error?.details,
      ...(body?.error?.requestId ? { requestId: body.error.requestId } : {}),
    });
  }
  return parsed;
}

/** Create a typed client from an operation type map + runtime operation defs. */
export function createClient<Api extends Record<string, OperationTypes>>(
  options: ClientOptions<Api>,
): TypedClient<Api> {
  const client = {} as Record<string, (args?: AnyArgs) => Promise<unknown>>;
  for (const [name, def] of Object.entries(options.operations) as [
    string,
    OperationDef,
  ][]) {
    client[name] = (args?: AnyArgs) =>
      performRequest(
        options as ClientOptions<Record<string, OperationTypes>>,
        def,
        args ?? {},
      );
  }
  return client as TypedClient<Api>;
}
