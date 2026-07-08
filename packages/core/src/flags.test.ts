import { describe, expect, it } from "vitest";
import {
  buildFlagshipContext,
  createFlagsClient,
  createOpenFeatureProvider,
} from "./flags";
import type { FlagshipBinding } from "./types";

function makeBinding(): FlagshipBinding & {
  calls: { method: string; key: string; ctx?: unknown }[];
} {
  const calls: { method: string; key: string; ctx?: unknown }[] = [];
  const stub: FlagshipBinding & typeof calls extends never
    ? never
    : FlagshipBinding & {
        calls: { method: string; key: string; ctx?: unknown }[];
      } = {
    calls,
    async get(key, _def, ctx) {
      calls.push({ method: "get", key, ctx });
      return undefined;
    },
    async getBooleanValue(key, def, ctx) {
      calls.push({ method: "getBooleanValue", key, ctx });
      return def;
    },
    async getStringValue(key, def, ctx) {
      calls.push({ method: "getStringValue", key, ctx });
      return def;
    },
    async getNumberValue(key, def, ctx) {
      calls.push({ method: "getNumberValue", key, ctx });
      return def;
    },
    async getObjectValue(key, def, ctx) {
      calls.push({ method: "getObjectValue", key, ctx });
      return def;
    },
    async getBooleanDetails(key, def, ctx) {
      calls.push({ method: "getBooleanDetails", key, ctx });
      return { value: def };
    },
    async getStringDetails(key, def, ctx) {
      calls.push({ method: "getStringDetails", key, ctx });
      return { value: def };
    },
    async getNumberDetails(key, def, ctx) {
      calls.push({ method: "getNumberDetails", key, ctx });
      return { value: def };
    },
    async getObjectDetails(key, def, ctx) {
      calls.push({ method: "getObjectDetails", key, ctx });
      return { value: def };
    },
  };
  return stub;
}

describe("buildFlagshipContext", () => {
  it("only emits known auth fields when present, joining array fields to primitives", () => {
    const ctx = buildFlagshipContext({
      auth: {
        authenticated: true,
        user: { id: "u1", email: "u@example.com" },
        tenant: { id: "t1" },
        scopes: ["users:read", "users:write"],
        permissions: ["admin"],
      },
      requestId: "req_1",
    });
    expect(ctx).toEqual({
      userId: "u1",
      email: "u@example.com",
      tenantId: "t1",
      scopes: "users:read users:write",
      permissions: "admin",
      requestId: "req_1",
    });
  });

  it("emits only primitives — matches FlagshipEvaluationContext = Record<string, string | number | boolean>", () => {
    const ctx = buildFlagshipContext({
      auth: {
        authenticated: true,
        user: { id: "u1" },
        scopes: ["a", "b"],
        permissions: [],
      },
    });
    for (const v of Object.values(ctx)) {
      expect(["string", "number", "boolean"]).toContain(typeof v);
    }
  });

  it("omits absent fields", () => {
    const ctx = buildFlagshipContext({
      auth: {
        authenticated: false,
        scopes: [],
        permissions: [],
      },
    });
    expect(ctx).toEqual({});
  });
});

describe("createFlagsClient", () => {
  it("passes context to every call", async () => {
    const binding = makeBinding();
    const client = createFlagsClient(binding, { userId: "u1" });
    await client.getBooleanValue("a", false);
    await client.getStringValue("b", "x");
    expect(binding.calls[0]?.ctx).toEqual({ userId: "u1" });
    expect(binding.calls[1]?.ctx).toEqual({ userId: "u1" });
  });

  it("withContext layers additional attributes", async () => {
    const binding = makeBinding();
    const base = createFlagsClient(binding, { userId: "u1" });
    const scoped = base.withContext({ route: "/users" });
    await scoped.getBooleanValue("a", false);
    expect(binding.calls[0]?.ctx).toEqual({
      userId: "u1",
      route: "/users",
    });
    // base unaffected
    await base.getBooleanValue("a", false);
    expect(binding.calls[1]?.ctx).toEqual({ userId: "u1" });
  });
});

describe("createOpenFeatureProvider", () => {
  it("resolves boolean flags with merged primitive context", async () => {
    const binding = makeBinding();
    const provider = createOpenFeatureProvider(binding, { tenantId: "t1" });
    const result = await provider.resolveBooleanEvaluation(
      "checkout",
      false,
      { userId: "u1" },
    );

    expect(provider.metadata.name).toBe("gmode-flagship");
    expect(result).toEqual({ value: false });
    expect(binding.calls[0]).toMatchObject({
      method: "getBooleanDetails",
      key: "checkout",
      ctx: { tenantId: "t1", userId: "u1" },
    });
  });

  it("resolves string, number, and object flags", async () => {
    const binding = makeBinding();
    const provider = createOpenFeatureProvider(binding);

    await expect(
      provider.resolveStringEvaluation("copy", "default"),
    ).resolves.toEqual({ value: "default" });
    await expect(
      provider.resolveNumberEvaluation("ratio", 0.5),
    ).resolves.toEqual({ value: 0.5 });
    await expect(
      provider.resolveObjectEvaluation("config", { mode: "safe" }),
    ).resolves.toEqual({ value: { mode: "safe" } });
  });
});
