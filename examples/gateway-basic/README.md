# GMode Example: Gateway + Users + Billing

Public gateway Worker plus two private Service Workers (`users-api` and
`billing-api`) wired through Cloudflare Service Bindings. Demonstrates JWT
auth, HMAC-signed gateway context, MCP, service-to-service RPC, and Shield
OpenAPI export.

For the full manifest-driven workspace (web apps, `gmode dev`, codegen), see
[web-app-tanstack](../web-app-tanstack/README.md).

## Run locally

Each Worker has its own `wrangler.jsonc`. For local development, run one
Wrangler session with the gateway as the primary Worker and the services as
auxiliary configs:

```bash
cp users-api/.dev.vars.example users-api/.dev.vars
cp billing-api/.dev.vars.example billing-api/.dev.vars
cp gateway/.dev.vars.example gateway/.dev.vars

cd gateway && pnpm dev
```

The gateway `wrangler.jsonc` lists `GMODE_CONTEXT_SECRET` under
`secrets.required` so Wrangler injects it from `.dev.vars` alongside
`JWT_SECRET`. Services need the same `GMODE_CONTEXT_SECRET` value (must match
the gateway).

The first config in `pnpm dev` is the gateway at `http://127.0.0.1:8787`.
Users and billing Workers are reached through service bindings only.

### Three-terminal alternative

| Worker | URL |
|---|---|
| Gateway | `http://127.0.0.1:8787` |
| Users API | `http://127.0.0.1:8788` |
| Billing API | `http://127.0.0.1:8789` |

Run each package's `pnpm dev` separately. OpenAPI aggregation requires live
bindings — start services before the gateway.

Wrangler runs `pnpm build:deps` before bundling so local `@gmode/*` workspace
packages resolve from `dist/`.

## Try it

```bash
curl http://127.0.0.1:8787/users/u_1
curl http://127.0.0.1:8787/openapi.json
curl http://127.0.0.1:8787/openapi.json?profile=shield
open http://127.0.0.1:8787/docs
```

Billing routes require a JWT (see [TESTING.md](../../TESTING.md#auth-required-route-billing)).

## MCP Inspector

MCP endpoint: `http://127.0.0.1:8787/mcp` (Streamable HTTP).

| Field | Value |
|---|---|
| Transport | `Streamable HTTP` |
| URL | `http://127.0.0.1:8787/mcp` |

```bash
npx @modelcontextprotocol/inspector@latest --cli http://127.0.0.1:8787/mcp \
  --transport http \
  --method tools/list
```

## Deploy

Deploy services first, gateway last:

```bash
cd users-api && pnpm run deploy
cd ../billing-api && pnpm run deploy
cd ../gateway
wrangler secret put JWT_SECRET
wrangler secret put GMODE_CONTEXT_SECRET
pnpm run deploy
```

Keep `workers_dev: false` on service Workers. Do not add public routes to
downstream services unless you add your own authentication layer.

Or use the workspace CLI from a scaffolded copy:

```bash
gmode deploy --dry-run
gmode deploy
```

## E2E coverage

This example is exercised by `packages/e2e/src/suites/gateway-basic.smoke.test.ts`
(health, users, OpenAPI, JWT, MCP invoke, RPC, CORS).
