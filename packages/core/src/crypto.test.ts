import { describe, expect, it } from "vitest";
import {
  signGatewayContext,
  verifyGatewayContext,
} from "./crypto";
import type { GatewayContext } from "./types";
import { ApiError } from "./errors";

const secret = "test-secret";

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

describe("gateway context signing", () => {
  it("signs and verifies a valid context", async () => {
    const token = await signGatewayContext(makeCtx(), secret);
    const verified = await verifyGatewayContext(token, secret, {
      audience: "users",
    });
    expect(verified.requestId).toBe("req_1");
    expect(verified.scopes).toEqual(["users:read"]);
  });

  it("rejects bad signatures", async () => {
    const token = await signGatewayContext(makeCtx(), secret);
    await expect(
      verifyGatewayContext(token, "wrong-secret", { audience: "users" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects wrong audience", async () => {
    const token = await signGatewayContext(makeCtx(), secret);
    await expect(
      verifyGatewayContext(token, secret, { audience: "billing" }),
    ).rejects.toMatchObject({ code: "INVALID_GATEWAY_CONTEXT_AUDIENCE" });
  });

  it("rejects expired context", async () => {
    const expired = makeCtx({ expiresAt: Math.floor(Date.now() / 1000) - 120 });
    const token = await signGatewayContext(expired, secret);
    await expect(
      verifyGatewayContext(token, secret, { audience: "users" }),
    ).rejects.toMatchObject({ code: "EXPIRED_GATEWAY_CONTEXT" });
  });

  it("rejects tokens with the wrong shape", async () => {
    await expect(
      verifyGatewayContext("not-a-token", secret, { audience: "users" }),
    ).rejects.toMatchObject({ code: "INVALID_GATEWAY_CONTEXT" });
  });
});
