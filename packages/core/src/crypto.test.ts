import { describe, expect, it } from "vitest";
import {
  decodeGatewayContext,
  encodeGatewayContext,
  encodeSignedGatewayContext,
  verifyGatewayContext,
} from "./crypto";
import type { GatewayContext } from "./types";
import { ApiError } from "./errors";

function makeCtx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "gmode-gateway",
    aud: "users",
    requestId: "req_1",
    authenticated: true,
    scopes: ["users:read"],
    permissions: [],
    issuedAt: now,
    expiresAt: now + 60,
    ...overrides,
  };
}

describe("gateway context encoding", () => {
  it("encodes and decodes a valid context", () => {
    const token = encodeGatewayContext(makeCtx());
    const verified = decodeGatewayContext(token, {
      audience: "users",
    });
    expect(verified.requestId).toBe("req_1");
    expect(verified.scopes).toEqual(["users:read"]);
  });

  it("rejects wrong audience", () => {
    const token = encodeGatewayContext(makeCtx());
    expect(() =>
      decodeGatewayContext(token, { audience: "billing" }),
    ).toThrowError(ApiError);
    expect(() =>
      decodeGatewayContext(token, { audience: "billing" }),
    ).toThrowError(/audience/);
  });

  it("rejects expired context", () => {
    const expired = makeCtx({ expiresAt: Math.floor(Date.now() / 1000) - 120 });
    const token = encodeGatewayContext(expired);
    expect(() =>
      decodeGatewayContext(token, { audience: "users" }),
    ).toThrowError(/expired/);
  });

  it("rejects tokens with the wrong shape", () => {
    expect(() =>
      decodeGatewayContext("not-a-token", { audience: "users" }),
    ).toThrowError(ApiError);
  });
});

describe("signed gateway context", () => {
  const secret = "test-secret-value";

  it("signs and verifies a valid context", async () => {
    const token = await encodeSignedGatewayContext(makeCtx(), secret);
    expect(token).toContain(".");
    const verified = await verifyGatewayContext(token, {
      audience: "users",
      secret,
    });
    expect(verified.requestId).toBe("req_1");
    expect(verified.authenticated).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const token = await encodeSignedGatewayContext(makeCtx(), secret);
    const [payload, signature] = token.split(".") as [string, string];
    const other = await encodeSignedGatewayContext(
      makeCtx({ scopes: ["admin:*"] }),
      secret,
    );
    const [otherPayload] = other.split(".") as [string];
    expect(otherPayload).not.toBe(payload);
    await expect(
      verifyGatewayContext(`${otherPayload}x.${signature}`, {
        audience: "users",
        secret,
      }),
    ).rejects.toThrowError(/signature/i);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await encodeSignedGatewayContext(makeCtx(), "wrong-secret");
    await expect(
      verifyGatewayContext(token, { audience: "users", secret }),
    ).rejects.toThrowError(/signature/i);
  });

  it("rejects signed tokens when no secret is configured", async () => {
    const token = await encodeSignedGatewayContext(makeCtx(), secret);
    await expect(
      verifyGatewayContext(token, { audience: "users" }),
    ).rejects.toThrowError(/no context secret/i);
  });

  it("rejects unsigned tokens when a secret is configured", async () => {
    const token = encodeGatewayContext(makeCtx());
    await expect(
      verifyGatewayContext(token, { audience: "users", secret }),
    ).rejects.toThrowError(/unsigned/i);
  });

  it("accepts unsigned tokens with allowUnsigned", async () => {
    const token = encodeGatewayContext(makeCtx());
    const verified = await verifyGatewayContext(token, {
      audience: "users",
      secret,
      allowUnsigned: true,
    });
    expect(verified.requestId).toBe("req_1");
  });

  it("accepts unsigned tokens when no secret is configured", async () => {
    const token = encodeGatewayContext(makeCtx());
    const verified = await verifyGatewayContext(token, { audience: "users" });
    expect(verified.aud).toBe("users");
  });

  it("still validates claims on signed tokens", async () => {
    const expired = makeCtx({
      expiresAt: Math.floor(Date.now() / 1000) - 120,
    });
    const token = await encodeSignedGatewayContext(expired, secret);
    await expect(
      verifyGatewayContext(token, { audience: "users", secret }),
    ).rejects.toThrowError(/expired/i);
  });
});
