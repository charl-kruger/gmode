# GMode Example: Gateway + Users + Billing

This example shows a public Gateway Worker and two private Service Workers
(`users-api` and `billing-api`) wired together via Cloudflare Service Bindings.

## Run locally

Each Worker has its own `wrangler.jsonc`. In production they are three separate
Cloudflare Workers wired through Service Bindings. For local development, you
typically run each one in its own terminal:

```bash
# Terminal 1
cd users-api && cp .dev.vars.example .dev.vars && pnpm dev

# Terminal 2
cd billing-api && cp .dev.vars.example .dev.vars && pnpm dev

# Terminal 3
cd gateway && cp .dev.vars.example .dev.vars && pnpm dev
```

The example `wrangler.jsonc` files run `pnpm build:deps` before Wrangler
bundles each Worker. That builds the local `@gmode/*` workspace packages so
Wrangler can resolve their published `dist` exports.

Then hit the gateway:

```bash
curl http://127.0.0.1:8787/users/123
curl http://127.0.0.1:8787/openapi.json
```

## MCP Inspector

The gateway exposes MCP at `http://127.0.0.1:8787/mcp` using Streamable HTTP.
When running `npx @modelcontextprotocol/inspector`, select:

| Field | Value |
|---|---|
| Transport Type | `Streamable HTTP` |
| URL | `http://127.0.0.1:8787/mcp` |

Do not select `SSE`; the inspector still offers it for older servers, but this
example does not expose a legacy SSE session endpoint.

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
