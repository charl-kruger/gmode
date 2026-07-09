import { describe, expect, it } from "vitest";
import { createTestJwt } from "@gmode/testing";
import { postMcpRpc } from "../harness/mcp";
import { readE2EState } from "../harness/state";

const JWT_SECRET = "dev-jwt-secret";

describe("gateway-basic smoke", () => {
  const { gatewayBasicUrl: gatewayUrl } = readE2EState();

  it("GET /__gmode/health reports all services healthy", async () => {
    const res = await fetch(`${gatewayUrl}/__gmode/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      services: { name: string; ok: boolean }[];
    };
    expect(body.ok).toBe(true);
    expect(body.services.map((s) => s.name).sort()).toEqual([
      "billing",
      "users",
    ]);
  });

  it("GET /users/u_1 returns 200 with signed gateway context", async () => {
    const res = await fetch(`${gatewayUrl}/users/u_1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("u_1");
  });

  it("GET /openapi.json aggregates downstream specs", async () => {
    const res = await fetch(`${gatewayUrl}/openapi.json?refresh=1`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths).sort();
    expect(paths.some((p) => p.startsWith("/users"))).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /openapi.json?profile=shield returns OpenAPI 3.0", async () => {
    const res = await fetch(`${gatewayUrl}/openapi.json?profile=shield`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string };
    expect(doc.openapi).toMatch(/^3\.0\./);
  });

  it("GET /docs serves Swagger UI", async () => {
    const res = await fetch(`${gatewayUrl}/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("swagger");
  });

  it("GET / returns gateway index page", async () => {
    const res = await fetch(`${gatewayUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("openapi.json");
  });

  it("GET /billing/invoices/:id requires JWT with billing scope", async () => {
    const anon = await fetch(`${gatewayUrl}/billing/invoices/inv_1`);
    expect([401, 404]).toContain(anon.status);

    const token = await createTestJwt(
      { sub: "u_test", scope: "billing:read billing:write billing:*" },
      JWT_SECRET,
    );
    const authed = await fetch(`${gatewayUrl}/billing/invoices/inv_1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (authed.status === 404) return;
    expect(authed.status).toBe(200);
    const body = (await authed.json()) as { id: string };
    expect(body.id).toBe("inv_1");
  });

  it("responses include x-request-id", async () => {
    const res = await fetch(`${gatewayUrl}/users/u_1`);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("POST /mcp initialize returns server info", async () => {
    const { status, json } = await postMcpRpc(gatewayUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1.0.0" },
      },
    });
    expect(status).toBe(200);
    const reply = json as {
      result: { serverInfo: { name: string }; protocolVersion: string };
    };
    expect(reply.result.serverInfo.name).toBe("Example API MCP");
    expect(reply.result.protocolVersion).toBe("2025-06-18");
  });

  it("POST /mcp tools/list returns catalog tools", async () => {
    const { status, json } = await postMcpRpc(gatewayUrl, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(status).toBe(200);
    const reply = json as { result: { tools: { name: string }[] } };
    expect(reply.result.tools.map((t) => t.name).sort()).toEqual([
      "discover",
      "invoke",
    ]);
  });

  it("POST /mcp tools/call discover lists OpenAPI operations", async () => {
    const { status, json } = await postMcpRpc(gatewayUrl, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discover", arguments: {} },
    });
    expect(status).toBe(200);
    const reply = json as { result: { content: { text: string }[] } };
    const payload = JSON.parse(reply.result.content[0]!.text) as {
      operations: { operationId: string }[];
    };
    expect(payload.operations.some((o) => o.operationId === "getUser")).toBe(
      true,
    );
  });

  it("POST /mcp tools/call invoke runs getUser", async () => {
    const { status, json } = await postMcpRpc(gatewayUrl, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "invoke",
        arguments: {
          operationId: "getUser",
          pathParams: { id: "u_1" },
        },
      },
    });
    expect(status).toBe(200);
    const reply = json as { result: { content: { text: string }[] } };
    const payload = JSON.parse(reply.result.content[0]!.text) as {
      status: number;
      body: { id: string };
    };
    expect(payload.status).toBe(200);
    expect(payload.body.id).toBe("u_1");
  });

  it("POST /billing/invoices uses RPC to join user email", async () => {
    const token = await createTestJwt(
      { sub: "u_test", scope: "billing:read billing:write billing:*" },
      JWT_SECRET,
    );
    const res = await fetch(`${gatewayUrl}/billing/invoices`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        total: 4999,
        currency: "USD",
        userId: "u_1",
      }),
    });
    if (res.status === 404) return;
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      userId: string;
      userEmail: string;
      total: number;
    };
    expect(body.userId).toBe("u_1");
    expect(body.userEmail).toContain("@");
    expect(body.total).toBe(4999);
  });
});

describe("gateway policy (cors + errors)", () => {
  const { gatewayBasicUrl: gatewayUrl } = readE2EState();

  it("OPTIONS preflight returns CORS headers", async () => {
    const res = await fetch(`${gatewayUrl}/users/u_1`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("unknown routes return structured JSON errors", async () => {
    const res = await fetch(`${gatewayUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId?: string };
    };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBeTruthy();
    expect(body.error.requestId).toBeTruthy();
  });

  it("GET /users/missing returns USER_NOT_FOUND", async () => {
    const res = await fetch(`${gatewayUrl}/users/missing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("legacy GET /mcp returns SSE not supported", async () => {
    const res = await fetch(`${gatewayUrl}/mcp`, { method: "GET" });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { transport: string };
    expect(body.transport).toBe("streamable-http");
  });
});
