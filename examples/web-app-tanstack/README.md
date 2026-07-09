# GMode Example: Gateway + TanStack Start Web App

Full manifest-driven workspace: public gateway, private `users` API, and a
TanStack Start web app (`dashboard`) — all declared in `gmode.jsonc` and run
with `gmode dev`.

```text
gmode.jsonc            ← app manifest (single source of truth)
gateway/               ← public gateway Worker
users-api/             ← private API service, mounted at /users
dashboard/             ← TanStack Start app, mounted at /app
```

The dashboard embeds a typed API (`src/api.ts`, a `createService()` instance)
via `withGmode()` from `@gmode/web`. The gateway aggregates those routes into
Swagger UI under `/app/api/*`.

For a smaller gateway-only example (billing, MCP, RPC), see
[gateway-basic](../gateway-basic/README.md).

For install prerequisites (monorepo root `pnpm install` + `pnpm build`), see
[examples/README.md](../README.md).

## Run locally

**Prerequisites** — from the **repository root** (not this directory alone):

```bash
corepack enable    # once per machine
pnpm install
pnpm build         # @gmode/* packages must be compiled to dist/
```

This example pins Wrangler, the Cloudflare Vite plugin, and Vite to compatible
runtime versions so the gateway Worker, API Worker, and Vite-backed dashboard
Worker can connect through local service bindings.

Then in this example:

```bash
cd examples/web-app-tanstack
cp gateway/.dev.vars.example gateway/.dev.vars
pnpm dev
```

`gmode dev` (from the workspace root) reads the manifest, runs `gmode sync`, and
starts:

- gateway + `users-api` in one `wrangler dev` multi-config session,
- the dashboard Vite dev server (HMR proxied through the gateway),
- the GMode dev dashboard.

| URL | What you get |
|---|---|
| http://localhost:8787/users/u_1 | users-api through the gateway |
| http://localhost:8787/app | redirects to the dashboard app |
| http://localhost:8787/app/ | TanStack Start app (SSR + HMR) |
| http://localhost:8787/app/api/todos | web app's embedded typed API |
| http://localhost:8787/openapi.json | aggregated users + web API routes |
| http://localhost:8787/docs | Swagger UI |
| http://localhost:9100 | GMode dev dashboard |

## Workspace commands

```bash
pnpm exec gmode sync              # refresh bindings + generated code
pnpm exec gmode doctor            # validate manifest and secrets
pnpm exec gmode generate client --url http://localhost:8787/openapi.json --out ./generated
pnpm exec gmode generate types    # wrangler types for every worker
pnpm exec gmode deploy --dry-run
```

## How the pieces connect

- `gmode.jsonc` declares the graph. `gmode sync` writes gateway wrangler
  `services[]` bindings and `gateway/src/gmode.generated.ts` with typed
  `GmodeEnv` and `registerServices(gateway)`.
- In dev, Wrangler connects the gateway's `DASHBOARD_APP` service binding to
  the Cloudflare Vite dev Worker, so SSR and HMR flow through the gateway. In
  production the same binding points at the deployed dashboard Worker.
- `dashboard/src/server.ts` wraps TanStack Start with `withGmode()`, serving
  `/__gmode/openapi.json`, `/__gmode/health`, and `/app/api/*`.
- Vite `base: "/app/"` and TanStack `basepath: "/app"` align with the gateway
  mount.

## Deploy

```bash
pnpm deploy            # services + web apps first, gateway last
pnpm deploy --dry-run  # print the plan without deploying
```

Set `GMODE_CONTEXT_SECRET` (and any JWT secrets) on every Worker in production:

```bash
wrangler secret put GMODE_CONTEXT_SECRET
```

## E2E coverage

Exercised by multiple `@gmode/e2e` suites: web-app smoke, CLI, dashboard,
client-live, and deploy dry-run.

## Troubleshooting

If you see `gateway.web is not a function` in `registerServices`, the
`@gmode/gateway` package was not built. From the repo root run `pnpm install &&
pnpm build`, then restart `pnpm dev`. See [examples/README.md](../README.md).
