import { describe, expect, it } from "vitest";
import { runGmode } from "../harness/cli";
import { readE2EState } from "../harness/state";
import { WEB_APP_TANSTACK } from "../harness/paths";

describe("web-app-tanstack smoke (gmode dev)", () => {
  const { webAppGatewayUrl: gatewayUrl } = readE2EState();

  it("gmode sync + doctor pass on the workspace", async () => {
    const sync = await runGmode(WEB_APP_TANSTACK, ["sync"]);
    expect(sync.code).toBe(0);
    const doctor = await runGmode(WEB_APP_TANSTACK, ["doctor"]);
    expect(doctor.code).toBe(0);
  });

  it("GET /__gmode/health reports users + dashboard", async () => {
    const res = await fetch(`${gatewayUrl}/__gmode/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      services: { name: string; ok: boolean }[];
    };
    expect(body.ok).toBe(true);
    expect(body.services.map((s) => s.name).sort()).toEqual([
      "dashboard",
      "users",
    ]);
  });

  it("GET /users/u_1 proxies to users service", async () => {
    const res = await fetch(`${gatewayUrl}/users/u_1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; email: string };
    expect(body.id).toBe("u_1");
    expect(typeof body.email).toBe("string");
  });

  it("GET /app/ returns TanStack SSR HTML", async () => {
    const res = await fetch(`${gatewayUrl}/app/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("html");
  });

  it("GET /app/api/todos hits embedded web app API", async () => {
    const res = await fetch(`${gatewayUrl}/app/api/todos`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; title: string; done: boolean }[];
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.id).toBeTruthy();
  });

  it("GET /openapi.json aggregates users + web app API routes", async () => {
    const res = await fetch(`${gatewayUrl}/openapi.json?refresh=1`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, unknown>;
      "x-gmode-unavailable"?: unknown[];
    };
    const paths = Object.keys(doc.paths).sort();
    expect(paths).toContain("/users");
    expect(paths).toContain("/users/{id}");
    expect(paths).toContain("/app/api/todos");
    expect(doc["x-gmode-unavailable"]).toBeUndefined();
  });

  it("GET /docs serves Swagger UI", async () => {
    const res = await fetch(`${gatewayUrl}/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("swagger");
  });

  it("gmode generate client against live OpenAPI", async () => {
    const result = await runGmode(WEB_APP_TANSTACK, [
      "generate",
      "client",
      "--url",
      `${gatewayUrl}/openapi.json`,
      "--out",
      "./generated-e2e-live",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Generated typed client/);
  });
});
