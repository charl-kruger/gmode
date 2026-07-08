import { describe, expect, it } from "vitest";
import {
  encodeGatewayContext,
  type FlagshipBinding,
  type GatewayContext,
} from "@gmode/core";
import { createMockFlagship } from "@gmode/testing";
import { z } from "zod";
import { createRpcService } from "./service";

function execCtx(): ExecutionContext {
  return {
    waitUntil() { },
    passThroughOnException() { },
  } as ExecutionContext;
}

function contextToken(
  override: Partial<GatewayContext> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  return encodeGatewayContext({
    iss: "gmode-gateway",
    aud: "users",
    requestId: "req_rpc",
    authenticated: true,
    scopes: [],
    permissions: [],
    issuedAt: now,
    expiresAt: now + 60,
    ...override,
  });
}

describe("createRpcService", () => {
  it("invokes a registered method and returns ok envelope", async () => {
    type Env = Record<string, never>;
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        audience: "users",
      },
    }).method("getUserById", {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), email: z.string() }),
      handler: async ({ input }) => ({
        id: input.id,
        email: `${input.id}@example.com`,
      }),
    });

    const token = contextToken();
    const result = await service.invoke(
      "getUserById",
      { input: { id: "u1" }, context: token },
      {},
      execCtx(),
    );
    expect(result).toEqual({
      ok: true,
      data: { id: "u1", email: "u1@example.com" },
    });
  });

  it("returns METHOD_NOT_FOUND when method is missing", async () => {
    const service = createRpcService<{}>({ name: "X" });
    const result = await service.invoke(
      "ghost",
      { input: null },
      {},
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("METHOD_NOT_FOUND");
      expect(result.error.status).toBe(404);
    }
  });

  it("returns VALIDATION_ERROR on bad input", async () => {
    const service = createRpcService<{}>({ name: "X" }).method("op", {
      input: z.object({ n: z.number() }),
      handler: async ({ input }) => input.n,
    });
    const result = await service.invoke(
      "op",
      { input: { n: "oops" } as unknown as { n: number; } },
      {},
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing gateway context when trustGateway is required", async () => {
    type Env = Record<string, never>;
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      handler: async () => null,
    });
    const result = await service.invoke(
      "op",
      { input: null },
      {},
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_GATEWAY_CONTEXT");
  });

  it("rejects wrong audience", async () => {
    type Env = Record<string, never>;
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      handler: async () => null,
    });
    const token = contextToken({ aud: "billing" });
    const result = await service.invoke(
      "op",
      { input: null, context: token },
      {},
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_GATEWAY_CONTEXT_AUDIENCE");
    }
  });

  it("enforces scopes", async () => {
    type Env = Record<string, never>;
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      scopes: ["users:read"],
      handler: async () => "ok",
    });

    const insufficient = await service.invoke(
      "op",
      {
        input: null,
        context: contextToken({ scopes: ["billing:read"] }),
      },
      {},
      execCtx(),
    );
    expect(insufficient.ok).toBe(false);
    if (!insufficient.ok) {
      expect(insufficient.error.code).toBe("INSUFFICIENT_SCOPE");
    }

    const ok = await service.invoke(
      "op",
      {
        input: null,
        context: contextToken({ scopes: ["users:*"] }),
      },
      {},
      execCtx(),
    );
    expect(ok).toEqual({ ok: true, data: "ok" });
  });

  it("maps thrown ApiError into the failure envelope", async () => {
    const service = createRpcService<{}>({ name: "X" }).method("op", {
      input: z.any(),
      handler: ({ error }) => {
        throw error.notFound("USER_NOT_FOUND", "no user", { id: "1" });
      },
    });
    const result = await service.invoke("op", { input: null }, {}, execCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("USER_NOT_FOUND");
      expect(result.error.status).toBe(404);
      expect(result.error.details).toEqual({ id: "1" });
    }
  });

  it("gates a method behind a feature flag (service-side)", async () => {
    type Env = { FLAGS: FlagshipBinding; };
    const flags = createMockFlagship({ booleans: { "rpc-v2": false } });
    const service = createRpcService<Env>({
      name: "X",
      flags: { binding: (e) => e.FLAGS },
    }).method("op", {
      input: z.any(),
      featureFlag: "rpc-v2",
      handler: async () => "v2",
    });

    const off = await service.invoke(
      "op",
      { input: null },
      { FLAGS: flags },
      execCtx(),
    );
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error.code).toBe("FEATURE_NOT_AVAILABLE");

    flags.setBoolean("rpc-v2", true);
    const on = await service.invoke(
      "op",
      { input: null },
      { FLAGS: flags },
      execCtx(),
    );
    expect(on).toEqual({ ok: true, data: "v2" });
  });

  it("uses gateway-forwarded flags when no service binding is configured", async () => {
    type Env = Record<string, never>;
    const service = createRpcService<Env>({
      name: "X",
      trustGateway: {
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      featureFlag: "from-gateway",
      handler: async () => "ok",
    });

    const off = await service.invoke(
      "op",
      {
        input: null,
        context: contextToken({ flags: { "from-gateway": false } }),
      },
      {},
      execCtx(),
    );
    expect(off.ok).toBe(false);

    const on = await service.invoke(
      "op",
      {
        input: null,
        context: contextToken({ flags: { "from-gateway": true } }),
      },
      {},
      execCtx(),
    );
    expect(on).toEqual({ ok: true, data: "ok" });
  });

  it("hands the decoded gateway context to the handler", async () => {
    type Env = Record<string, never>;
    let seen: GatewayContext | null = null;
    const service = createRpcService<Env>({
      name: "X",
      trustGateway: {
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      handler: async ({ gateway }) => {
        seen = gateway;
        return null;
      },
    });

    const token = contextToken({
      user: { id: "u1", email: "u1@example.com" },
      scopes: ["users:read"],
    });
    await service.invoke(
      "op",
      { input: null, context: token },
      {},
      execCtx(),
    );
    expect(seen).toBeTruthy();
    expect(seen!.user?.id).toBe("u1");
    expect(seen!.scopes).toEqual(["users:read"]);
  });
});
