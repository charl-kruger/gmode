import { describe, expect, it } from "vitest";
import {
  signGatewayContext,
  type FlagshipBinding,
  type GatewayContext,
} from "@gmode/core";
import { createMockFlagship } from "@gmode/testing";
import { z } from "zod";
import { createRpcService } from "./service";

const SIGNING = "rpc-test-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

async function signToken(
  override: Partial<GatewayContext> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signGatewayContext(
    {
      iss: "gmode-gateway",
      aud: "users",
      requestId: "req_rpc",
      authenticated: true,
      scopes: [],
      permissions: [],
      issuedAt: now,
      expiresAt: now + 60,
      ...override,
    },
    SIGNING,
  );
}

describe("createRpcService", () => {
  it("invokes a registered method and returns ok envelope", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
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

    const token = await signToken();
    const result = await service.invoke(
      "getUserById",
      { input: { id: "u1" }, context: token },
      { INTERNAL_SIGNING_SECRET: SIGNING },
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
      { input: { n: "oops" } as unknown as { n: number } },
      {},
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing gateway context when trustGateway is required", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      handler: async () => null,
    });
    const result = await service.invoke(
      "op",
      { input: null },
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_GATEWAY_CONTEXT");
  });

  it("rejects wrong audience", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      handler: async () => null,
    });
    const token = await signToken({ aud: "billing" });
    const result = await service.invoke(
      "op",
      { input: null, context: token },
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_GATEWAY_CONTEXT_AUDIENCE");
    }
  });

  it("enforces scopes", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const service = createRpcService<Env>({
      name: "Users API",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
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
        context: await signToken({ scopes: ["billing:read"] }),
      },
      { INTERNAL_SIGNING_SECRET: SIGNING },
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
        context: await signToken({ scopes: ["users:*"] }),
      },
      { INTERNAL_SIGNING_SECRET: SIGNING },
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
    type Env = { FLAGS: FlagshipBinding };
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

  it("falls back to gateway-forwarded flags when no service binding", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    const service = createRpcService<Env>({
      name: "X",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
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
        context: await signToken({ flags: { "from-gateway": false } }),
      },
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(off.ok).toBe(false);

    const on = await service.invoke(
      "op",
      {
        input: null,
        context: await signToken({ flags: { "from-gateway": true } }),
      },
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(on).toEqual({ ok: true, data: "ok" });
  });

  it("hands the verified gateway to the handler", async () => {
    type Env = { INTERNAL_SIGNING_SECRET: string };
    let seen: GatewayContext | null = null;
    const service = createRpcService<Env>({
      name: "X",
      trustGateway: {
        signingSecret: (e) => e.INTERNAL_SIGNING_SECRET,
        audience: "users",
      },
    }).method("op", {
      input: z.any(),
      handler: async ({ gateway }) => {
        seen = gateway;
        return null;
      },
    });

    const token = await signToken({
      user: { id: "u1", email: "u1@example.com" },
      scopes: ["users:read"],
    });
    await service.invoke(
      "op",
      { input: null, context: token },
      { INTERNAL_SIGNING_SECRET: SIGNING },
      execCtx(),
    );
    expect(seen).toBeTruthy();
    expect(seen!.user?.id).toBe("u1");
    expect(seen!.scopes).toEqual(["users:read"]);
  });
});
