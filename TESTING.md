# Testing GMode locally

Two workflows: **unit/integration tests** (Vitest, no Cloudflare needed) and
**end-to-end** (`wrangler dev`, multi-Worker, real Service Bindings).

The example app at `examples/gateway-basic/` is the reference setup —
one Gateway Worker plus two Service Workers (`users-api`, `billing-api`).

---

## 1. Unit + integration tests (Vitest)

These run on plain Node 20+, no Wrangler, no Cloudflare account. They cover
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
pnpm build           # tsup for libraries, tsc --noEmit for example apps
```

All three (`build`, `typecheck`, `test`) must be green before shipping.

---

## 2. Local end-to-end with `wrangler dev`

Each Worker has its own `wrangler.jsonc` and runs in its own process. They
talk to each other over real Service Bindings — Wrangler auto-discovers
other locally-running Workers by name on the same machine.

### One-time setup

```bash
cd examples/gateway-basic
cp gateway/.dev.vars.example      gateway/.dev.vars
cp users-api/.dev.vars.example    users-api/.dev.vars
cp billing-api/.dev.vars.example  billing-api/.dev.vars
```

**Critical:** `INTERNAL_SIGNING_SECRET` must be identical across the gateway
and every service it forwards to. The example `.dev.vars` files already use
the same value; keep them in sync.

### Start the services first (each in its own terminal)

```bash
# Terminal A
cd examples/gateway-basic/users-api
pnpm exec wrangler dev --port 8788

# Terminal B
cd examples/gateway-basic/billing-api
pnpm exec wrangler dev --port 8789
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
pnpm exec wrangler dev --port 8787
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

### Inspect the signed context that reaches a service

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

## 3. What works locally vs. what doesn't

| Feature | Local `wrangler dev` | Notes |
|---|---|---|
| Service Bindings | ✅ | Auto-wired by name; both services must be running. |
| JWT auth | ✅ | HS256 via Web Crypto; works identically to prod. |
| Signed gateway context | ✅ | Pure HMAC-SHA256, no platform dependency. |
| Cloudflare native rate limiting | ⚠️ | Bindings simulated locally; counters reset per dev session and aren't shared across runs. Use `memoryRateLimit()` for deterministic tests. |
| Cloudflare Flagship | ⚠️ | No documented offline mode. Either point at a real "dev" Flagship app, or stub the binding (see below). |
| `WorkerEntrypoint` RPC | ✅ | Service Bindings are RPC + `fetch()` simultaneously when the target extends `WorkerEntrypoint`. `wrangler dev` auto-discovers — start both Workers, the caller's `env.USERS_API.getUserById(...)` just works. |
| Workers Logs | n/a | Local logs go to stdout; the `observability.head_sampling_rate` only matters in prod. |
| OpenAPI aggregation + `/docs` | ✅ | Gateway fetches each service's `/__gmode/openapi.json` over the Service Binding. |

### Stubbing Flagship locally

The cleanest way is a tiny adapter Worker that implements the `FlagshipBinding`
shape and reads flags from `vars`. Easier: keep the binding in `wrangler.jsonc`
but point `app_id` at a separate `gmode-example-dev` Flagship app where you
flip flags by hand in the dashboard.

For tests, use `createMockFlagship` from `@gmode/testing` — see
`packages/service/src/service.test.ts` for full examples.

---

## 4. Common failures

- **`404 NOT_FOUND` on every path** — the path didn't match any
  `gateway.service({ mount })`. Check the mount strings; `/users` matches
  `/users` and `/users/123` but never `/users2`.
- **`401 INVALID_GATEWAY_CONTEXT` from a service** — `INTERNAL_SIGNING_SECRET`
  mismatches between gateway and that service. They must be byte-identical.
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

## 5. Quick reference

```bash
# Everything green from a clean checkout
pnpm install && pnpm build && pnpm typecheck && pnpm test

# Local E2E
(cd examples/gateway-basic/users-api   && pnpm exec wrangler dev --port 8788) &
(cd examples/gateway-basic/billing-api && pnpm exec wrangler dev --port 8789) &
(cd examples/gateway-basic/gateway     && pnpm exec wrangler dev --port 8787)
```
