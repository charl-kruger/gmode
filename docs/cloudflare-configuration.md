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

## Workers Cache

GMode configures downstream cache policy at the gateway. The gateway resolves
the matching service registration, inherits or overrides the configured policy,
and forwards it to the service binding as Cloudflare `cf.cacheControl` for
`GET` and `HEAD` requests.

```ts
const gateway = createGateway<Env>({
  name: "Example API",
  version: "1.0.0",
  internal: { signingSecret: (env) => env.INTERNAL_SIGNING_SECRET },
  cache: {
    enabled: true,
    default: {
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
    },
  },
});

gateway.service("users", {
  mount: "/users",
  binding: "USERS_API",
  audience: "users",
});

gateway.service("billing", {
  mount: "/billing",
  binding: "BILLING_API",
  audience: "billing",
  auth: true,
  cache: false,
});
```

Cloudflare still enables cache per Worker. In the common GMode layout, keep the
public gateway Worker uncached so auth, rate limits, and routing run on every
request:

```jsonc
{
  "cache": { "enabled": false }
}
```

Then enable Workers Cache on each downstream service Worker that should store
cached responses from inherited gateway policies:

```jsonc
{
  "cache": { "enabled": true }
}
```

Workers Cache is checked for service binding `fetch()` calls, but the cache
belongs to the callee Worker. A gateway Worker cannot enable cache inside
another Worker at runtime.

Use `cache: false` for authenticated or tenant-sensitive services unless you
have a deliberate cache-key strategy. See [Workers Cache](./workers-cache.md)
for the runtime rules and purge constraints.

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

Declare required secrets in each Worker config so Wrangler fails deployment
when a required production secret is missing:

```jsonc
{
  "secrets": {
    "required": [
      { "name": "JWT_SECRET" },
      { "name": "INTERNAL_SIGNING_SECRET" }
    ]
  }
}
```

Runtime code still fails fast if a secret is absent, but `secrets.required`
catches the mistake before traffic reaches the Worker.

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
