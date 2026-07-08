const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function mergeJsonHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("content-type")) {
    merged.set("content-type", JSON_CONTENT_TYPE);
  }
  return merged;
}

/** Create a JSON response with `application/json; charset=utf-8`. */
export function json<T>(
  data: T,
  status: number = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: mergeJsonHeaders(headers),
  });
}

/** Create a JSON `200 OK` response. */
export function ok<T>(data: T, headers?: HeadersInit): Response {
  return json(data, 200, headers);
}

/** Create a JSON `201 Created` response. */
export function created<T>(data: T, headers?: HeadersInit): Response {
  return json(data, 201, headers);
}

/** Create a JSON `202 Accepted` response. */
export function accepted<T>(data: T, headers?: HeadersInit): Response {
  return json(data, 202, headers);
}

/** Create a `204 No Content` response. */
export function noContent(headers?: HeadersInit): Response {
  return new Response(null, {
    status: 204,
    headers: new Headers(headers),
  });
}

/** Pagination metadata returned by `paginated()`. */
export type Pagination = {
  nextCursor?: string;
  previousCursor?: string;
  hasMore: boolean;
};

/** Create a JSON `200 OK` response shaped as `{ data, pagination }`. */
export function paginated<T>(
  data: T[],
  pagination: Pagination,
  headers?: HeadersInit,
): Response {
  return json({ data, pagination }, 200, headers);
}
