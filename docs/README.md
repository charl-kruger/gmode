# GMode Documentation

Read these docs in order when you are new to the repo. After that, jump to the
page that matches what you are building.

## 1. Orientation

- [Getting started](./getting-started.md) — build a gateway and service Worker, understand the public API.
- [Workspace CLI](./workspace-cli.md) — `gmode init`, manifest, `dev`, `deploy`, codegen, and the dev dashboard.
- [Reference](./reference.md) — runtime contracts, OpenAPI aggregation, packages, testing surface, and release status.
- [Porting plan](./porting-plan.md) — what moved from EdgeKit, what was renamed, and what was removed.

## 2. Cloudflare Runtime Setup

- [Cloudflare configuration](./cloudflare-configuration.md) — Service Bindings, Workers Cache, rate limits, KV, secrets, observability.
- [Cloudflare binding helpers](./cloudflare-binding-helpers.md) — typed D1, R2, Queue, and KV resolvers plus test mocks.
- [Workers Cache](./workers-cache.md) — gateway-owned downstream cache policy.
- [Durable Object rate limiting](./durable-object-rate-limiting.md) — globally coordinated quotas.

## 3. Gateway Policy

- [Auth and security](./auth-and-security.md) — JWT, API keys, mTLS, HMAC-signed gateway context.
- [Idempotency](./idempotency.md) — KV-backed retry replay for unsafe requests.
- [Feature flags](./feature-flags.md) — Cloudflare Flagship at the gateway and service layers.
- [OpenFeature](./openfeature.md) — OpenFeature-style evaluation backed by Flagship.
- [Telemetry](./telemetry.md) — Analytics Engine request events and OTEL hooks.

## 4. API Surface

- [API versioning](./api-versioning.md) — mount `/v1` and `/v2` side by side.
- [API docs UI](./api-docs-ui.md) — Swagger UI or Scalar.
- [Webhooks](./webhooks.md) — sign, verify, enqueue, and deliver webhook events.
- [API Shield](./api-shield.md) — Schema Validation, JWT, mTLS, Sequence Analytics, CLI commands.
- [Service-to-service RPC](./rpc.md) — typed `WorkerEntrypoint` calls.
- [MCP server](./mcp.md) — expose gateway operations to MCP-compatible AI clients.

## 5. Shipping

- [Testing guide](../TESTING.md) — unit tests, E2E smoke, manual `wrangler dev`, CI.
- [Release process](./release.md) — Changesets versioning and GitHub Actions npm publishing.

## Examples

| Example | Description |
|---|---|
| [gateway-basic](../examples/gateway-basic/README.md) | Gateway + users + billing — JWT, MCP, RPC, Shield OpenAPI |
| [web-app-tanstack](../examples/web-app-tanstack/README.md) | Manifest workspace — TanStack Start web app, `gmode dev`, codegen |

Scaffold your own copy:

```bash
pnpm create gmode my-app
```

## Local Gate

Run before opening a PR:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:smoke   # live wrangler / gmode dev (~80s)
pnpm build
```
