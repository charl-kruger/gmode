import {
  GMODE_HEADERS,
  encodeGatewayContext,
  stripGModeHeaders,
  type FetcherLike,
  type GatewayContext,
} from "@gmode/core";
import type {
  GatewayRequestContext,
  RegisteredGatewayServiceConfig,
} from "./types";

/** Input for the low-level Worker service-binding forwarding helper. */
export type ForwardInput<Env> = {
  /** Original public gateway request. */
  request: Request;
  /** Gateway Worker env bindings. */
  env: Env;
  /** Resolved downstream service configuration. */
  service: RegisteredGatewayServiceConfig<Env>;
  /** Service name used for diagnostics. */
  serviceName: string;
  /** Internal URL sent to the service binding. */
  rewrittenUrl: URL;
  /** Private gateway context to encode into `x-gmode-context`. */
  gatewayContext: GatewayContext;
  /** Gateway request context. */
  context: GatewayRequestContext<Env>;
  /** Additional trusted headers to add after user `x-gmode-*` headers are stripped. */
  extraHeaders?: HeadersInit;
  /** Optional Cloudflare Workers cache policy for this forwarded request. */
  cache?: ForwardCachePolicy;
};

/** Cloudflare Workers cache policy passed to service-binding `fetch()`. */
export type ForwardCachePolicy = {
  /** Value passed to `cf.cacheControl`. */
  cacheControl: string;
  /** Optional value passed to `cf.cacheKey`. */
  cacheKey?: string;
};

function isFetcherLike(value: unknown): value is FetcherLike {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["fetch"] === "function";
}

/**
 * Forward a gateway request to a private Worker service binding.
 *
 * This helper strips user-supplied `x-gmode-*` headers, injects the private
 * gateway context, preserves the request body, and optionally applies
 * Cloudflare Workers cache settings.
 */
export async function forwardToService<Env>(
  input: ForwardInput<Env>,
): Promise<Response> {
  const headers = stripGModeHeaders(input.request.headers);

  if (input.service.headers) {
    for (const [key, value] of Object.entries(input.service.headers)) {
      headers.set(key, value);
    }
  }

  if (input.extraHeaders) {
    const extra = new Headers(input.extraHeaders);
    extra.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const token = encodeGatewayContext(input.gatewayContext);
  headers.set(GMODE_HEADERS.gatewayContext, token);
  headers.set(GMODE_HEADERS.requestId, input.gatewayContext.requestId);

  if (input.gatewayContext.user?.id) {
    headers.set(GMODE_HEADERS.forwardedUser, input.gatewayContext.user.id);
  }
  if (input.gatewayContext.tenant?.id) {
    headers.set(
      GMODE_HEADERS.forwardedTenant,
      input.gatewayContext.tenant.id,
    );
  }

  const originalUrl = new URL(input.request.url);
  if (!headers.has("x-forwarded-host")) {
    headers.set("x-forwarded-host", originalUrl.host);
  }
  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", originalUrl.protocol.replace(":", ""));
  }

  const method = input.request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    init.body = input.request.body;
    init.duplex = "half";
  }
  const internalRequest = new Request(input.rewrittenUrl.toString(), init);
  const binding = (input.env as Record<string, unknown>)[input.service.binding];
  if (!isFetcherLike(binding)) {
    throw new Error(
      `Service binding "${input.service.binding}" is not configured`,
    );
  }
  if (input.cache) {
    const cf: RequestInitCfProperties = {
      cacheControl: input.cache.cacheControl,
    };
    if (input.cache.cacheKey !== undefined) {
      cf.cacheKey = input.cache.cacheKey;
    }
    return binding.fetch(internalRequest, { cf });
  }

  return binding.fetch(internalRequest);
}
