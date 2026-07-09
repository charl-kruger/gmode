# GMode Example: Gateway + TanStack Start Web App

The Phase 2 flagship: a public gateway, a private `users` API service, and a
full TanStack Start web app (`dashboard`) — all declared in one `gmode.jsonc`
manifest and run with one command.

```text
gmode.jsonc            <- the app manifest (single source of truth)
gateway/               <- public gateway Worker
users-api/             <- private API service, mounted at /users
dashboard/             <- TanStack Start app, mounted at /app
```

The dashboard app embeds its own typed API (`src/api.ts`, a normal
`createService()` instance) via `withGmode()`. The gateway aggregates those
routes into its Swagger UI under `/app/api/*` — web apps and API services get
the same treatment.

## Run locally

```bash
pnpm install
cp gateway/.dev.vars.example gateway/.dev.vars
pnpm dev
```

`gmode dev` reads the manifest, runs `gmode sync`, and starts:

- the gateway + services in one `wrangler dev` multi-config session,
- the dashboard's Vite dev server (with HMR, proxied through the gateway),
- the GMode dev dashboard at http://localhost:9100.

Then:

| URL | What you get |
|---|---|
| http://localhost:8787/users/123 | users-api through the gateway |
| http://localhost:8787/app | TanStack Start app (SSR + HMR via Vite proxy) |
| http://localhost:8787/app/api/todos | the web app's embedded typed API |
| http://localhost:8787/docs | Swagger UI including the web app's API routes |
| http://localhost:9100 | GMode dev dashboard (resources, requests, logs) |

## How the pieces connect

- `gmode.jsonc` declares the graph. `gmode sync` (auto-run by `dev`/`deploy`)
  writes the gateway's wrangler `services` bindings and generates
  `gateway/src/gmode.generated.ts` with a typed `GmodeEnv` and
  `registerServices(gateway)` — no hand-written binding strings.
- In dev, `gmode dev` sets `DASHBOARD_APP_DEV_URL` so the gateway proxies
  `/app` to the Vite dev server (HMR works through the gateway). In
  production the var is absent and the Service Binding is used.
- `dashboard/src/server.ts` wraps the TanStack Start handler with
  `withGmode()`, which serves `/__gmode/openapi.json` + `/__gmode/health`
  for the gateway and mounts the typed API at `/app/api`.
- The app is built with `base: "/app/"` (Vite) and `basepath: "/app"`
  (TanStack Router) so assets and links work behind the gateway mount.

## Deploy

```bash
pnpm deploy            # services + web apps first, gateway last
pnpm deploy --dry-run  # print the plan without deploying
```
