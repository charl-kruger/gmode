import { describe, expect, it } from "vitest";
import {
  base64urlEncodeString,
  hmacSign,
  type FetcherLike,
  type CloudflareRateLimitBinding,
} from "@gmode/core";
import { createGateway } from "./create-gateway";
import { requestId } from "./middleware/request-id";
import { jsonErrors } from "./middleware/json-errors";
import { jwtAuth } from "./middleware/auth";

const JWT_SECRET = "jwt-test-secret";
async function makeJwt(claims: Record<string, unknown>): Promise<string> {
  const header = base64urlEncodeString(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const payload = base64urlEncodeString(JSON.stringify(claims));
  const sig = await hmacSign(JWT_SECRET, `${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

function mockFetcher(handler: (req: Request) => Response) {
  const calls: Request[] = [];
  return {
    calls,
    async fetch(req: Request) {
      calls.push(req);
      return handler(req);
    },
  } satisfies FetcherLike & { calls: Request[]; };
}

function execCtx(): ExecutionContext {
  return {
    waitUntil() { },
    passThroughOnException() { },
  } as ExecutionContext;
}

type Env = {
  USERS_API: FetcherLike;
  RL: CloudflareRateLimitBinding;
};

function buildGateway() {
  const users = mockFetcher(() => new Response("{}"));
  const gateway = createGateway<Env>({
    name: "T",
    version: "1.0.0",
  });
  gateway.use(requestId());
  gateway.use(jsonErrors());
  gateway.use(jwtAuth<Env>({
    secret: () => JWT_SECRET,
    required: true
  }));
  gateway.service("users", { mount: "/users", binding: "USERS_API" });
  return { gateway, users };
}

describe("jwtAuth", () => {
  it("accepts valid HS256 token", async () => {
    const { gateway, users } = buildGateway();
    const now = Math.floor(Date.now() / 1000);
    const token = await makeJwt({
      sub: "user_1",
      exp: now + 60,
      iat: now,
      scope: "users:read",
    });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1", {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        USERS_API: users,
        RL: {} as CloudflareRateLimitBinding,
      },
      execCtx(),
    );
    expect(res.status).toBe(200);
  });

  it("rejects missing required token", async () => {
    const { gateway, users } = buildGateway();
    const res = await gateway.fetch(
      new Request("https://api.test/users/1"),
      {
        USERS_API: users,
        RL: {} as CloudflareRateLimitBinding,
      },
      execCtx(),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; }; };
    expect(body.error.code).toBe("MISSING_AUTH_TOKEN");
  });

  it("rejects expired token", async () => {
    const { gateway, users } = buildGateway();
    const now = Math.floor(Date.now() / 1000);
    const token = await makeJwt({ sub: "u", exp: now - 60 });
    const res = await gateway.fetch(
      new Request("https://api.test/users/1", {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        USERS_API: users,
        RL: {} as CloudflareRateLimitBinding,
      },
      execCtx(),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; }; };
    expect(body.error.code).toBe("AUTH_TOKEN_EXPIRED");
  });

  it("rejects bad signature", async () => {
    const { gateway, users } = buildGateway();
    const now = Math.floor(Date.now() / 1000);
    const header = base64urlEncodeString(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    );
    const payload = base64urlEncodeString(
      JSON.stringify({ sub: "u", exp: now + 60 }),
    );
    const sig = await hmacSign("wrong", `${header}.${payload}`);
    const token = `${header}.${payload}.${sig}`;

    const res = await gateway.fetch(
      new Request("https://api.test/users/1", {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        USERS_API: users,
        RL: {} as CloudflareRateLimitBinding,
      },
      execCtx(),
    );
    expect(res.status).toBe(401);
  });
});
