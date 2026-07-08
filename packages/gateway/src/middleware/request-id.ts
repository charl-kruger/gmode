import { PUBLIC_REQUEST_ID_HEADER, isValidRequestId } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

/**
 * Read or generate a request id and expose it through `context.requestId`.
 *
 * The response receives the same header unless another middleware or service
 * already set it.
 */
export function requestId<Env>(options?: {
  /** Header used for incoming and outgoing request ids. Defaults to `x-request-id`. */
  header?: string;
  /** Generator used when the incoming header is missing or invalid. */
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
