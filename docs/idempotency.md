# Idempotency

Use gateway idempotency for unsafe client requests that may be retried by
clients, queues, proxies, or mobile networks. It is most useful for `POST`,
`PUT`, `PATCH`, and `DELETE` routes that create or mutate upstream state.

## Configure KV

In the gateway `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "IDEMPOTENCY",
      "id": "replace-with-production-kv-id",
      "preview_id": "replace-with-preview-kv-id"
    }
  ]
}
```

## Mount Middleware

```ts
import { createGateway, idempotency } from "@gmode/gateway";
import type { FetcherLike } from "@gmode/core";

type IdempotencyKv = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
};

type Env = {
  USERS_API: FetcherLike;
  IDEMPOTENCY: IdempotencyKv;
  INTERNAL_SIGNING_SECRET: string;
};

const gateway = createGateway<Env>({
  name: "Example API",
  version: "1.0.0",
  internal: { signingSecret: (env) => env.INTERNAL_SIGNING_SECRET },
});

gateway.use(
  idempotency({
    binding: "IDEMPOTENCY",
    ttlSeconds: 60 * 60 * 24,
    paths: ["/users", "/billing"],
  }),
);
```

By default the middleware applies to `POST`, `PUT`, `PATCH`, and `DELETE`.
Use `methods` to narrow that list.

## Runtime Behavior

For configured unsafe requests:

- Missing `Idempotency-Key` returns `400 IDEMPOTENCY_KEY_REQUIRED`.
- First request stores a fingerprint and response snapshot in KV.
- Exact duplicate retries replay the stored response with `x-idempotency-replayed: true`.
- Reusing the same key with a different method, path, query, content type, or body returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- Responses with status `500` or above are not cached by default.

The default storage key is scoped by tenant ID, user ID, and the raw
idempotency key. Override `key` if your API uses another identity model.

```ts
gateway.use(
  idempotency({
    binding: "IDEMPOTENCY",
    ttlSeconds: 86_400,
    key: (ctx, rawKey) => {
      const tenant = ctx.auth.tenant?.id;
      if (!tenant) throw new Error("Idempotency requires tenant auth");
      return `${tenant}:${rawKey}`;
    },
  }),
);
```

## Placement

Mount idempotency after middleware that populates `ctx.auth` if you want the
default scoped key to include user or tenant identity. Mount it before service
forwarding. A typical order is:

```ts
gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(jwtAuth({ secret: (env) => env.JWT_SECRET }));
gateway.use(idempotency({ binding: "IDEMPOTENCY", ttlSeconds: 86_400 }));
```

## Notes

Cloudflare KV is eventually consistent and is appropriate for retry replay.
It is not a global concurrency lock. If you need single-flight guarantees for
simultaneous duplicate requests, use a Durable Object-backed store.
