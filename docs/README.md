# GMode Documentation

This documentation is split by workflow. Start with the short guides first,
then move to the integration-specific pages when you need them.

## Guides

- [Porting plan](./porting-plan.md) - what was carried from EdgeKit, what was removed, and the Cloudflare platform contracts this repo targets.
- [Getting started](./getting-started.md) - create a gateway, create a service, and wire them together.
- [Cloudflare configuration](./cloudflare-configuration.md) - Service Bindings, native rate limits, KV, secrets, and observability.
- [Cloudflare binding helpers](./cloudflare-binding-helpers.md) - thin D1, R2, Queue, and KV binding resolvers plus test mocks.
- [Auth and security](./auth-and-security.md) - JWT, API keys, mTLS, and signed gateway context.
- [Idempotency](./idempotency.md) - KV-backed retry replay for unsafe requests.
- [Durable Object rate limiting](./durable-object-rate-limiting.md) - globally coordinated tenant/user/API-key quotas.
- [Feature flags](./feature-flags.md) - Cloudflare Flagship at the gateway and service layers.
- [Workers Cache](./workers-cache.md) - gateway-owned downstream cache policy for Cloudflare Workers Cache.
- [OpenFeature](./openfeature.md) - OpenFeature-style provider backed by Cloudflare Flagship.
- [Telemetry](./telemetry.md) - Analytics Engine request events and OTEL exporter hooks.
- [API versioning](./api-versioning.md) - mount `/v1` and `/v2` services side by side with deprecation headers and OpenAPI metadata.
- [API docs UI](./api-docs-ui.md) - choose Swagger UI or Scalar for interactive API docs.
- [Webhooks](./webhooks.md) - sign, verify, enqueue, and deliver webhook events with Queue retries.
- [API Shield](./api-shield.md) - Schema Validation, JWT validation, mTLS, Sequence Analytics, and CLI commands.
- [Release process](./release.md) - preflight checks, versioning, package review, and manual npm publish steps.
- [Service-to-service RPC](./rpc.md) - typed WorkerEntrypoint calls between services.
- [MCP server](./mcp.md) - expose gateway operations to MCP-compatible AI clients.
- [Reference](./reference.md) - OpenAPI aggregation, standard errors, testing, current gaps, and roadmap.

## Examples

- [Gateway + users + billing](../examples/gateway-basic/README.md)

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```
