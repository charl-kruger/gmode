import { describe, expect, it } from "vitest";
import { matchesAllScopes, matchesScope } from "./utils";

describe("scope matching", () => {
  it("matches exact scope", () => {
    expect(matchesScope("users:read", ["users:read"])).toBe(true);
  });

  it("matches wildcard prefix", () => {
    expect(matchesScope("users:read", ["users:*"])).toBe(true);
    expect(matchesScope("users:read", ["billing:*"])).toBe(false);
  });

  it("global * matches anything", () => {
    expect(matchesScope("anything", ["*"])).toBe(true);
  });

  it("matchesAllScopes requires all", () => {
    expect(matchesAllScopes(["a:r", "b:r"], ["a:*", "b:*"])).toBe(true);
    expect(matchesAllScopes(["a:r", "b:r"], ["a:*"])).toBe(false);
  });
});
