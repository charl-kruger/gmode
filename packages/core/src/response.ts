const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function mergeJsonHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("content-type")) {
    merged.set("content-type", JSON_CONTENT_TYPE);
  }
  return merged;
}

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

export function ok<T>(data: T, headers?: HeadersInit): Response {
  return json(data, 200, headers);
}

export function created<T>(data: T, headers?: HeadersInit): Response {
  return json(data, 201, headers);
}

export function accepted<T>(data: T, headers?: HeadersInit): Response {
  return json(data, 202, headers);
}

export function noContent(headers?: HeadersInit): Response {
  return new Response(null, {
    status: 204,
    headers: new Headers(headers),
  });
}

export type Pagination = {
  nextCursor?: string;
  previousCursor?: string;
  hasMore: boolean;
};

export function paginated<T>(
  data: T[],
  pagination: Pagination,
  headers?: HeadersInit,
): Response {
  return json({ data, pagination }, 200, headers);
}
