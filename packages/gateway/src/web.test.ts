import { describe, expect, it } from "vitest";
import { GMODE_HEADERS, type FetcherLike } from "@gmode/core";
import { createGateway } from "./create-gateway";
import { requestId } from "./middleware/request-id";
import { jsonErrors } from "./middleware/json-errors";

function mockFetcher(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fetcher: FetcherLike & { calls: Request[] } = {
    calls,
    async fetch(input) {
      const req = input instanceof Request ? input : new Request(input);
      calls.push(req);
      return handler(req);
    },
  };
  return fetcher;
}

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

type Env = {
  APP: FetcherLike;
  USERS_API?: FetcherLike;
  APP_DEV_URL?: string;
};

function buildGateway() {
  const gateway = createGateway<Env>({ name: "T", version: "1.0.0" });
  gateway.use(requestId());
  gateway.use(jsonErrors());
  return gateway;
}

describe("gateway.web()", () => {
  it("forwards to the web app without stripping the mount prefix", async () => {
    const app = mockFetcher(
      (req) =>
        new Response(`path=${new URL(req.url).pathname}`, {
          headers: { "content-type": "text/html" },
        }),
    );
    const gateway = buildGateway();
    gateway.web("dashboard", {
      mount: "/app",
      binding: "APP",
      dev: { url: (env) => env.APP_DEV_URL },
    });

    const res = await gateway.fetch(
      new Request("https://example.com/app/settings"),
      { APP: app },
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("path=/app/settings");
  });

  it("does not require auth by default even with gateway auth defaults", async () => {
    const app = mockFetcher(() => new Response("ok"));
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      defaults: { auth: true },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.web("dashboard", { mount: "/app", binding: "APP" });

    const res = await gateway.fetch(
      new Request("https://example.com/app/"),
      { APP: app },
      execCtx(),
    );
    expect(res.status).toBe(200);
  });

  it("still forwards the private gateway context header", async () => {
    const app = mockFetcher(() => new Response("ok"));
    const gateway = buildGateway();
    gateway.web("dashboard", { mount: "/app", binding: "APP" });

    await gateway.fetch(
      new Request("https://example.com/app/"),
      { APP: app },
      execCtx(),
    );
    expect(app.calls[0]!.headers.get(GMODE_HEADERS.gatewayContext)).toBeTruthy();
  });

  it("proxies to the dev URL when resolvable", async () => {
    const app = mockFetcher(() => new Response("from-binding"));
    const gateway = buildGateway();
    gateway.web("dashboard", {
      mount: "/app",
      binding: "APP",
      dev: { url: (env) => env.APP_DEV_URL },
    });

    const originalFetch = globalThis.fetch;
    const proxied: Request[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(input);
      proxied.push(req);
      return new Response("from-vite");
    }) as typeof fetch;

    try {
      const res = await gateway.fetch(
        new Request("https://example.com/app/page?x=1"),
        { APP: app, APP_DEV_URL: "http://127.0.0.1:5173" },
        execCtx(),
      );
      expect(await res.text()).toBe("from-vite");
      expect(app.calls).toHaveLength(0);
      expect(proxied).toHaveLength(1);
      const target = new URL(proxied[0]!.url);
      expect(target.origin).toBe("http://127.0.0.1:5173");
      expect(target.pathname).toBe("/app/page");
      expect(target.search).toBe("?x=1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aggregates web app API routes under the app + api mount", async () => {
    const app = mockFetcher((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/app/__gmode/openapi.json" || path === "/__gmode/openapi.json") {
        return new Response("blocked", { status: 403 });
      }
      if (path === "/app/api/openapi.json") {
        return Response.json({
          openapi: "3.1.0",
          info: { title: "Dashboard API", version: "1.0.0" },
          paths: {
            "/todos": {
              get: {
                operationId: "listTodos",
                responses: { "200": { description: "ok" } },
              },
            },
          },
        });
      }
      return new Response("ok");
    });
    const users = mockFetcher(() =>
      Response.json({
        openapi: "3.1.0",
        info: { title: "Users", version: "1.0.0" },
        paths: {
          "/": {
            get: {
              operationId: "listUsers",
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    );

    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      docs: { openapiCacheTtlSeconds: 0 },
    });
    gateway.use(requestId());
    gateway.use(jsonErrors());
    gateway.service("users", {
      mount: "/users",
      binding: "USERS_API",
      auth: false,
      openapi: true,
    });
    gateway.web("dashboard", {
      mount: "/app",
      binding: "APP",
      api: { mount: "/api", openapi: true },
    });

    const res = await gateway.fetch(
      new Request("https://example.com/openapi.json"),
      { APP: app, USERS_API: users },
      execCtx(),
    );
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/app/api/todos",
      "/users",
    ]);
  });

  it("returns web app responses untouched (no re-wrapping)", async () => {
    // Identity pass-through matters for streamed SSR bodies and WebSocket
    // upgrade responses, which cannot be reconstructed. Middleware that
    // rewraps (like requestId) skips 101s; the routing layer must not
    // rewrap web responses at all.
    const original = new Response("stream", {
      headers: { "content-type": "text/html" },
    });
    const app = mockFetcher(() => original);
    const gateway = createGateway<Env>({ name: "T", version: "1.0.0" });
    gateway.web("dashboard", { mount: "/app", binding: "APP" });

    const res = await gateway.fetch(
      new Request("https://example.com/app/ws", {
        headers: { upgrade: "websocket" },
      }),
      { APP: app },
      execCtx(),
    );
    expect(res).toBe(original);
  });
});
