# @gmode/testing
Cloudflare binding mocks and test clients for GMode gateways, services, RPC methods, queues, KV, R2, D1, and flags.

## Install

```bash
npm i -D @gmode/testing
```

Installs `@gmode/core`. Use with Vitest, Node 20+, and `@cloudflare/workers-types` in Worker test projects.

## Quick example

```ts
import { createGateway, jsonErrors } from "@gmode/gateway";
import {
  createGatewayTestClient,
  createMockFetcher,
} from "@gmode/testing";
import type { FetcherLike } from "@gmode/core";

type Env = { USERS_API: FetcherLike };
const gateway = createGateway<Env>({ name: "Test API", version: "1.0.0" });
gateway.use(jsonErrors());
gateway.service("users", { mount: "/users", binding: "USERS_API" });

const users = createMockFetcher(() => Response.json({ id: "u_1" }));
const client = createGatewayTestClient({
  gateway,
  env: { USERS_API: users },
});

const res = await client.get("/users/u_1");
console.log(res.status, users.calls.length);
```

Mock catalog:

| Mock | Purpose |
|---|---|
| `createMockFetcher` | Service Binding `fetch()` mock with recorded calls. |
| `createMockRateLimit` | Cloudflare native Rate Limiting binding mock. |
| `createExecutionContext` | Minimal `ExecutionContext` for unit tests. |
| `createMockFlagship` | Flagship binding mock for boolean/object flags and errors. |
| `createMockRpcBinding` | Service-binding RPC mock with recorded method envelopes. |
| `createMockQueue` | Queue binding mock for sent messages and options. |
| `createMockKvNamespace` | KV namespace mock. |
| `createMockR2Bucket` | R2 bucket mock. |
| `createMockD1Database` | D1 database and prepared statement mock. |
| `createTestJwt` | Signed test JWT helper. |
| `createTestGatewayContext` | Signed or unsigned gateway context test token helper. |
| `createGatewayTestClient` | Convenience client for gateway `fetch` tests. |
| `createServiceTestClient` | Convenience client for service `fetch` tests. |

## API

| Export | Purpose |
|---|---|
| `createMockFetcher`, `createMockRateLimit`, `createExecutionContext` | Fetcher, Rate Limiting, and execution context mocks. |
| `createMockFlagship` | Feature flag binding mock. |
| `createMockRpcBinding` | RPC service binding mock. |
| `createMockQueue`, `createMockKvNamespace`, `createMockR2Bucket`, `createMockD1Database` | Cloudflare storage and queue mocks. |
| `createTestJwt`, `createTestGatewayContext` | Auth and private gateway context token helpers. |
| `createGatewayTestClient`, `createServiceTestClient` | HTTP test clients for GMode runtimes. |
| `MockFetcher`, `MockRateLimit`, `MockFlagship`, `MockRpcBinding`, `MockQueue`, `MockKvNamespace`, `MockR2Bucket`, `MockD1Database` | Main mock types. |

## Works with

[`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/rpc`](../rpc) · [`@gmode/core`](../core) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
