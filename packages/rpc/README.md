# @gmode/rpc
Typed Cloudflare `WorkerEntrypoint` RPC helpers for private service-to-service calls in GMode.

## Install

```bash
npm i @gmode/rpc
```

Installs `@gmode/core` and `zod`. Worker projects should include `@cloudflare/workers-types`; tests commonly pair this with `@gmode/testing`.

## Quick example

```ts
import { GMODE_HEADERS } from "@gmode/core";
import { createRpcClient, createRpcService, defineEntrypoint } from "@gmode/rpc";
import { createService, z } from "@gmode/service";

type Env = { USERS_RPC: UsersRpc; GMODE_CONTEXT_SECRET: string };
type UsersMethods = {
  getUser: {
    input: { id: string };
    output: { id: string; email: string };
  };
};
const http = createService<Env>({ name: "Users", version: "1.0.0" });
const rpc = createRpcService<Env>({
  name: "Users RPC",
  trustGateway: { audience: "users", secret: (env) => env.GMODE_CONTEXT_SECRET },
}).method("getUser", {
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), email: z.string() }),
  handler: ({ input }) => ({ id: input.id, email: `${input.id}@example.com` }),
});

export type UsersRpc = typeof rpc.client;
export default defineEntrypoint(rpc, { http });

const users = (env: Env, request: Request) => createRpcClient<UsersMethods>({
  binding: env.USERS_RPC,
  context: () => request.headers.get(GMODE_HEADERS.gatewayContext) ?? undefined,
});
await users({} as Env, new Request("https://api.test")).getUser({ id: "u_1" });
```

Wire contract: service-binding methods receive `{ input, context? }` and return `{ ok: true, data } | { ok: false, error }`. `createRpcClient` unwraps `data` and rethrows failures as `ApiError`.

Testing:

```ts
import { createMockRpcBinding } from "@gmode/testing";

const users = createMockRpcBinding({
  async getUser(envelope) {
    return { ok: true, data: { id: (envelope.input as { id: string }).id } };
  },
});
```

GM-04 status: real WorkerEntrypoint dispatch through Cloudflare Service Bindings is a known open issue; prototype-added methods can 500 in e2e. Unit tests can use `service.invoke(...)` or `createMockRpcBinding(...)` until that dispatch bug is fixed.

## API

| Export | Purpose |
|---|---|
| `createRpcService` | Define typed RPC methods with input/output schemas. |
| `defineEntrypoint` | Convert an RPC service into a `WorkerEntrypoint` default export. |
| `createRpcClient` | Build a typed caller from a service binding. |
| `RpcService`, `RpcServiceOptions`, `RpcMethodConfig`, `RpcHandlerContext` | Service and method definition types. |
| `RpcEnvelope`, `RpcResult`, `RpcErrorPayload` | Wire-format types. |
| `RpcServiceClient`, `RpcClientMethods`, `RpcClientCallable`, `CreateRpcClientInput` | Caller and binding type helpers. |

## Works with

[`@gmode/service`](../service) · [`@gmode/core`](../core) · [`@gmode/testing`](../testing) · [`@gmode/gateway`](../gateway) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
