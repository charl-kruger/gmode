import {
  encodeGatewayContext,
  GMODE_HEADERS,
  type GatewayContext,
} from "@gmode/core";
import { createExecutionContext } from "./mock-fetcher";

/** Minimal service runtime shape accepted by `createServiceTestClient()`. */
export type ServiceLike<Env> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

/** Options for service test clients. */
export type ServiceTestClientOptions = {
  /** Base URL used when resolving relative paths. Defaults to `https://service.test`. */
  baseUrl?: string;
  /** Gateway context fields to encode into `x-gmode-context` for trusted services. */
  gatewayContext?: Partial<GatewayContext> & { aud?: string; };
};

/** Convenience client for invoking a service in unit tests. */
export type ServiceTestClient<_Env> = {
  /** Send an arbitrary request path through the service. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Send a GET request through the service. */
  get(path: string, init?: RequestInit): Promise<Response>;
  /** Send a JSON POST request through the service. */
  post(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<Response>;
};

/**
 * Create a small test client around a service object.
 *
 * When `options.gatewayContext` is provided, the client encodes a private
 * gateway context header so services with `trustGateway` can be tested without
 * starting a real gateway.
 */
export function createServiceTestClient<Env>(input: {
  /** Service under test. */
  service: ServiceLike<Env>;
  /** Env bindings passed to every request. */
  env: Env;
  /** Optional base URL and gateway context setup. */
  options?: ServiceTestClientOptions;
}): ServiceTestClient<Env> {
  const baseUrl = input.options?.baseUrl ?? "https://service.test";

  const buildGatewayHeaders = (headers: Headers): Headers => {
    const out = new Headers(headers);
    if (!input.options?.gatewayContext) return out;
    const now = Math.floor(Date.now() / 1000);
    const ctx: GatewayContext = {
      iss: "gmode-gateway",
      aud: input.options.gatewayContext?.aud ?? "service-test",
      requestId: crypto.randomUUID(),
      authenticated: true,
      scopes: input.options.gatewayContext?.scopes ?? [],
      permissions: input.options.gatewayContext?.permissions ?? [],
      issuedAt: now,
      expiresAt: now + 60,
      ...input.options.gatewayContext,
    };
    const token = encodeGatewayContext(ctx);
    out.set(GMODE_HEADERS.gatewayContext, token);
    out.set(GMODE_HEADERS.requestId, ctx.requestId);
    return out;
  };

  const doFetch = async (
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = buildGatewayHeaders(new Headers(init?.headers));
    const url = new URL(path, baseUrl);
    const request = new Request(url.toString(), { ...init, headers });
    return input.service.fetch(request, input.env, createExecutionContext());
  };

  return {
    fetch: doFetch,
    get(path, init) {
      return doFetch(path, { ...init, method: "GET" });
    },
    post(path, body, init) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      return doFetch(path, {
        ...init,
        method: "POST",
        headers,
        body: body === undefined ? null : JSON.stringify(body),
      });
    },
  };
}
