# GMode Example: Gateway + Users + Billing

This example shows a public Gateway Worker and two private Service Workers
(`users-api` and `billing-api`) wired together via Cloudflare Service Bindings.

## Run locally

Each Worker has its own `wrangler.jsonc`. In production they are three separate
Cloudflare Workers wired through Service Bindings. For local development, the
recommended path is one Wrangler session with the gateway as the primary Worker
and the services as auxiliary Workers. That keeps the gateway fixed at
`http://127.0.0.1:8787`.

```bash
cp users-api/.dev.vars.example users-api/.dev.vars
cp billing-api/.dev.vars.example billing-api/.dev.vars
cp gateway/.dev.vars.example gateway/.dev.vars

The gateway `wrangler.jsonc` lists `GMODE_CONTEXT_SECRET` under `secrets.required`
so Wrangler injects it from `.dev.vars` alongside `JWT_SECRET`. Services need
the same value in their `.dev.vars` (must match the gateway).

cd gateway && pnpm dev
```

The first config in `pnpm dev` is the gateway, so it is the only Worker exposed
over HTTP. The users and billing Workers are available through service bindings.

If you prefer three terminals, run each package's `pnpm dev` script separately.
Those scripts pin ports as follows:

| Worker | URL |
|---|---|
| Gateway | `http://127.0.0.1:8787` |
| Users API | `http://127.0.0.1:8788` |
| Billing API | `http://127.0.0.1:8789` |

For a gateway-only session, use `pnpm dev:gateway` from `gateway/`. The OpenAPI
aggregate and Swagger UI require live service bindings, so gateway-only mode is
not enough for `/openapi.json` unless the downstream Workers are connected.

The example `wrangler.jsonc` files run `pnpm build:deps` before Wrangler
bundles each Worker. That builds the local `@gmode/*` workspace packages so
Wrangler can resolve their published `dist` exports.

Then hit the gateway:

```bash
curl http://127.0.0.1:8787/users/123
curl http://127.0.0.1:8787/openapi.json
curl http://127.0.0.1:8787/openapi.json?profile=shield
```

Open Swagger UI at `http://127.0.0.1:8787/docs`. The page loads the same
gateway-owned spec from `/openapi.json`.

If `/openapi.json` returns an error, one of the downstream service bindings is
not connected. The gateway does not silently omit a service from the aggregate
spec; start both downstream Workers first and restart the gateway.

## MCP Inspector

The gateway exposes MCP at `http://127.0.0.1:8787/mcp` using Streamable HTTP.
When running `npx @modelcontextprotocol/inspector`, select:

| Field | Value |
|---|---|
| Transport Type | `Streamable HTTP` |
| URL | `http://127.0.0.1:8787/mcp` |

Do not select `SSE`; the inspector still offers it for older servers, but this
example does not expose a legacy SSE session endpoint.

To force the inspector UI to open with the correct transport selected:

```text
http://localhost:6274/?transport=streamable-http&serverUrl=http://127.0.0.1:8787/mcp
```

CLI smoke test:

```bash
npx @modelcontextprotocol/inspector@latest --cli http://127.0.0.1:8787/mcp \
  --transport http \
  --method tools/list
```

## Deploy

Deploy each Worker with services first and the gateway last. The downstream
services are private Workers reached through Service Bindings, so they do not
need an internal signing secret:

```bash
cd users-api && pnpm run deploy
cd ../billing-api && pnpm run deploy
cd ../gateway
wrangler secret put JWT_SECRET
pnpm run deploy
```

Keep `workers_dev: false` and do not add public routes to downstream services
unless you also add your own public authentication layer.
