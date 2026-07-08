import { json, serializeError } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

export function jsonErrors<Env>(options?: {
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
