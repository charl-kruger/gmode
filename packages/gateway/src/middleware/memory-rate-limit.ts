import { ApiError } from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

type Bucket = { count: number; expiresAt: number };
const store = new Map<string, Bucket>();

function defaultKey<Env>(context: GatewayRequestContext<Env>): string {
  return context.auth.user?.id ?? "anonymous";
}

/**
 * In-memory rate limiter for unit tests and local development.
 *
 * This is not distributed across Worker isolates or regions. Use
 * `cloudflareRateLimit()` or `durableObjectRateLimit()` for production.
 */
export function memoryRateLimit<Env>(options: {
  /** Max requests allowed during the window. */
  limit: number;
  /** Fixed-window length in seconds. */
  windowSeconds: number;
  /** Per-request bucket key. Defaults to authenticated user id or `anonymous`. */
  key?: (context: GatewayRequestContext<Env>) => string;
}): GatewayMiddleware<Env> {
  const keyFn = options.key ?? defaultKey;

  return async (context, next) => {
    const key = keyFn(context);
    const now = Date.now();
    const windowMs = options.windowSeconds * 1000;
    const bucket = store.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      store.set(key, { count: 1, expiresAt: now + windowMs });
    } else {
      bucket.count++;
      if (bucket.count > options.limit) {
        throw new ApiError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests",
          status: 429,
        });
      }
    }

    const response = await next();
    response.headers.set("x-rate-limit-policy", "memory");
    return response;
  };
}

/** Clear all in-memory rate-limit buckets. Intended for tests only. */
export function __resetMemoryRateLimit(): void {
  store.clear();
}
