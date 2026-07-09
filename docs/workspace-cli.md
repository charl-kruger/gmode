# Workspace CLI

The `gmode` CLI (`@gmode/cli`) manages multi-Worker app platforms from a
single `gmode.jsonc` manifest. It scaffolds projects, syncs wrangler service
bindings, runs orchestrated local dev, validates workspaces, generates typed
clients, and deploys in dependency order.

Install globally via your workspace, or use `create-gmode`:

```bash
pnpm create gmode my-app
cd my-app
pnpm install
```

## Manifest (`gmode.jsonc`)

The manifest is the single source of truth for the service graph:

```jsonc
{
  "$schema": "../../packages/cli/gmode.schema.json",
  "name": "my-app",
  "gateway": { "path": "./gateway", "port": 8787 },
  "services": [
    { "name": "users", "path": "./users-api", "mount": "/users" }
  ],
  "webApps": [
    {
      "name": "dashboard",
      "path": "./dashboard",
      "mount": "/app",
      "framework": "tanstack-start",
      "devPort": 5173,
      "api": { "mount": "/api", "openapi": true }
    }
  ]
}
```

`gmode sync` writes:

- `gateway/wrangler.jsonc` — `services[]` bindings for every entry
- `gateway/src/gmode.generated.ts` — typed `GmodeEnv` + `registerServices(gateway)`

Run `sync` after editing the manifest. `dev` and `deploy` run it automatically.

## Commands

### Workspace

```bash
gmode init [dir] [--name app]   # scaffold gateway + manifest + pnpm workspace
gmode new service <name>      # private API Worker + manifest entry
gmode new web <name>          # web app (--framework tanstack-start|vite-react)
gmode sync                    # manifest → wrangler + generated gateway code
gmode doctor                  # validate manifest, drift, secrets, ports
```

`gmode init` generates `gateway/.dev.vars` with `GMODE_CONTEXT_SECRET` for
local HMAC signing. `gmode sync` propagates that secret to service Workers.

### Develop and ship

```bash
gmode dev                       # gateway + services + web apps + dev dashboard
gmode dev --port 8787           # gateway port
gmode dev --dashboard-port 9100 # dev dashboard port
gmode dev --no-dashboard        # skip the inspector UI

gmode deploy                    # services + web apps first, gateway last
gmode deploy --dry-run          # print plan without deploying
gmode deploy --env staging      # pass --env to wrangler deploy
```

The dev dashboard (from `@gmode/dashboard`) shows resources, live request
inspector, process logs, and a service graph at http://localhost:9100 by
default.

### Codegen

```bash
gmode generate client --url http://localhost:8787/openapi.json --out ./generated
gmode generate client --spec ./openapi.json --out ./generated
gmode generate types            # wrangler types for every worker + re-sync
```

`generate client` emits a self-contained `gmode-client.ts` with typed methods
per `operationId`. Use `@gmode/client` patterns or import the generated file
directly.

## Web Apps

Web apps are first-class manifest entries mounted behind the gateway.

**TanStack Start** (`--framework tanstack-start`):

- `dashboard/src/server.ts` wraps the TanStack handler with `withGmode()` from
  `@gmode/web`
- Embedded typed APIs live in `src/api.ts` (`createService()`)
- Vite `base: "/app/"` and TanStack `basepath: "/app"` align with the gateway
  mount

**Vite React SPA** (`--framework vite-react`):

- `createWebApp()` from `@gmode/web` for SPA + optional embedded API

In dev, `gmode dev` proxies the web mount to the Vite dev server (HMR works
through the gateway). In production, the Service Binding serves the built Worker.

The gateway aggregates web-app OpenAPI routes into `/openapi.json` alongside
service routes.

## Doctor

`gmode doctor` checks:

- `gmode.jsonc` parses and validates
- Gateway `services[]` bindings match the manifest (suggests `gmode sync`)
- `gateway/src/gmode.generated.ts` exists and is fresh
- Each entry has `wrangler.jsonc`; service Workers use `workers_dev: false`
- Dev ports are unique
- `GMODE_CONTEXT_SECRET` in gateway `.dev.vars` and propagated to services
- `JWT_SECRET` when listed in `secrets.required`
- `wrangler` is installed

## API Shield Commands

Shield commands use `gmode.config.json` (or env vars) for Cloudflare
credentials. **Live** commands require `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ZONE_ID`. **Offline** `shield:sync-sequences --dry-run` and
`--out` work without credentials.

```bash
gmode shield:push-schema --from openapi.json
gmode shield:bootstrap --from https://api.example.com/openapi.json?profile=shield --out pruned.json
gmode shield:diff-discovered --from openapi.json --json
gmode shield:sync-schema-actions --from openapi.json --dry-run
gmode shield:sync-sequences --file sequences.json --dry-run
gmode shield:sync-sequences --file sequences.json --out dashboard-import.json
```

See [API Shield](./api-shield.md) for the full Shield workflow.

## Configuration (`gmode.config.json`)

Optional. Used by Shield commands:

```jsonc
{
  "cloudflare": {
    "apiToken": "${CLOUDFLARE_API_TOKEN}",
    "zoneId": "${CLOUDFLARE_ZONE_ID}"
  },
  "gateway": {
    "baseUrl": "https://api.example.com",
    "specPath": "/openapi.json"
  },
  "shield": {
    "sequences": "./sequences.json",
    "schemaActions": [
      { "target": "GET /users/{id}", "action": "log" }
    ]
  }
}
```

## Related

- [Getting started](./getting-started.md) — hand-written gateway/service code
- [web-app-tanstack example](../examples/web-app-tanstack/README.md)
- [Testing guide](../TESTING.md) — E2E smoke coverage for CLI workflows
