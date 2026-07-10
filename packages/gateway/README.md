# @gmode/gateway
Cloudflare Workers API gateway with typed Service Bindings, middleware, docs aggregation, and MCP/web app hooks.

## Install

```bash
npm i @gmode/gateway
```

Installs `@gmode/core`, `hono`, `zod`, and `@hono/swagger-ui`. Use `@cloudflare/workers-types` in Worker projects for Env and `ExecutionContext` types.

## Quick example

```ts
import { createGateway, cors, jsonErrors, requestId } from "@gmode/gateway";
import type { FetcherLike } from "@gmode/gateway";

type Env = { USERS_API: FetcherLike; GMODE_CONTEXT_SECRET: string };

const gateway = createGateway<Env>({
  name: "Acme API",
  version: "1.0.0",
  internal: { signing: { secret: (env) => env.GMODE_CONTEXT_SECRET } },
});

gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(cors({ origins: ["https://app.example.com"] }));
gateway.service("users", {
  mount: "/users",
  binding: "USERS_API",
  audience: "users",
  scopes: ["users:read"],
});

export default gateway;
```

## API

| Export | Purpose |
|---|---|
| `createGateway` | Create the Worker gateway exported as the default handler. |
| `Gateway`, `GatewayOptions`, `GatewayServiceConfig`, `GatewayWebConfig`, `GatewayMiddleware`, `GatewayRequestContext` | Main gateway runtime and configuration types. |
| `jwtAuth`, `apiKeyAuth` | Authenticate public requests into gateway auth context. |
| `cors`, `requestId`, `jsonErrors`, `requestLogger` | Core HTTP hygiene middleware. |
| `cloudflareRateLimit`, `memoryRateLimit`, `DurableObjectRateLimiter`, `durableObjectRateLimit` | Rate limiting middleware for Cloudflare, local memory, or Durable Objects. |
| `idempotency`, `featureFlags`, `mtls`, `sessionHeader`, `gatewayTelemetry`, `analyticsEngine` | Production controls for writes, flags, certs, Shield sessions, and telemetry. |
| `forwardToService`, `authorizeForService`, `getGatewayInternals`, `aggregateOpenApi` | Lower-level integration hooks for framework packages. |

Middleware catalog:

| Middleware | Use |
|---|---|
| `jwtAuth` / `apiKeyAuth` | Verifies bearer JWTs or API keys and fills `context.auth`. |
| `cors` | Adds CORS headers and handles preflight requests. |
| `requestId` | Generates or preserves the public request id. |
| `jsonErrors` | Serializes thrown errors as GMode error JSON. |
| `cloudflareRateLimit` | Uses Cloudflare native Rate Limiting bindings. |
| `memoryRateLimit` | In-isolate development/test limiter. |
| `durableObjectRateLimit` | Durable Object-backed distributed limiter. |
| `idempotency` | Stores idempotent write responses in KV. |
| `requestLogger` | Emits structured request logs. |
| `gatewayTelemetry` / `analyticsEngine` | Exports gateway spans or Analytics Engine rows. |
| `featureFlags` | Evaluates Flagship gates and forwards flag state. |
| `mtls` | Requires client certificate metadata from Cloudflare. |
| `sessionHeader` | Propagates API Shield `cf-session-id`. |

## Works with

[`@gmode/core`](../core) · [`@gmode/service`](../service) · [`@gmode/mcp`](../mcp) · [`@gmode/web`](../web) · [`@gmode/testing`](../testing) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
