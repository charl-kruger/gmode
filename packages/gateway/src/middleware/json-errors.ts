import { json, serializeError } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

/**
 * Convert thrown `ApiError`, Zod validation errors, and unknown exceptions into
 * JSON responses.
 *
 * Mount near the start of the gateway chain so downstream middleware and
 * service forwarding errors are serialized consistently.
 */
export function jsonErrors<Env>(options?: {
  /** Include stack traces in JSON error bodies. Keep `false` in production. */
  includeStack?: boolean;
}): GatewayMiddleware<Env> {
  const includeStack = options?.includeStack ?? false;
  return async (context, next) => {
    try {
      return await next();
    } catch (err) {
      const { status, body } = serializeError({
        err,
        requestId: context.requestId,
        includeStack,
      });
      return json(body, status);
    }
  };
}
