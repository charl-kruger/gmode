import { createExecutionContext } from "./mock-fetcher";

/** Minimal gateway runtime shape accepted by `createGatewayTestClient()`. */
export type GatewayLike<Env> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

/** Convenience client for invoking a gateway in unit tests. */
export type GatewayTestClient<Env> = {
  /** Send an arbitrary request path through the gateway. */
  fetch(
    path: string,
    init?: RequestInit & { baseUrl?: string },
  ): Promise<Response>;
  /** Send a GET request through the gateway. */
  get(path: string, init?: RequestInit): Promise<Response>;
  /** Send a JSON POST request through the gateway. */
  post(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<Response>;
};

/**
 * Create a small test client around a gateway object.
 *
 * The client constructs `Request` objects, injects the provided env, and uses a
 * mock `ExecutionContext` so gateway middleware can run without Wrangler.
 */
export function createGatewayTestClient<Env>(input: {
  /** Gateway under test. */
  gateway: GatewayLike<Env>;
  /** Env bindings passed to every request. */
  env: Env;
  /** Base URL used when resolving relative paths. Defaults to `https://gateway.test`. */
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
