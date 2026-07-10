# @gmode/web
Run TanStack Start, Vite SPAs, and other Worker web apps behind a GMode gateway with typed embedded APIs.

## Install

```bash
npm i @gmode/web
```

Installs `@gmode/core`. Add `@gmode/service` when the web app exposes typed API routes.

## Quick example

```ts
import { createService, z } from "@gmode/service";
import { createWebApp, withGmode } from "@gmode/web";

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };
const api = createService<Env>({ name: "Web API", version: "1.0.0" });

api.get("/me", {
  responses: { 200: z.object({ id: z.string() }) },
  handler: ({ ok }) => ok({ id: "u_1" }),
});

export const tanstack = withGmode<Env>(
  (request) => new Response(`SSR ${new URL(request.url).pathname}`),
  { basePath: "/app", api: { service: api, mount: "/api" } },
);

export default createWebApp<Env>({
  basePath: "/app",
  api: { service: api, mount: "/api" },
});
```

`basePath` must match the gateway `web({ mount })` because web forwarding keeps the public prefix so SSR routes, SPA history, assets, and HMR still see the same path users requested.

## API

| Export | Purpose |
|---|---|
| `withGmode` | Wrap a fetch-shaped framework handler with GMode API and internal docs routes. |
| `createWebApp` | Static/SPA Worker entry that serves assets plus optional typed API routes. |
| `WithGmodeOptions`, `GmodeWebApiOptions` | Web app base path and embedded API options. |
| `WebFrameworkHandler`, `ServiceLike` | Structural handler and service types. |
| `CreateWebAppOptions`, `AssetsBinding` | Static assets Worker options and binding shape. |

## Works with

[`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/core`](../core) · [`@gmode/cli`](../cli) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
