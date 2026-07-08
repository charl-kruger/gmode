import { ApiError } from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

type UnsafeMethod = "POST" | "PUT" | "PATCH" | "DELETE";

type IdempotencyStore = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
};

type StoredHeader = [string, string];

type StoredResponse = {
  fingerprint: string;
  status: number;
  statusText: string;
  headers: StoredHeader[];
  bodyBase64: string;
};

/** Options for replay-safe unsafe HTTP methods backed by KV. */
export type IdempotencyOptions<Env, Binding extends keyof Env & string> = {
  /** KV namespace binding used to store request fingerprints and responses. */
  binding: Binding;
  /** Seconds before stored idempotency entries expire. */
  ttlSeconds: number;
  /** Header that carries the client idempotency key. Defaults to `idempotency-key`. */
  headerName?: string;
  /** Unsafe methods protected by this middleware. Defaults to POST, PUT, PATCH, DELETE. */
  methods?: readonly UnsafeMethod[];
  /** Optional path prefixes where idempotency is enforced. Defaults to all protected methods. */
  paths?: readonly `/${string}`[];
  /** Customize the storage key scope. Default includes tenant id, user id, and raw key. */
  key?: (context: GatewayRequestContext<Env>, rawKey: string) => string;
  /** Decide whether a response should be stored. Defaults to caching 2xx responses. */
  cacheResponse?: (response: Response) => boolean;
};

const DEFAULT_HEADER = "idempotency-key";
const DEFAULT_METHODS: readonly UnsafeMethod[] = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/**
 * Enforce idempotency keys for unsafe methods and replay matching responses.
 *
 * A reused key with a different request fingerprint fails with `409
 * IDEMPOTENCY_KEY_CONFLICT`; a matching request receives the stored response.
 */
export function idempotency<
  Env,
  Binding extends keyof Env & string,
>(
  options: IdempotencyOptions<Env, Binding>,
): GatewayMiddleware<Env> {
  const headerName = (options.headerName ?? DEFAULT_HEADER).toLowerCase();
  const methods = new Set<UnsafeMethod>(options.methods ?? DEFAULT_METHODS);
  const cacheResponse = options.cacheResponse ?? defaultCacheResponse;

  return async (context, next) => {
    if (!shouldApply(context, methods, options.paths)) {
      return next();
    }

    const rawKey = context.request.headers.get(headerName);
    if (!rawKey) {
      throw new ApiError({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: `${headerName} header is required`,
        status: 400,
      });
    }

    const store = readStore(context.env, options.binding);
    const scopedKey = options.key
      ? options.key(context, rawKey)
      : defaultScopedKey(context, rawKey);
    const storageKey = `gmode:idempotency:v1:${scopedKey}`;
    const fingerprint = await buildRequestFingerprint(context.request);
    const existing = await readStoredResponse(store, storageKey);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiError({
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message: "Idempotency key was already used for a different request",
          status: 409,
        });
      }
      return replayStoredResponse(existing);
    }

    const response = await next();
    if (!cacheResponse(response)) {
      return response;
    }

    const stored = await storeResponse(response, fingerprint);
    await store.put(storageKey, JSON.stringify(stored), {
      expirationTtl: options.ttlSeconds,
    });
    return response;
  };
}

function shouldApply<Env>(
  context: GatewayRequestContext<Env>,
  methods: ReadonlySet<UnsafeMethod>,
  paths: readonly `/${string}`[] | undefined,
): boolean {
  const method = context.request.method.toUpperCase();
  if (!isUnsafeMethod(method) || !methods.has(method)) return false;
  if (!paths || paths.length === 0) return true;
  return paths.some((path) => matchesPath(context.url.pathname, path));
}

function isUnsafeMethod(method: string): method is UnsafeMethod {
  return (
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  );
}

function matchesPath(pathname: string, prefix: `/${string}`): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function readStore<Env, Binding extends keyof Env & string>(
  env: Env,
  binding: Binding,
): IdempotencyStore {
  const raw = (env as Record<string, unknown>)[binding];
  if (!isStore(raw)) {
    throw new Error(
      `Idempotency KV binding "${binding}" is not configured. Declare it in wrangler.jsonc under "kv_namespaces".`,
    );
  }
  return raw;
}

function isStore(value: unknown): value is IdempotencyStore {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["get"] === "function" &&
    typeof candidate["put"] === "function"
  );
}

function defaultScopedKey<Env>(
  context: GatewayRequestContext<Env>,
  rawKey: string,
): string {
  const tenant = context.auth.tenant?.id ?? "tenant:none";
  const user = context.auth.user?.id ?? "user:none";
  return `${tenant}:${user}:${rawKey}`;
}

async function buildRequestFingerprint(request: Request): Promise<string> {
  const clone = request.clone();
  const bodyHash = await sha256Hex(await clone.arrayBuffer());
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type") ?? "";
  return [
    request.method.toUpperCase(),
    url.pathname,
    url.search,
    contentType,
    bodyHash,
  ].join("\n");
}

async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readStoredResponse(
  store: IdempotencyStore,
  key: string,
): Promise<StoredResponse | null> {
  const raw = await store.get(key);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!isStoredResponse(parsed)) {
    throw new Error(`Invalid idempotency record for key "${key}"`);
  }
  return parsed;
}

function isStoredResponse(value: unknown): value is StoredResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["fingerprint"] === "string" &&
    typeof record["status"] === "number" &&
    typeof record["statusText"] === "string" &&
    typeof record["bodyBase64"] === "string" &&
    Array.isArray(record["headers"]) &&
    record["headers"].every(isStoredHeader)
  );
}

function isStoredHeader(value: unknown): value is StoredHeader {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

function replayStoredResponse(stored: StoredResponse): Response {
  const headers = new Headers(stored.headers);
  headers.set("x-idempotency-replayed", "true");
  return new Response(base64ToArrayBuffer(stored.bodyBase64), {
    status: stored.status,
    statusText: stored.statusText,
    headers,
  });
}

function defaultCacheResponse(response: Response): boolean {
  return response.status < 500;
}

async function storeResponse(
  response: Response,
  fingerprint: string,
): Promise<StoredResponse> {
  const clone = response.clone();
  return {
    fingerprint,
    status: clone.status,
    statusText: clone.statusText,
    headers: headerEntries(clone.headers),
    bodyBase64: bytesToBase64(new Uint8Array(await clone.arrayBuffer())),
  };
}

function headerEntries(headers: Headers): StoredHeader[] {
  const entries: StoredHeader[] = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
