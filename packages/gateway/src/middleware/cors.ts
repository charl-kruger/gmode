import type { GatewayMiddleware, GatewayRequestContext } from "../types";

export type CorsOptions<Env> = {
  origins?:
    | string[]
    | "*"
    | ((origin: string | null, context: GatewayRequestContext<Env>) => boolean);
  methods?: string[];
  headers?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
};

const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_HEADERS = [
  "authorization",
  "content-type",
  "x-api-key",
  "idempotency-key",
];
const DEFAULT_EXPOSE = [
  "x-request-id",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
];

function resolveOrigin<Env>(
  origin: string | null,
  context: GatewayRequestContext<Env>,
  config: CorsOptions<Env>["origins"],
): string | null {
  if (!config || config === "*") return "*";
  if (typeof config === "function") {
    return config(origin, context) ? origin ?? "*" : null;
  }
  if (Array.isArray(config)) {
    if (origin && config.includes(origin)) return origin;
    return null;
  }
  return null;
}

export function cors<Env>(options?: CorsOptions<Env>): GatewayMiddleware<Env> {
  const resolved = {
    origins: options?.origins ?? "*",
    methods: options?.methods ?? DEFAULT_METHODS,
    headers: options?.headers ?? DEFAULT_HEADERS,
    exposeHeaders: options?.exposeHeaders ?? DEFAULT_EXPOSE,
    credentials: options?.credentials ?? false,
    maxAge: options?.maxAge,
  };

  return async (context, next) => {
    const origin = context.request.headers.get("origin");
    const allowOrigin = resolveOrigin(origin, context, resolved.origins);

    if (context.request.method.toUpperCase() === "OPTIONS") {
      const headers = new Headers();
      if (allowOrigin) {
        headers.set("access-control-allow-origin", allowOrigin);
        headers.set(
          "access-control-allow-methods",
          resolved.methods.join(", "),
        );
        headers.set(
          "access-control-allow-headers",
          resolved.headers.join(", "),
        );
        if (resolved.credentials) {
          headers.set("access-control-allow-credentials", "true");
        }
        if (resolved.maxAge !== undefined) {
          headers.set("access-control-max-age", String(resolved.maxAge));
        }
        headers.set("vary", "origin");
      }
      return new Response(null, { status: 204, headers });
    }

    const response = await next();
    if (allowOrigin) {
      response.headers.set("access-control-allow-origin", allowOrigin);
      if (resolved.credentials) {
        response.headers.set("access-control-allow-credentials", "true");
      }
      response.headers.set(
        "access-control-expose-headers",
        resolved.exposeHeaders.join(", "),
      );
      response.headers.append("vary", "origin");
    }
    return response;
  };
}
