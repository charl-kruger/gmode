import {
  GMODE_HEADERS,
  signGatewayContext,
  stripGModeHeaders,
  type FetcherLike,
  type GatewayContext,
} from "@gmode/core";
import type {
  GatewayRequestContext,
  RegisteredGatewayServiceConfig,
} from "./types";

export type ForwardInput<Env> = {
  request: Request;
  env: Env;
  service: RegisteredGatewayServiceConfig<Env>;
  serviceName: string;
  rewrittenUrl: URL;
  gatewayContext: GatewayContext;
  signingSecret: string;
  context: GatewayRequestContext<Env>;
  extraHeaders?: HeadersInit;
};

function isFetcherLike(value: unknown): value is FetcherLike {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["fetch"] === "function";
}

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

  const token = await signGatewayContext(
    input.gatewayContext,
    input.signingSecret,
  );
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
  return binding.fetch(internalRequest);
}
