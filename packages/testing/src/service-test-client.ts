import {
  GMODE_HEADERS,
  signGatewayContext,
  type GatewayContext,
} from "@gmode/core";
import { createExecutionContext } from "./mock-fetcher";

export type ServiceLike<Env> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

export type ServiceTestClientOptions = {
  baseUrl?: string;
  signingSecret?: string;
  gatewayContext?: Partial<GatewayContext> & { aud?: string };
};

export type ServiceTestClient<Env> = {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  get(path: string, init?: RequestInit): Promise<Response>;
  post(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<Response>;
};

export function createServiceTestClient<Env>(input: {
  service: ServiceLike<Env>;
  env: Env;
  options?: ServiceTestClientOptions;
}): ServiceTestClient<Env> {
  const baseUrl = input.options?.baseUrl ?? "https://service.test";

  const buildSignedHeaders = async (
    headers: Headers,
  ): Promise<Headers> => {
    const out = new Headers(headers);
    if (!input.options?.signingSecret) return out;
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
    const token = await signGatewayContext(ctx, input.options.signingSecret);
    out.set(GMODE_HEADERS.gatewayContext, token);
    out.set(GMODE_HEADERS.requestId, ctx.requestId);
    return out;
  };

  const doFetch = async (
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = await buildSignedHeaders(new Headers(init?.headers));
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
