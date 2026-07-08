import { describe, expect, it } from "vitest";
import { type FetcherLike } from "@gmode/core";
import { createGateway } from "./create-gateway";
import { jsonErrors } from "./middleware/json-errors";
import {
  DurableObjectRateLimiter,
  durableObjectRateLimit,
  type DurableObjectRateLimiterNamespace,
  type DurableObjectRateLimitStorage,
} from "./middleware/durable-object-rate-limit";

function execCtx(): ExecutionContext {
  return {
    waitUntil() { },
    passThroughOnException() { },
  } as ExecutionContext;
}

function mockFetcher(): FetcherLike {
  return {
    async fetch() {
      return Response.json({ ok: true });
    },
  };
}

function createStorage(): DurableObjectRateLimitStorage {
  const values = new Map<string, unknown>();
  return {
    async get<T = unknown>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T = unknown>(key: string, value: T) {
      values.set(key, value);
    },
  };
}

function createNamespace(): DurableObjectRateLimiterNamespace & {
  readonly names: string[];
} {
  const objects = new Map<string, DurableObjectRateLimiter>();
  const names: string[] = [];
  return {
    names,
    getByName(name) {
      names.push(name);
      let object = objects.get(name);
      if (!object) {
        object = new DurableObjectRateLimiter({ storage: createStorage() });
        objects.set(name, object);
      }
      return object;
    },
  };
}

describe("durableObjectRateLimit", () => {
  it("coordinates limits by deterministic Durable Object name", async () => {
    type Env = {
      USERS_API: FetcherLike;
      LIMITER: DurableObjectRateLimiterNamespace;
    };
    const limiter = createNamespace();
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(jsonErrors());
    gateway.use(
      durableObjectRateLimit<Env, "LIMITER">({
        binding: "LIMITER",
        namespace: "tenant",
        key: () => "acme",
        limit: 2,
        periodSeconds: 60,
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const env: Env = {
      USERS_API: mockFetcher(),
      LIMITER: limiter,
    };

    const first = await gateway.fetch(
      new Request("https://api.test/users"),
      env,
      execCtx(),
    );
    const second = await gateway.fetch(
      new Request("https://api.test/users"),
      env,
      execCtx(),
    );
    const third = await gateway.fetch(
      new Request("https://api.test/users"),
      env,
      execCtx(),
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("x-rate-limit-policy")).toBe("durable-object");
    expect(first.headers.get("x-rate-limit-remaining")).toBe("1");
    expect(second.status).toBe(200);
    expect(second.headers.get("x-rate-limit-remaining")).toBe("0");
    expect(third.status).toBe(429);
    expect(limiter.names).toEqual(["tenant:acme", "tenant:acme", "tenant:acme"]);
  });

  it("fails loudly when the Durable Object binding is missing", async () => {
    type Env = {
      USERS_API: FetcherLike;
      LIMITER?: DurableObjectRateLimiterNamespace;
    };
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
    });
    gateway.use(jsonErrors());
    gateway.use(
      durableObjectRateLimit<Env, "LIMITER">({
        binding: "LIMITER",
        key: () => "acme",
        limit: 2,
        periodSeconds: 60,
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users"),
      {
        USERS_API: mockFetcher(),
      },
      execCtx(),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  });
});
