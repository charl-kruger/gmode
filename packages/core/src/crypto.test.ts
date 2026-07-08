import { describe, expect, it } from "vitest";
import {
  decodeGatewayContext,
  encodeGatewayContext,
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
