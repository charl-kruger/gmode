# @gmode/core
Shared errors, context signing, OpenAPI, webhook, response, flag, and binding primitives for GMode Workers.

## Install

```bash
npm i @gmode/core
```

Requires Node 20+ for local tooling and Workers-compatible Web Crypto at runtime. `zod` is installed as a dependency.

## Quick example

```ts
import {
  error,
  serializeError,
  encodeSignedGatewayContext,
  verifyGatewayContext,
  mergeServiceSpecs,
  createWebhookEvent,
  serializeWebhookEvent,
  signWebhookBody,
  requireQueue,
} from "@gmode/core";

const err = serializeError({ err: error.forbidden("NOPE", "Denied") });
console.log(err.status, err.body.error.code);

const now = Math.floor(Date.now() / 1000);
const token = await encodeSignedGatewayContext({
  iss: "gmode-gateway", aud: "users", requestId: "req_1",
  authenticated: true, scopes: ["users:read"], permissions: [],
  issuedAt: now, expiresAt: now + 60,
}, "secret");
await verifyGatewayContext(token, { audience: "users", secret: "secret" });

mergeServiceSpecs({ base: { openapi: "3.1.0", info: { title: "API", version: "1" } }, services: [] });
const event = createWebhookEvent({ id: "evt_1", type: "user.created", data: { id: "u_1" } });
await signWebhookBody({ id: event.id, body: serializeWebhookEvent(event), secret: "whsec" });
requireQueue({ JOBS: { async send(_message: { id: string }) {} } }, "JOBS");
```

Errors + `serializeError`:

```ts
const thrown = error.badRequest("INVALID_INPUT", "Name is required");
const { status, body } = serializeError({ err: thrown, requestId: "req_1" });
```

Signed gateway context:

```ts
const token = await encodeSignedGatewayContext(context, env.GMODE_CONTEXT_SECRET);
const gateway = await verifyGatewayContext(token, { audience: "users", secret: env.GMODE_CONTEXT_SECRET });
```

OpenAPI merge:

```ts
const spec = mergeServiceSpecs({ base, services: [{ serviceName: "users", mount: "/users", spec: usersSpec }] });
const operations = listOpenApiOperations(spec);
```

Webhooks:

```ts
const body = serializeWebhookEvent(createWebhookEvent({ id: "evt_1", type: "ping", data: {} }));
const headers = await signWebhookBody({ id: "evt_1", body, secret: "whsec" });
```

Binding guards:

```ts
const kv = requireKvNamespace(env, "CACHE");
const bucket = requireR2Bucket(env, "ASSETS");
```

## API

| Export | Purpose |
|---|---|
| `ApiError`, `error`, `serializeError`, `ApiErrorSchema`, `apiErrorJsonSchema` | Structured API errors and JSON-safe serialization. |
| `json`, `ok`, `created`, `accepted`, `noContent`, `paginated` | Response helpers for service handlers. |
| `GMODE_HEADERS`, `stripGModeHeaders`, `readContextSecret` | Standard private gateway headers and context-secret lookup. |
| `encodeGatewayContext`, `encodeSignedGatewayContext`, `decodeGatewayContext`, `verifyGatewayContext` | Private gateway context token encode/decode/verify helpers. |
| `hmacSign`, `hmacVerify`, `base64urlEncode`, `base64urlDecodeToString` | Low-level signing and base64url helpers. |
| `createFlagsClient`, `buildFlagshipContext`, `createOpenFeatureProvider` | Flagship/OpenFeature integration helpers. |
| `mergeServiceSpecs`, `toShieldCompatibleSpec`, `listOpenApiOperations`, `pruneOpenApiDocument` | OpenAPI aggregation, Shield conversion, and operation filtering. |
| `createWebhookEvent`, `serializeWebhookEvent`, `signWebhookBody`, `verifyWebhookBody`, `enqueueWebhookDelivery`, `deliverWebhookMessage` | Webhook event signing, verification, queueing, and delivery. |
| `requireBinding`, `requireKvNamespace`, `requireR2Bucket`, `requireQueue`, `requireD1Database` | Runtime guards for required Cloudflare bindings. |
| `defineSequences`, `redact`, `logStructured`, `matchesScope`, `matchesAllScopes`, `isValidRequestId` | Shared policy, logging, redaction, and utility helpers. |

## Works with

[`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/rpc`](../rpc) · [`@gmode/mcp`](../mcp) · [`@gmode/testing`](../testing) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
