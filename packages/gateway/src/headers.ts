export function withMutableHeaders(
  response: Response,
  extra: HeadersInit | undefined,
): Response {
  const headers = new Headers(response.headers);
  if (extra) {
    new Headers(extra).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
