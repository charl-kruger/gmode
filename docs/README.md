# GMode Documentation

Read these docs in order when you are new to the repo. After that, jump to the
workflow page that matches the feature you are changing.

## 1. Orientation

- [Getting started](./getting-started.md) - build the first gateway/service pair and understand the public API.
- [Reference](./reference.md) - runtime contracts, OpenAPI aggregation, standard errors, testing surface, and current gaps.
- [Porting plan](./porting-plan.md) - what moved from EdgeKit, what was renamed, and what was deliberately removed.

## 2. Cloudflare Runtime Setup

- [Cloudflare configuration](./cloudflare-configuration.md) - Service Bindings, Workers Cache, native rate limits, KV, secrets, and observability.
- [Cloudflare binding helpers](./cloudflare-binding-helpers.md) - typed D1, R2, Queue, and KV binding resolvers plus deterministic test mocks.
- [Workers Cache](./workers-cache.md) - gateway-owned downstream cache policy for Cloudflare Workers Cache.
- [Durable Object rate limiting](./durable-object-rate-limiting.md) - globally coordinated tenant, user, and API-key quotas.

## 3. Gateway Policy

- [Auth and security](./auth-and-security.md) - JWT, API keys, mTLS, and private gateway context.
- [Idempotency](./idempotency.md) - KV-backed retry replay for unsafe requests.
- [Feature flags](./feature-flags.md) - Cloudflare Flagship at the gateway and service layers.
- [OpenFeature](./openfeature.md) - OpenFeature-style evaluation backed by Cloudflare Flagship.
- [Telemetry](./telemetry.md) - Analytics Engine request events and OTEL exporter hooks.

## 4. API Surface

- [API versioning](./api-versioning.md) - mount `/v1` and `/v2` services side by side with deprecation headers and OpenAPI metadata.
- [API docs UI](./api-docs-ui.md) - choose Swagger UI or Scalar for interactive API docs.
- [Webhooks](./webhooks.md) - sign, verify, enqueue, and deliver webhook events with Queue retries.
- [API Shield](./api-shield.md) - Schema Validation, JWT validation, mTLS, Sequence Analytics, and CLI commands.
- [Service-to-service RPC](./rpc.md) - typed WorkerEntrypoint calls between services.
- [MCP server](./mcp.md) - expose gateway operations to MCP-compatible AI clients.

## 5. Shipping

- [Testing guide](../TESTING.md) - local unit, integration, and multi-Worker `wrangler dev` verification.
- [Release process](./release.md) - Changesets versioning and GitHub Actions npm publishing.

## Example App

- [Gateway + users + billing](../examples/gateway-basic/README.md)

## Local Gate

```bash
pnpm typecheck
pnpm test
pnpm build
```
