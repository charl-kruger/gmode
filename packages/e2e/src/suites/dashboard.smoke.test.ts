import { describe, expect, it } from "vitest";
import { readE2EState } from "../harness/state";

describe("dev dashboard smoke (gmode dev)", () => {
  const { webAppGatewayUrl: gatewayUrl, dashboardUrl } = readE2EState();

  it("GET / serves the dashboard UI", async () => {
    const res = await fetch(dashboardUrl);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("html");
  });

  it("GET /api/state lists gateway resources", async () => {
    const res = await fetch(`${dashboardUrl}/api/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      app: string;
      gatewayUrl: string;
      resources: { name: string; kind: string }[];
    };
    expect(body.gatewayUrl).toBe(gatewayUrl);
    expect(body.resources.map((r) => r.name).sort()).toEqual([
      "dashboard",
      "gateway",
      "users",
    ]);
  });

  it("GET /api/logs returns process output", async () => {
    const res = await fetch(`${dashboardUrl}/api/logs`);
    expect(res.status).toBe(200);
    const logs = (await res.json()) as { resource: string; line: string }[];
    expect(logs.length).toBeGreaterThan(0);
    expect(
      logs.some((l) => l.resource === "workers" || l.resource === "dashboard"),
    ).toBe(true);
  });

  it("gateway requests appear in /api/requests after traffic", async () => {
    await fetch(`${gatewayUrl}/users/u_1`);

    const deadline = Date.now() + 15_000;
    let requests: { path: string; method: string }[] = [];
    while (Date.now() < deadline) {
      const res = await fetch(`${dashboardUrl}/api/requests`);
      requests = (await res.json()) as typeof requests;
      if (requests.some((r) => r.path.includes("/users"))) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(
      requests.some((r) => r.method === "GET" && r.path.includes("/users")),
    ).toBe(true);
  });

  it("GET /api/stream emits SSE health events", async () => {
    const res = await fetch(`${dashboardUrl}/api/stream`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 8000;
    let sawHealth = false;

    while (Date.now() < deadline && reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: health")) {
        sawHealth = true;
        break;
      }
    }
    reader?.cancel().catch(() => {});

    expect(sawHealth).toBe(true);
  });
});
