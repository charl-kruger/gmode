# @gmode/web

Mount TanStack Start and Vite React apps as GMode gateway services with
embedded typed APIs and OpenAPI aggregation.

## `withGmode()`

Wrap a TanStack Start (or similar) server handler to serve internal routes and
an optional embedded API:

```ts
import { withGmode } from "@gmode/web";
import { createService, z } from "@gmode/service";
import handler from "@tanstack/react-start/server-entry";

const api = createService({ name: "App API", version: "1.0.0" });
api.get("/todos", {
  operationId: "listTodos",
  responses: { 200: z.object({ data: z.array(Todo) }) },
  handler: async () => ({ data: [] }),
});

export default withGmode(handler, {
  basePath: "/app",
  apiMount: "/api",
  api: api.handler,
  openapi: true,
});
```

`withGmode()` serves:

- `{basePath}/__gmode/health` — health probe for the gateway
- `{basePath}{apiMount}/openapi.json` — OpenAPI for aggregation
- `{basePath}{apiMount}/*` — embedded API routes
- Everything else — passed through to the framework handler (SSR, assets)

## `createWebApp()`

Helper for Vite React SPAs with an optional embedded API. See the
`web-vite` template in `@gmode/cli`.

## Gateway registration

Declare the app in `gmode.jsonc` and run `gmode sync`. The gateway registers
`gateway.web()` with the correct mount, binding, and dev URL proxy.

Example: [web-app-tanstack](../../examples/web-app-tanstack/README.md)
