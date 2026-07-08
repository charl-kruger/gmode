import { PUBLIC_REQUEST_ID_HEADER, isValidRequestId } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

export function requestId<Env>(options?: {
  header?: string;
  generator?: () => string;
}): GatewayMiddleware<Env> {
  const header = options?.header ?? PUBLIC_REQUEST_ID_HEADER;
  const gen = options?.generator ?? (() => crypto.randomUUID());

  return async (context, next) => {
    const incoming = context.request.headers.get(header);
    const id =
      incoming && isValidRequestId(incoming) ? incoming : gen();
    context.requestId = id;

    const response = await next();
    if (!response.headers.has(header)) {
      const headers = new Headers(response.headers);
      headers.set(header, id);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  };
}
