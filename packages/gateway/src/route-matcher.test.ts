import { describe, expect, it } from "vitest";
import { matchService, validateMount } from "./route-matcher";
import type { GatewayServiceEntry } from "./types";

function svc(
  name: string,
  mount: `/${string}`,
  stripPrefix = true,
): GatewayServiceEntry<Record<string, unknown>> {
  return {
    name,
    config: {
      mount,
      binding: "BIND",
      stripPrefix,
    },
  };
}

describe("validateMount", () => {
  it("requires leading slash", () => {
    expect(() => validateMount("users")).toThrow();
  });
  it("rejects trailing slash on non-root", () => {
    expect(() => validateMount("/users/")).toThrow();
  });
  it("allows root", () => {
    expect(() => validateMount("/")).not.toThrow();
  });
});

describe("matchService", () => {
  const services = [svc("u", "/users"), svc("ud", "/users/details")];

  it("matches exact mount", () => {
    const m = matchService("/users", services);
    expect(m?.service.name).toBe("u");
    expect(m?.rewrittenPath).toBe("/");
  });

  it("matches subpath", () => {
    const m = matchService("/users/123", services);
    expect(m?.service.name).toBe("u");
    expect(m?.rewrittenPath).toBe("/123");
  });

  it("longest prefix wins", () => {
    const m = matchService("/users/details/abc", services);
    expect(m?.service.name).toBe("ud");
    expect(m?.rewrittenPath).toBe("/abc");
  });

  it("does not match /users2", () => {
    const m = matchService("/users2", services);
    expect(m).toBeNull();
  });

  it("preserves path when stripPrefix=false", () => {
    const m = matchService("/users/1", [svc("u", "/users", false)]);
    expect(m?.rewrittenPath).toBe("/users/1");
  });
});
