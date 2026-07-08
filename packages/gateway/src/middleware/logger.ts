import { logStructured } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

export type RequestLoggerOptions = {
  sample?: number;
  redactHeaders?: string[];
  logRequestBody?: false;
};

export function requestLogger<Env>(
  options?: RequestLoggerOptions,
): GatewayMiddleware<Env> {
  const sample = options?.sample ?? 1;

  return async (context, next) => {
    const start = Date.now();
    let status = 500;
    let response: Response;
    try {
      response = await next();
      status = response.status;
    } catch (err) {
      if (Math.random() <= sample) {
        logStructured({
          level: "error",
          type: "gmode.request.error",
          requestId: context.requestId,
          method: context.request.method,
          path: context.url.pathname,
          durationMs: Date.now() - start,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }

    if (Math.random() <= sample) {
      logStructured({
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        type: "gmode.request",
        requestId: context.requestId,
        method: context.request.method,
        path: context.url.pathname,
        status,
        durationMs: Date.now() - start,
        service: context.matchedService?.name,
        authenticated: context.auth.authenticated,
        userId: context.auth.user?.id,
        tenantId: context.auth.tenant?.id,
      });
    }

    return response;
  };
}
