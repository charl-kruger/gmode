# Getting Started

Two paths:

1. **Workspace scaffold** (recommended) — `pnpm create gmode my-app`, then
   `gmode new service` / `gmode dev`. See [Workspace CLI](./workspace-cli.md).
2. **Hand-written Workers** — copy the gateway and service patterns below into
   your own `wrangler.jsonc` projects.

## Install (monorepo contributors)

```bash
pnpm install
pnpm build
```

## Scaffold A Workspace

```bash
pnpm create gmode my-app
cd my-app
pnpm install
pnpm exec gmode new service users
pnpm dev
```

- Gateway: http://localhost:8787
- API docs: http://localhost:8787/docs
- Dev dashboard: http://localhost:9100

Add a TanStack Start web app:

```bash
pnpm exec gmode new web dashboard --framework tanstack-start
pnpm dev
```

## Create A Gateway Worker

```ts
import {
  cloudflareRateLimit,
  cors,
  createGateway,
  jsonErrors,
  jwtAuth,
  requestId,
  requestLogger,
} from "@gmode/gateway";
import type { CloudflareRateLimitBinding, FetcherLike } from "@gmode/core";

type Env = {
  USERS_API: FetcherLike;
  API_RATE_LIMITER: CloudflareRateLimitBinding;
  JWT_SECRET: string;
  GMODE_CONTEXT_SECRET?: string;
};

const gateway = createGateway<Env>({
  name: "Example API",
  version: "1.0.0",
});

gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(requestLogger());
gateway.use(cors());
gateway.use(jwtAuth({ secret: (env) => env.JWT_SECRET, required: false }));
gateway.use(cloudflareRateLimit({ binding: "API_RATE_LIMITER" }));

gateway.service("users", {
  mount: "/users",
  binding: "USERS_API",
  audience: "users",
  auth: false,
  openapi: true,
});

export default gateway;
```

`gateway.service(...)` uses Cloudflare Service Bindings. The binding name must
match the `services` entry in the gateway `wrangler.jsonc`. Downstream service
Workers should stay private: set `workers_dev: false` and do not add routes or
custom domains to them.

List `GMODE_CONTEXT_SECRET` under `secrets.required` in the gateway
`wrangler.jsonc` so Wrangler injects it from `.dev.vars` in local dev. See
[Auth and security](./auth-and-security.md).

## Create A Service Worker

```ts
import { createService, z } from "@gmode/service";

type Env = Record<string, never>;

const service = createService<Env>({
  name: "Users API",
  version: "1.0.0",
  trustGateway: {
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

Services expose internal OpenAPI at `/__gmode/openapi.json`. The gateway
fetches those specs over Service Bindings and serves the merged document at
`/openapi.json`.

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
| Gateway-owned Workers Cache policy | `cache` on `createGateway()` and `gateway.service()` |
| Retry-safe writes | `idempotency()` |
| Expose every API operation to AI agents | `mountMcp()` from `@gmode/mcp` |
| Service-to-service RPC | `defineEntrypoint()` from `@gmode/rpc` |
| TanStack / Vite behind the gateway | `withGmode()` / `createWebApp()` from `@gmode/web` |
| Typed fetch client from OpenAPI | `gmode generate client` |
| Shield-flavored OpenAPI upload | `gmode shield:*` commands |

## Next Steps

- [Workspace CLI](./workspace-cli.md) — manifest, dev, deploy, codegen
- [Cloudflare configuration](./cloudflare-configuration.md) — bindings, secrets, cache
- [Auth and security](./auth-and-security.md) — JWT, signing, private context
- [MCP server](./mcp.md) — AI agent access
- [web-app-tanstack example](../examples/web-app-tanstack/README.md) — full platform demo
- [TESTING.md](../TESTING.md) — local and CI verification
