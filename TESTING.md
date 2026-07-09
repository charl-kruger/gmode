# Testing GMode locally

Four workflows: **unit/integration tests** (Vitest, no Cloudflare needed),
**E2E smoke** (`@gmode/e2e`, live `wrangler dev` / `gmode dev`), **manual
wrangler dev**, and **GitHub CI**.

| Example | Best for |
|---|---|
| [gateway-basic](./examples/gateway-basic/) | JWT, MCP, RPC, Shield OpenAPI |
| [web-app-tanstack](./examples/web-app-tanstack/) | Manifest, `gmode dev`, web apps, codegen |

---

## 1. Unit + integration tests (Vitest)

These run on plain Node 24 in CI, no Wrangler, no Cloudflare account. They cover
the framework itself and the example handler logic.

```bash
pnpm install                    # once
pnpm build                      # workspace deps need to be built first
pnpm test                       # runs vitest across all packages
```

Run a single package:

```bash
pnpm --filter @gmode/gateway test
pnpm --filter @gmode/service test -- --watch     # watch mode
```

Run a single file:

```bash
pnpm --filter @gmode/gateway test -- src/feature-flags.test.ts
```

The mocks in `@gmode/testing` (`createMockFetcher`, `createMockRateLimit`,
`createMockFlagship`) let you exercise the full request flow in process —
that's how `packages/gateway/src/integration.test.ts` wires a real
`createService(...)` instance behind a mock Fetcher binding.

### Typecheck + build

```bash
pnpm typecheck       # tsc --noEmit across all packages
pnpm lint            # biome across packages
pnpm build           # tsup for libraries, tsc --noEmit for example apps
```

All four (`build`, `typecheck`, `lint`, `test`) must be green before shipping.
E2E smoke is a separate step (see below).

### Automated E2E smoke (`@gmode/e2e`)

Live-process tests spawn `wrangler dev` / `gmode dev` and hit real HTTP endpoints.
They cover CLI scaffolding, both examples, MCP, RPC, OpenAPI aggregation, and the
dev dashboard.

```bash
pnpm build                        # required once
pnpm test:e2e:smoke               # ~80s, all smoke suites (not part of `pnpm test`)
pnpm --filter @gmode/e2e test:smoke
```

Suites live in `packages/e2e/src/suites/` (shared dev servers start once via
`globalSetup` — ~80s total):

| Suite | Fixture | Covers |
|---|---|---|
| `cli.smoke` | web-app-tanstack | `sync`, `doctor`, `generate client`, `generate types` |
| `greenfield.smoke` | temp workspace | `init`, `new service`, `new web`, `doctor` |
| `gateway-basic.smoke` | gateway-basic | health, users, OpenAPI, JWT, MCP, RPC, CORS |
| `web-app-tanstack.smoke` | web-app-tanstack | `gmode dev`, SSR, embedded API, OpenAPI aggregation, codegen |
| `dashboard.smoke` | web-app-tanstack + dashboard | `/api/state`, logs, requests, SSE |
| `client-live.smoke` | web-app-tanstack | generated `createClient()` against live gateway |
| `create-gmode.smoke` | temp workspace | `pnpm create gmode` wrapper → `init` |
| `deploy.smoke` | web-app-tanstack | `deploy --dry-run` |
| `shield.smoke` | fixtures + live OpenAPI | `shield:sync-sequences` (offline); live zone tests skip unless `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` are set |

E2E tests use dynamic ports and run sequentially. Kill stray dev processes if a
run is interrupted: `pkill -f "wrangler dev"; pkill -f "gmode dev"`.

---

## 2. Local end-to-end with `gmode dev` (web-app-tanstack)

The fastest way to exercise the full platform (gateway + service + TanStack
web app + dev dashboard).

**Install once from the repo root** (examples use `workspace:*` and need
compiled `packages/*/dist`):

```bash
corepack enable
pnpm install
pnpm build
```

Then:

```bash
cd examples/web-app-tanstack
cp gateway/.dev.vars.example gateway/.dev.vars
pnpm dev
```

Then open http://localhost:8787/docs and http://localhost:9100.

If you see `gateway.web is not a function`, you skipped `pnpm build` at the
root — see [examples/README.md](./examples/README.md#troubleshooting).

---

## 3. Local end-to-end with `wrangler dev` (gateway-basic)

Each Worker has its own `wrangler.jsonc` and runs in its own process. They
talk to each other over real Service Bindings — Wrangler auto-discovers
other locally-running Workers by name on the same machine.

### One-time setup

From the **repository root**, install and build workspace packages first:

```bash
pnpm install
pnpm build
```

Then copy dev secrets for the example:

```bash
cd examples/gateway-basic
cp gateway/.dev.vars.example      gateway/.dev.vars
cp users-api/.dev.vars.example    users-api/.dev.vars
cp billing-api/.dev.vars.example  billing-api/.dev.vars
```

The service Workers should stay private. The example configs use
`workers_dev: false` and no public routes for `users-api` and `billing-api`;
the gateway reaches them through Service Bindings.

### Start the services first (each in its own terminal)

```bash
# Terminal A
cd examples/gateway-basic/users-api
pnpm dev -- --port 8788

# Terminal B
cd examples/gateway-basic/billing-api
pnpm dev -- --port 8789
```

You should see something like:

```
⛅️ wrangler X.Y.Z
⎔ Starting local server...
[wrangler:info] Ready on http://127.0.0.1:8788
```

### Start the gateway last

```bash
# Terminal C
cd examples/gateway-basic/gateway
pnpm dev -- --port 8787
```

The gateway's `services: [{ binding: "USERS_API", service: "gmode-example-users-api" }, ...]`
in `wrangler.jsonc` makes Wrangler bind those local processes to
`env.USERS_API.fetch(...)` and `env.BILLING_API.fetch(...)` automatically.

### Hit the gateway

```bash
# Unauthenticated route on users (auth: false in gateway.service config)
curl -s http://127.0.0.1:8787/users/123 | jq

# Aggregated OpenAPI
curl -s http://127.0.0.1:8787/openapi.json | jq '.paths | keys'

# Swagger UI in a browser
open http://127.0.0.1:8787/docs

# Inspect the standard request id
curl -i http://127.0.0.1:8787/users/123 | grep -i x-request-id
```

### Auth-required route (billing)

Mint a quick HS256 JWT using the same `JWT_SECRET` that's in
`gateway/.dev.vars`:

```bash
cat <<'EOF' > /tmp/mint.mjs
import { createTestJwt } from "@gmode/testing";
const tok = await createTestJwt(
  { sub: "user_1", scopes: ["billing:read", "billing:write"] },
  process.argv[2]
);
console.log(tok);
EOF
node --experimental-vm-modules /tmp/mint.mjs dev-jwt-secret
```

Then call billing:

```bash
TOKEN=$(node /tmp/mint.mjs dev-jwt-secret)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8787/billing/invoices/123 | jq

# Demonstrates service-to-service RPC: billing-api calls users-api.getUserById
# and joins the email into the response.
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"total": 4999, "currency": "USD", "userId": "u1"}' \
  http://127.0.0.1:8787/billing/invoices | jq
# expect: { id, total, currency, userId: "u1", userEmail: "u1@example.com" }
```

### Inspect the private context that reaches a service

In a handler in `users-api/src/index.ts`, log it:

```ts
handler: async ({ gateway, requestId }) => {
  console.log(JSON.stringify({ type: "gmode.debug", gateway, requestId }));
  return { id: gateway.user?.id ?? "anonymous" };
}
```

The structured log appears in `users-api`'s terminal. You should see the
audience, scopes, and (if `featureFlags` is mounted with `forward`) the
pre-evaluated flags.

---

## 4. What works locally vs. what doesn't

| Feature | Local `wrangler dev` | Notes |
|---|---|---|
| Service Bindings | ✅ | Auto-wired by name; both services must be running. |
| JWT auth | ✅ | HS256 via Web Crypto; works identically to prod. |
| Private gateway context | ✅ | Encoded by the gateway and delivered over Service Bindings. |
| Cloudflare native rate limiting | ⚠️ | Bindings simulated locally; counters reset per dev session and aren't shared across runs. Use `memoryRateLimit()` for deterministic tests. |
| Cloudflare Flagship | ⚠️ | No documented offline mode. Either point at a real "dev" Flagship app, or stub the binding (see below). |
| Workers Cache | ⚠️ | Gateway policy forwarding can be tested locally, but network cache behavior needs deployed Workers and `Cf-Cache-Status`. Keep the public gateway cache disabled and enable cache on downstream service Workers. |
| `WorkerEntrypoint` RPC | ✅ | Service Bindings are RPC + `fetch()` simultaneously when the target extends `WorkerEntrypoint`. `wrangler dev` auto-discovers — start both Workers, the caller's `env.USERS_API.getUserById(...)` just works. |
| Workers Logs | n/a | Local logs go to stdout; the `observability.head_sampling_rate` only matters in prod. |
| `gmode dev` orchestration | ✅ | Starts gateway, services, Vite, and dev dashboard from `gmode.jsonc`. |
| OpenAPI aggregation + `/docs` | ✅ | Gateway fetches service and web-app OpenAPI over Service Bindings. |

### Stubbing Flagship locally

The cleanest way is a tiny adapter Worker that implements the `FlagshipBinding`
shape and reads flags from `vars`. Easier: keep the binding in `wrangler.jsonc`
but point `app_id` at a separate `gmode-example-dev` Flagship app where you
flip flags by hand in the dashboard.

For tests, use `createMockFlagship` from `@gmode/testing` — see
`packages/service/src/service.test.ts` for full examples.

---

## 5. GitHub CI and releases

Pull requests and pushes to `main` run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

A separate **E2E smoke** job (`pnpm test:e2e:smoke`, 15 min timeout) runs after
`pnpm build`.

The release workflow runs the same gate before it opens a Changesets version PR
or publishes packages to npm. Release-specific details live in
[docs/release.md](./docs/release.md).

---

## 6. Common failures

- **`404 NOT_FOUND` on every path** — the path didn't match any
  `gateway.service({ mount })`. Check the mount strings; `/users` matches
  `/users` and `/users/123` but never `/users2`.
- **`401 INVALID_GATEWAY_CONTEXT` from a service** — the gateway context
  header is missing, malformed, expired, or not produced by the gateway path.
- **`401 INVALID_GATEWAY_CONTEXT_AUDIENCE`** — the gateway's
  `service("foo", { audience: "users" })` doesn't match the service's
  `trustGateway: { audience: "users" }`.
- **`429 TOO_MANY_REQUESTS` in tests** — module-level state in
  `memoryRateLimit()` survives between tests in the same process. Import
  and call `__resetMemoryRateLimit()` in a `beforeEach`.
- **Body lost on POST through the gateway in a custom test** — Node's
  `fetch` requires `duplex: "half"` when constructing a Request with a
  stream body. The gateway's `forward.ts` already does this; if you bypass
  it, copy the pattern.
- **Service Binding "not configured" error locally** — the downstream Worker
  isn't running. Start the service before the gateway and use `--port`
  flags so they don't fight over `:8787`.

---

## 7. Quick reference

```bash
# Everything green from a clean checkout
pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test

# E2E smoke (live processes)
pnpm test:e2e:smoke

# Manual gateway-basic
(cd examples/gateway-basic/users-api   && pnpm dev -- --port 8788) &
(cd examples/gateway-basic/billing-api && pnpm dev -- --port 8789) &
(cd examples/gateway-basic/gateway     && pnpm dev -- --port 8787)

# Full platform (manifest workspace)
cd examples/web-app-tanstack && pnpm dev
```
