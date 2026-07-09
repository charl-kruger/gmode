# Reference

## Packages

| Package | npm | Role |
|---|---|---|
| `@gmode/core` | public | Shared primitives |
| `@gmode/gateway` | public | Gateway runtime |
| `@gmode/service` | public | Service runtime |
| `@gmode/rpc` | public | WorkerEntrypoint RPC |
| `@gmode/mcp` | public | MCP over OpenAPI |
| `@gmode/web` | public | Web app mounting (`withGmode`, `createWebApp`) |
| `@gmode/client` | public | Typed fetch client runtime |
| `@gmode/cli` | public | `gmode` CLI + Shield commands |
| `@gmode/dashboard` | public | Dev dashboard static UI |
| `@gmode/testing` | public | Test mocks and clients |
| `create-gmode` | public | `pnpm create gmode` scaffolder |

All public packages are versioned together via Changesets (fixed group). See
[Release process](./release.md).

## OpenAPI Aggregation

Services expose OpenAPI 3.1 at `/__gmode/openapi.json`. Web apps using
`withGmode()` expose OpenAPI at `{mount}{apiMount}/openapi.json` (for example
`/app/api/openapi.json`). The gateway fetches each spec through Service
Bindings (with a loopback fallback in local dev when binding probes fail) and
serves the merged document at `/openapi.json`.

Aggregation behavior:

- Prefixes paths by service or web-app mount.
- Dedupes identical schemas.
- Namespaces conflicting schemas by service name.
- Injects the standard `ApiError` schema.
- Serves Swagger UI at `/docs` (or Scalar when configured).

Use `/openapi.json?profile=shield` for the OpenAPI 3.0.3 variant accepted by
Cloudflare API Shield. Use `?refresh=1` to bypass the gateway's in-memory cache.

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

### Unit and integration

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

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

### E2E smoke (`@gmode/e2e`)

Live-process tests spawn `wrangler dev` / `gmode dev` once via Vitest
`globalSetup`, then run 9 smoke suites (~80s total):

```bash
pnpm test:e2e:smoke
```

E2E is **not** part of `pnpm test` (runs in a dedicated CI job). See
[TESTING.md](../TESTING.md) for the full suite table.

## Current Gaps

Not shipped yet:

- First public npm release through the GitHub release workflow (Changesets
  configured; `NPM_TOKEN` required in GitHub secrets).
- Live-zone Shield automation in CI (optional; set `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ZONE_ID` to un-skip 3 E2E tests).
- Real `gmode deploy` smoke against a staging zone (dry-run is covered).

## Roadmap

- Multi-validator adapters beyond the Standard Schema base path.
- More API Shield automation around discovery and schema validation actions.
- Additional MCP authorization carve-outs for tenant-specific tool exposure.
