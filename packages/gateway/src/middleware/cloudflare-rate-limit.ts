import {
  ApiError,
  logStructured,
  type CloudflareRateLimitBinding,
} from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

/** Options for Cloudflare's native Rate Limiting binding middleware. */
export type CloudflareRateLimitOptions<Env, Binding extends keyof Env & string> = {
  /** Name of the `ratelimits` binding in the gateway Worker env. */
  binding: Binding;
  /** Per-request key used for rate-limit buckets. Defaults to tenant/user/API key/path. */
  key?: (context: GatewayRequestContext<Env>) => string;
  /**
   * When `true`, missing or failing bindings log and allow the request.
   *
   * Keep `false` in production when rate limiting is mandatory. Use `true`
   * for local development when Wrangler does not provide the binding.
   */
  failOpen?: boolean;
  /** Optional hook invoked immediately before a `429` is thrown. */
  onLimited?: (
    context: GatewayRequestContext<Env>,
  ) => void | Promise<void>;
};

function defaultKey<Env>(context: GatewayRequestContext<Env>): string {
  const auth = context.auth;
  if (auth.tenant?.id && auth.user?.id) {
    return `${auth.tenant.id}:${auth.user.id}`;
  }
  if (auth.user?.id) return auth.user.id;
  const raw = auth.raw as { keyId?: string } | undefined;
  if (raw?.keyId) return `apikey:${raw.keyId}`;
  if (context.matchedService) {
    return `${context.matchedService.name}:${context.url.pathname}`;
  }
  return "anonymous";
}

/**
 * Enforce Cloudflare's native Rate Limiting binding before service forwarding.
 *
 * Configure the binding in `wrangler.jsonc` under `ratelimits`, then pass the
 * binding name from your strongly typed `Env`.
 */
export function cloudflareRateLimit<
  Env,
  Binding extends keyof Env & string,
>(
  options: CloudflareRateLimitOptions<Env, Binding>,
): GatewayMiddleware<Env> {
  const keyFn = options.key ?? defaultKey;
  const failOpen = options.failOpen ?? false;

  return async (context, next) => {
    const limiter = (context.env as Record<string, unknown>)[
      options.binding
    ] as CloudflareRateLimitBinding | undefined;

    if (!limiter || typeof limiter.limit !== "function") {
      if (failOpen) {
        logStructured({
          level: "warn",
          type: "gmode.ratelimit.missing_binding",
          binding: options.binding,
          requestId: context.requestId,
        });
        return next();
      }
      throw new Error(
        `Rate limit binding "${options.binding}" is not configured. ` +
          `Declare it in wrangler.jsonc under "ratelimits", or pass failOpen: true ` +
          `to cloudflareRateLimit() for local-dev resilience.`,
      );
    }

    const key = keyFn(context);

    let success: boolean;
    try {
      const result = await limiter.limit({ key });
      success = result.success;
    } catch (err) {
      if (failOpen) {
        logStructured({
          level: "error",
          type: "gmode.ratelimit.error",
          binding: options.binding,
          requestId: context.requestId,
          message: err instanceof Error ? err.message : String(err),
        });
        return next();
      }
      throw err;
    }

    if (!success) {
      if (options.onLimited) {
        await options.onLimited(context);
      }
      throw new ApiError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests",
        status: 429,
      });
    }

    const response = await next();
    response.headers.set("x-rate-limit-policy", "cloudflare-native");
    return response;
  };
}
