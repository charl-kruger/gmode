# Getting Started

## Install

```bash
pnpm install
```

## Create A Gateway Worker

```ts
import {
  cloudflareRateLimit,
  cors,
  createGateway,
  idempotency,
  jsonErrors,
  jwtAuth,
  requestId,
  requestLogger,
} from "@gmode/gateway";
import type { CloudflareRateLimitBinding, FetcherLike } from "@gmode/core";

type Env = {
  USERS_API: FetcherLike;
  API_RATE_LIMITER: CloudflareRateLimitBinding;
  IDEMPOTENCY: KVNamespace;
  JWT_SECRET: string;
  INTERNAL_SIGNING_SECRET: string;
};

const gateway = createGateway<Env>({
  name: "Example API",
  version: "1.0.0",
  internal: { signingSecret: (env) => env.INTERNAL_SIGNING_SECRET },
});

gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(requestLogger());
gateway.use(cors());
gateway.use(jwtAuth({ secret: (env) => env.JWT_SECRET, required: false }));
gateway.use(cloudflareRateLimit({ binding: "API_RATE_LIMITER" }));
gateway.use(idempotency({ binding: "IDEMPOTENCY", ttlSeconds: 86_400 }));

gateway.service("users", {
  mount: "/users",
  binding: "USERS_API",
  audience: "users",
  openapi: true,
});

export default gateway;
```

`gateway.service(...)` uses Cloudflare Service Bindings. The binding name must
match the `services` entry in the gateway `wrangler.jsonc`.

## Create A Service Worker

```ts
import { createService, z } from "@gmode/service";

type Env = { INTERNAL_SIGNING_SECRET: string };

const service = createService<Env>({
  name: "Users API",
  version: "1.0.0",
  trustGateway: {
    signingSecret: (env) => env.INTERNAL_SIGNING_SECRET,
    audience: "users",
  },
});

service.get("/:id", {
  operationId: "getUser",
  summary: "Get user",
  scopes: ["users:read"],
  params: z.object({ id: z.string() }),
  responses: {
    200: z.object({ id: z.string(), email: z.string() }),
    404: service.errors.schema,
  },
  handler: async ({ params }) => ({
    id: params.id,
    email: "demo@example.com",
  }),
});

export default service;
```

Services expose their internal OpenAPI document at `/__gmode/openapi.json`.
The gateway fetches those specs over Service Bindings and serves the merged
document at `/openapi.json`.

## Standard Schema

Zod is the default schema system, but services can also accept Standard Schema
validators. Non-Zod validators must be wrapped with explicit JSON Schema so
OpenAPI emission never guesses.

```ts
import { withJsonSchema, type StandardSchemaV1 } from "@gmode/service";

const Body: StandardSchemaV1<unknown, { name: string }> = {
  "~standard": {
    version: 1,
    vendor: "example",
    validate: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value)
      ) {
        return { issues: [{ message: "body must be an object", path: [] }] };
      }
      const record = value as Record<string, unknown>;
      if (typeof record.name !== "string") {
        return { issues: [{ message: "name is required", path: ["name"] }] };
      }
      return { value: { name: record.name } };
    },
  },
};

service.post("/standard", {
  body: withJsonSchema(Body, {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  }),
  responses: { 201: z.object({ id: z.string() }) },
  handler: ({ body, created }) => created({ id: body.name }),
});
```

## Middleware Map

| Need | Middleware or package |
|---|---|
| mTLS at the edge | `mtls()` |
| Feature flags and rollouts | `featureFlags()` |
| API Shield Sequence Analytics session ID | `sessionHeader()` |
| Retry-safe writes | `idempotency()` |
| Expose every API operation to AI agents | `mountMcp()` from `@gmode/mcp` |
| Service-to-service RPC | `defineEntrypoint()` from `@gmode/rpc` |
| Shield-flavored OpenAPI upload | `@gmode/cli` Shield commands |

## Next Steps

- Configure bindings, secrets, rate limits, and observability in [Cloudflare configuration](./cloudflare-configuration.md).
- Add authentication and gateway trust in [Auth and security](./auth-and-security.md).
- Expose the gateway to MCP-compatible clients in [MCP server](./mcp.md).
- Run the local example from [TESTING.md](../TESTING.md).
