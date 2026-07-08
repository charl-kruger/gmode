# EdgeKit To GMode Porting Plan

This repo is the focused GMode port of EdgeKit. The goal is a typed
Cloudflare Workers API framework centered on a public Gateway Worker and
private Service Workers.

## Scope

Keep:

- Gateway + Service architecture.
- Service Binding forwarding over `fetch()`.
- Service-to-service RPC over `WorkerEntrypoint`.
- OpenAPI aggregation and `/openapi.json?profile=shield`.
- Swagger or Scalar API docs.
- Auth, mTLS, request IDs, structured errors, idempotency, feature flags,
  rate limiting, telemetry, webhooks, and binding helpers.
- MCP catalog/tools integration over Streamable HTTP.
- Cloudflare API Shield CLI commands.
- Test helpers and the gateway-basic example.

Remove:

- Generated private services.
- Generated public API clients.
- Dynamic runtime service loading.
- Worker Loader integration.
- Arbitrary end-user code execution.
- Codegen package exports, CLI commands, docs, examples, and tests.

## Cloudflare Docs Checked

Checked on 2026-07-08:

- Wrangler configuration: `wrangler.jsonc` is the preferred config format for
  new projects, and Wrangler config should be treated as source of truth.
  See https://developers.cloudflare.com/workers/wrangler/configuration/.
- Service Bindings: private Workers can be reached without a public URL and
  can expose both `fetch()` and RPC methods. See
  https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/.
- Rate Limiting binding: configure `ratelimits`; `simple.period` must be `10`
  or `60`; counters are per Cloudflare location and eventually consistent.
  See https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/.
- KV: `get()` returns `null` for misses and KV reads can be stale after remote
  writes. See https://developers.cloudflare.com/kv/api/read-key-value-pairs/.
- D1, R2, Queues, and Durable Objects: keep the binding-helper layer thin and
  fail hard when a required binding is absent. See
  https://developers.cloudflare.com/d1/worker-api/,
  https://developers.cloudflare.com/r2/api/workers/workers-api-reference/,
  https://developers.cloudflare.com/queues/configuration/javascript-apis/, and
  https://developers.cloudflare.com/durable-objects/api/base/.
- API Shield Schema Validation: upload a Shield-compatible OpenAPI document
  and keep request body media types tight, especially `application/json`.
  See https://developers.cloudflare.com/api-shield/security/schema-validation/.

## Implementation Steps

1. Copy only focused workspace packages into the root repo:
   `core`, `gateway`, `service`, `rpc`, `mcp`, `testing`, and `cli`.
2. Rename public package scope and runtime headers from EdgeKit to GMode.
3. Delete generated-service, public-client, dynamic-service, Worker Loader,
   and code-execution implementation files.
4. Simplify gateway forwarding so every registered service resolves to a
   configured Service Binding and fails when the binding is missing.
5. Simplify MCP to `catalog` and `tools` modes:
   `catalog` exposes `discover` and `invoke`; `tools` exposes one tool per
   OpenAPI operation.
6. Reduce the CLI to Cloudflare API Shield commands.
7. Update docs, examples, package metadata, and tests to match the focused
   package set.
8. Run `pnpm install`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Verification Targets

- No active imports or package metadata reference codegen, Worker Loader, or
  end-user code execution.
- No gateway API exposes `dynamicService(...)`.
- `@gmode/cli` only registers `shield:*` commands.
- `@gmode/mcp` has no executor or loader option types.
- Typecheck, tests, and build pass across all retained packages and examples.
