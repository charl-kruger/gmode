# @gmode/service
Private Worker service runtime for validated routes, trusted gateway context, typed handlers, and OpenAPI metadata.

## Install

```bash
npm i @gmode/service
```

Installs `@gmode/core`, `hono`, and Zod v4. Use `@cloudflare/workers-types` in Worker projects for runtime types.

## Quick example

```ts
import { createService, z } from "@gmode/service";

type Env = { GMODE_CONTEXT_SECRET: string };

const User = z.object({ id: z.string(), email: z.string().email() });
const service = createService<Env>({
  name: "Users API",
  version: "1.0.0",
  trustGateway: { audience: "users", secret: (env) => env.GMODE_CONTEXT_SECRET },
});

service.get("/:id", {
  operationId: "getUser",
  params: z.object({ id: z.string() }),
  responses: { 200: User, 404: service.errors.schema },
  handler: ({ params, scopes, ok, error }) => {
    if (!scopes.includes("users:read")) throw error.forbidden();
    return ok({ id: params.id, email: `${params.id}@example.com` });
  },
});

export default service;
```

`trustGateway` verifies the private `x-gmode-context` header from the gateway. Handlers receive `gateway`, `user`, `tenant`, `scopes`, `permissions`, `requestId`, response helpers, and `error` helpers.

## API

| Export | Purpose |
|---|---|
| `createService` | Create a private Worker service with validated routes. |
| `Service`, `ServiceOptions`, `RouteConfig`, `RouteHandlerContext` | Main service runtime and handler types. |
| `z` | Re-exported Zod v4 for route schemas. |
| `withJsonSchema` | Attach explicit JSON Schema to a standard schema. |
| `parseSchema` | Validate unknown input with a GMode schema. |
| `schemaToJsonSchema` | Convert route schemas for OpenAPI output. |
| `isStandardSchema`, `isJsonSchemaBackedStandardSchema` | Schema capability guards. |
| `GModeSchema`, `StandardSchemaV1`, `JsonSchemaBackedStandardSchema` | Schema abstraction types. |

## Works with

[`@gmode/gateway`](../gateway) · [`@gmode/core`](../core) · [`@gmode/rpc`](../rpc) · [`@gmode/web`](../web) · [`@gmode/testing`](../testing) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
