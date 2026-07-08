/** Internal headers used between the gateway and private downstream Workers. */
export const GMODE_HEADERS = {
  requestId: "x-gmode-request-id",
  gatewayContext: "x-gmode-context",
  forwardedUser: "x-gmode-user-id",
  forwardedTenant: "x-gmode-tenant-id",
} as const;

/** Default public request id header. */
export const PUBLIC_REQUEST_ID_HEADER = "x-request-id";

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
