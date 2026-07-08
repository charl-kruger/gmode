import { createExecutionContext } from "./mock-fetcher";

export type GatewayLike<Env> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

export type GatewayTestClient<Env> = {
  fetch(
    path: string,
    init?: RequestInit & { baseUrl?: string },
  ): Promise<Response>;
  get(path: string, init?: RequestInit): Promise<Response>;
  post(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<Response>;
};

export function createGatewayTestClient<Env>(input: {
  gateway: GatewayLike<Env>;
  env: Env;
  baseUrl?: string;
}): GatewayTestClient<Env> {
  const baseUrl = input.baseUrl ?? "https://gateway.test";

  const doFetch = (
    path: string,
    init?: RequestInit & { baseUrl?: string },
  ): Promise<Response> => {
    const { baseUrl: pathBase, ...rest } = init ?? {};
    const url = new URL(path, pathBase ?? baseUrl);
    const request = new Request(url.toString(), rest);
    return input.gateway.fetch(request, input.env, createExecutionContext());
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
