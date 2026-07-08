import { describe, expect, it } from "vitest";
import { ApiError } from "@gmode/core";
import { createMockRpcBinding } from "@gmode/testing";
import { z } from "zod";
import { createRpcClient } from "./client";
import { createRpcService } from "./service";

const SIGNING = "rpc-test-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

describe("createRpcClient", () => {
  it("unwraps ok envelopes into the data", async () => {
    const binding = createMockRpcBinding({
      async hello(envelope) {
        const { name } = envelope.input as { name: string };
        return { ok: true, data: `hello ${name}` };
      },
    });
    type Methods = {
      hello: { input: { name: string }; output: string };
    };
    const client = createRpcClient<Methods>({ binding });
    const result = await client.hello({ name: "world" });
    expect(result).toBe("hello world");
    expect(binding.calls).toEqual([
      { method: "hello", envelope: { input: { name: "world" } } },
    ]);
  });

  it("rethrows ApiError on failure envelope, preserving code/status/details", async () => {
    const binding = createMockRpcBinding({
      async hello() {
        return {
          ok: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "no user",
            status: 404,
            details: { id: "1" },
          },
        };
      },
    });
    const client = createRpcClient<{
      hello: { input: unknown; output: unknown };
    }>({ binding });
    await expect(client.hello(null)).rejects.toBeInstanceOf(ApiError);
    try {
      await client.hello(null);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe("USER_NOT_FOUND");
      expect(apiErr.status).toBe(404);
      expect(apiErr.details).toEqual({ id: "1" });
    }
  });

  it("forwards a literal context string in the envelope", async () => {
    const binding = createMockRpcBinding({
      async hello(envelope) {
        return { ok: true, data: envelope.context ?? "no-token" };
      },
    });
    const client = createRpcClient<{
      hello: { input: null; output: string };
    }>({
      binding,
      context: "abc.def",
    });
    expect(await client.hello(null)).toBe("abc.def");
  });

  it("calls the context thunk on every invocation", async () => {
    let calls = 0;
    const binding = createMockRpcBinding({
      async hello(envelope) {
        return { ok: true, data: envelope.context ?? "no-token" };
      },
    });
    const client = createRpcClient<{
      hello: { input: null; output: string };
    }>({
      binding,
      context: () => {
        calls++;
        return `token-${calls}`;
      },
    });
    expect(await client.hello(null)).toBe("token-1");
    expect(await client.hello(null)).toBe("token-2");
    expect(calls).toBe(2);
  });

  it("end-to-end: service + client over a single in-process binding", async () => {
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

    const env: Env = { INTERNAL_SIGNING_SECRET: SIGNING };
    const ctx = execCtx();

    // Bridge that mimics what defineEntrypoint does in production
    const binding = {
      async getUserById(envelope: {
        input: { id: string };
        context?: string;
      }) {
        return service.invoke(
          "getUserById",
          envelope,
          env,
          ctx,
        ) as Promise<
          | { ok: true; data: { id: string; email: string } }
          | {
              ok: false;
              error: {
                code: string;
                message: string;
                status: number;
                details?: unknown;
              };
            }
        >;
      },
    };

    const { signGatewayContext } = await import("@gmode/core");
    const now = Math.floor(Date.now() / 1000);
    const token = await signGatewayContext(
      {
        iss: "gmode-gateway",
        aud: "users",
        requestId: "req_e2e",
        authenticated: true,
        scopes: ["users:read"],
        permissions: [],
        issuedAt: now,
        expiresAt: now + 60,
      },
      SIGNING,
    );

    const client = createRpcClient<{
      getUserById: {
        input: { id: string };
        output: { id: string; email: string };
      };
    }>({
      binding,
      context: token,
    });

    const user = await client.getUserById({ id: "u1" });
    expect(user).toEqual({ id: "u1", email: "u1@example.com" });
  });
});
