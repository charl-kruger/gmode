# Cloudflare Configuration

## Service Bindings

Gateway Workers forward to private services through Cloudflare Service
Bindings. In the gateway `wrangler.jsonc`:

```jsonc
{
  "services": [
    { "binding": "USERS_API", "service": "gmode-example-users-api" }
  ]
}
```

The binding name must match the `binding` used in `gateway.service(...)`.

## Native Cloudflare Rate Limiting

In the gateway `wrangler.jsonc`:

```jsonc
{
  "ratelimits": [
    {
      "name": "API_RATE_LIMITER",
      "namespace_id": "1001",
      "simple": { "limit": 1000, "period": 60 }
    }
  ]
}
```

Then mount the middleware:

```ts
gateway.use(
  cloudflareRateLimit({
    binding: "API_RATE_LIMITER",
    key: (ctx) => ctx.auth.user?.id ?? ctx.auth.tenant?.id ?? "anonymous",
  }),
);
```

Important constraints:

- `simple.period` must be `10` or `60` seconds.
- `namespace_id` is a string of a positive integer.
- Bindings sharing a `namespace_id` share counters across Workers in the same account.
- Counters are local to each Cloudflare location; global totals are eventually consistent.
- Prefer stable keys such as user ID, tenant ID, API key ID, or route group.

## KV For Idempotency

The `idempotency()` middleware stores response snapshots in KV so exact
duplicate unsafe requests can be replayed without calling the private service
or upstream API again.

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

Then mount the middleware:

```ts
gateway.use(
  idempotency({
    binding: "IDEMPOTENCY",
    ttlSeconds: 86_400,
    paths: ["/users", "/billing"],
  }),
);
```

See [Idempotency](./idempotency.md) for runtime behavior and placement.

## Secrets

In development, copy `.dev.vars.example` to `.dev.vars`. In production, use
Wrangler secrets:

```bash
wrangler secret put JWT_SECRET
wrangler secret put INTERNAL_SIGNING_SECRET
```

`INTERNAL_SIGNING_SECRET` must be identical across the gateway and every
service that verifies gateway context. Do not put secrets in `vars`.

Do not rely on a `secrets.required` block in `wrangler.jsonc` for validation;
the runtime code fails when required secrets are missing, and production
secrets should be set with `wrangler secret put`.

## Observability

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

Use a head sampling rate below `1` for high-traffic APIs. GMode emits
structured JSON logs through `requestLogger()`. For custom pipelines, use
Workers Logs, Tail Workers, or OTEL exporters.
