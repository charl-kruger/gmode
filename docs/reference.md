# Reference

## OpenAPI Aggregation

Services expose OpenAPI 3.1 at `/__gmode/openapi.json`. The gateway fetches
each service spec through Cloudflare Service Bindings and serves the merged
document at `/openapi.json`.

Aggregation behavior:

- Prefixes paths by service mount.
- Dedupes identical schemas.
- Namespaces conflicting schemas by service name.
- Injects the standard `ApiError` schema.
- Serves Swagger UI at `/docs`.

Use `/openapi.json?profile=shield` for the OpenAPI 3.0.3 variant accepted by
Cloudflare API Shield.

## Standard Errors

All standard errors are JSON:

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User not found",
    "status": 404,
    "requestId": "req_abc123",
    "details": {}
  }
}
```

Use the `error` factory or `throw service.error.notFound(...)` in handlers.
`ZodError` and Standard Schema validation failures are converted to
`400 VALIDATION_ERROR`.

## Testing

Use Vitest and `@gmode/testing`:

```ts
import {
  createGatewayTestClient,
  createMockFetcher,
  createMockFlagship,
  createMockRateLimit,
  createMockRpcBinding,
  createServiceTestClient,
  createTestGatewayContext,
  createTestJwt,
} from "@gmode/testing";
```

Run the core test suite:

```bash
pnpm typecheck
pnpm test
pnpm build
```

See [TESTING.md](../TESTING.md) for the broader local workflow.

## Current Gaps

Not shipped yet:

- Live-zone smoke automation.
- First public npm release through the GitHub release workflow.

## Roadmap

- Multi-validator adapters beyond the Standard Schema base path.
- More API Shield automation around discovery and schema validation actions.
- Additional MCP authorization carve-outs for tenant-specific tool exposure.
