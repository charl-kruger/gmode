/** Internal headers used between the gateway and private downstream Workers. */
export const GMODE_HEADERS = {
  requestId: "x-gmode-request-id",
  gatewayContext: "x-gmode-context",
  forwardedUser: "x-gmode-user-id",
  forwardedTenant: "x-gmode-tenant-id",
} as const;

/** Default public request id header. */
export const PUBLIC_REQUEST_ID_HEADER = "x-request-id";

/**
 * Conventional env var / secret name holding the shared HMAC secret used to
 * sign and verify the private gateway context between gateway and services.
 */
export const GMODE_CONTEXT_SECRET_VAR = "GMODE_CONTEXT_SECRET";

/**
 * Read the conventional gateway context secret from Worker env bindings.
 *
 * Returns `undefined` when the secret is absent or empty, in which case the
 * gateway falls back to unsigned context tokens.
 */
export function readContextSecret(env: unknown): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>)[GMODE_CONTEXT_SECRET_VAR];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Prefix stripped from client requests before gateway forwarding. */
export const GMODE_HEADER_PREFIX = "x-gmode-";

/**
 * Copy headers while removing user-supplied `x-gmode-*` internal headers.
 *
 * The gateway uses this before injecting its own trusted private context.
 */
export function stripGModeHeaders(headers: Headers): Headers {
  const result = new Headers();
  headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith(GMODE_HEADER_PREFIX)) {
      result.set(key, value);
    }
  });
  return result;
}
