# Service-To-Service RPC

`@gmode/rpc` wraps Cloudflare `WorkerEntrypoint` so private services can
call each other with typed methods over Service Bindings.

A single Worker can be both HTTP-callable by the gateway and RPC-callable by
peer services.

## Define An RPC Service

```ts
import { createRpcService, defineEntrypoint } from "@gmode/rpc";
import { createService, z } from "@gmode/service";

const http = createService<Env>({ /* HTTP routes */ });

const rpc = createRpcService<Env>({
  name: "Users API",
  trustGateway: {
    signingSecret: (env) => env.INTERNAL_SIGNING_SECRET,
    audience: "users",
  },
}).method("getUserById", {
  scopes: ["users:read"],
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), email: z.string() }),
  handler: async ({ input }) => ({
    id: input.id,
    email: `${input.id}@example.com`,
  }),
});

export type UsersApiRpc = typeof rpc.client;
export default defineEntrypoint(rpc, { http });
```

## Call From Another Service

```ts
import { createRpcClient } from "@gmode/rpc";
import { GMODE_HEADERS } from "@gmode/core";
import type { UsersApiRpc } from "../../users-api/src/index";

type Env = {
  INTERNAL_SIGNING_SECRET: string;
  USERS_API: UsersApiRpc;
};

const users = createRpcClient<{
  getUserById: {
    input: { id: string };
    output: { id: string; email: string };
  };
}>({
  binding: env.USERS_API,
  context: () =>
    request.headers.get(GMODE_HEADERS.gatewayContext) ?? undefined,
});

const user = await users.getUserById({ id: body.userId });
```

## Wire Format

- Methods take `{ input, context? }`.
- Methods return `{ ok: true, data } | { ok: false, error }`.
- `createRpcClient` unwraps success values and reconstructs `ApiError` for failures.
- The error envelope preserves `code`, `message`, `status`, and `details`.

## Testing

```ts
import { createMockRpcBinding } from "@gmode/testing";

const fakeUsers = createMockRpcBinding({
  async getUserById(envelope) {
    return {
      ok: true,
      data: {
        id: (envelope.input as { id: string }).id,
        email: "test@example.com",
      },
    };
  },
});

fakeUsers.calls;
fakeUsers.reset();
```

For service-side tests, call `service.invoke("methodName", envelope, env, ctx)`
directly.
