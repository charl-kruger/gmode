import { describe, expect, it } from "vitest";
import { createWebApp } from "./create-web-app";
import { withGmode, type ServiceLike } from "./with-gmode";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

/** Minimal stand-in for a createService() instance. */
function mockService(): ServiceLike<unknown> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      if (path === "/__gmode/health") {
        return Response.json({ ok: true, service: "mock" });
      }
      if (path === "/__gmode/openapi.json") {
        return Response.json({
          openapi: "3.1.0",
          info: { title: "mock", version: "1.0.0" },
          paths: { "/hello": {} },
        });
      }
      return Response.json({ path });
    },
  };
}

describe("withGmode", () => {
  it("routes API requests under basePath + api mount to the service", async () => {
    const service = mockService();
    const app = withGmode(() => new Response("framework"), {
      basePath: "/app",
      api: { service, mount: "/api" },
    });

    const res = await app.fetch!(
      new Request("https://example.com/app/api/hello?x=1"),
      {},
      execCtx(),
    );
    expect(await res.json()).toEqual({ path: "/hello" });
    expect(service.calls).toEqual(["/hello"]);
  });

  it("serves /__gmode/* from the service for aggregation", async () => {
    const service = mockService();
    const app = withGmode(() => new Response("framework"), {
      basePath: "/app",
      api: { service },
    });

    const health = await app.fetch!(
      new Request("https://example.com/__gmode/health"),
      {},
      execCtx(),
    );
    expect(health.status).toBe(200);

    const spec = await app.fetch!(
      new Request("https://example.com/__gmode/openapi.json"),
      {},
      execCtx(),
    );
    const doc = (await spec.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(["/hello"]);
  });

  it("serves OpenAPI at the API mount for dev binding probes", async () => {
    const service = mockService();
    const app = withGmode(() => new Response("framework"), {
      basePath: "/app",
      api: { service, mount: "/api" },
    });

    const spec = await app.fetch!(
      new Request("https://example.com/app/api/openapi.json"),
      {},
      execCtx(),
    );
    expect(spec.status).toBe(200);
    expect(service.calls).toContain("/__gmode/openapi.json");
  });

  it("serves basePath-prefixed /__gmode/* for Vite base URL layouts", async () => {
    const service = mockService();
    const app = withGmode(() => new Response("framework"), {
      basePath: "/app",
      api: { service },
    });

    const health = await app.fetch!(
      new Request("https://example.com/app/__gmode/health"),
      {},
      execCtx(),
    );
    expect(health.status).toBe(200);

    const spec = await app.fetch!(
      new Request("https://example.com/app/__gmode/openapi.json"),
      {},
      execCtx(),
    );
    expect(spec.status).toBe(200);
    expect(service.calls).toContain("/__gmode/openapi.json");
  });

  it("falls through to the framework handler for page routes", async () => {
    const service = mockService();
    const app = withGmode(() => new Response("framework"), {
      basePath: "/app",
      api: { service },
    });

    const res = await app.fetch!(
      new Request("https://example.com/app/settings"),
      {},
      execCtx(),
    );
    expect(await res.text()).toBe("framework");
    expect(service.calls).toEqual([]);
  });

  it("supports { fetch } shaped framework handlers", async () => {
    const app = withGmode(
      { fetch: async () => new Response("object-handler") },
      { basePath: "/" },
    );
    const res = await app.fetch!(
      new Request("https://example.com/anything"),
      {},
      execCtx(),
    );
    expect(await res.text()).toBe("object-handler");
  });

  it("answers health without an api service", async () => {
    const app = withGmode(() => new Response("framework"));
    const res = await app.fetch!(
      new Request("https://example.com/__gmode/health"),
      {},
      execCtx(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("createWebApp", () => {
  it("serves assets for page routes and the API for api routes", async () => {
    const service = mockService();
    const assetRequests: string[] = [];
    const env = {
      ASSETS: {
        async fetch(request: Request) {
          assetRequests.push(new URL(request.url).pathname);
          return new Response("<html>spa</html>", {
            headers: { "content-type": "text/html" },
          });
        },
      },
    };
    const app = createWebApp<typeof env>({
      basePath: "/app",
      api: { service, mount: "/api" },
    });

    const page = await app.fetch!(
      new Request("https://example.com/app/dashboard"),
      env,
      execCtx(),
    );
    expect(await page.text()).toBe("<html>spa</html>");
    expect(assetRequests).toEqual(["/app/dashboard"]);

    const api = await app.fetch!(
      new Request("https://example.com/app/api/hello"),
      env,
      execCtx(),
    );
    expect(await api.json()).toEqual({ path: "/hello" });
  });

  it("errors clearly when the assets binding is missing", async () => {
    const app = createWebApp({ basePath: "/" });
    const res = await app.fetch!(
      new Request("https://example.com/index.html"),
      {},
      execCtx(),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('"ASSETS" is not configured');
  });
});
