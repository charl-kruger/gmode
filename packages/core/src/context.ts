export const GMODE_HEADERS = {
  requestId: "x-gmode-request-id",
  gatewayContext: "x-gmode-context",
  forwardedUser: "x-gmode-user-id",
  forwardedTenant: "x-gmode-tenant-id",
} as const;

export const PUBLIC_REQUEST_ID_HEADER = "x-request-id";

export const GMODE_HEADER_PREFIX = "x-gmode-";

export function stripGModeHeaders(headers: Headers): Headers {
  const result = new Headers();
  headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith(GMODE_HEADER_PREFIX)) {
      result.set(key, value);
    }
  });
  return result;
}
