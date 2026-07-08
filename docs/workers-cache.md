# Workers Cache

GMode treats Workers Cache as a gateway-owned routing policy. Configure the
policy once on `createGateway()`, then downstream service registrations inherit
it unless they override or disable it.

Cloudflare's cache remains per Worker. A cached downstream service response is
stored by the service Worker, even though the policy decision is made by the
gateway.

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
  auth: false,
});

gateway.service("billing", {
  mount: "/billing",
  binding: "BILLING_API",
  audience: "billing",
  auth: true,
  cache: false,
});
```

For cacheable `GET` and `HEAD` requests, GMode forwards the inherited policy to
the service binding as Cloudflare `cf.cacheControl`; if configured, it also
forwards a `cf.cacheKey`. A service can override the default:

```ts
gateway.service("products", {
  mount: "/products",
  binding: "PRODUCTS_API",
  audience: "products",
  cache: {
    cacheControl: "public, max-age=300, stale-while-revalidate=3600",
    cacheKey: (ctx) => `products:${ctx.url.pathname}`,
  },
});
```

## Cloudflare Configuration

GMode owns the policy, but Cloudflare owns the cache. Enable Workers Cache in
`wrangler.jsonc` for the gateway if you want gateway responses cached before
gateway code runs:

```jsonc
{
  "cache": { "enabled": true }
}
```

Enable the same block on each downstream service Worker that should store
responses from inherited gateway policies. Wrangler configuration is per Worker;
a gateway Worker cannot turn on caching inside a different service Worker at
runtime.

Workers Cache runs for service binding `fetch()` calls. On a downstream cache
hit, the gateway still runs, but the service Worker is not invoked.

## Safety Rules

- GMode only sends cache directives for `GET` and `HEAD`.
- Authenticated services should opt out with `cache: false` unless the cache key
  is explicitly partitioned by identity and the response is safe to share.
- Requests with `Authorization` and responses with `Set-Cookie` trigger
  Cloudflare's normal cache bypass rules. Strip or normalize request headers
  only when the gateway has already enforced the authorization boundary.
- If a service sets `cache: true`, the gateway must have a default policy;
  otherwise GMode throws.
- Purges are scoped to the Worker entrypoint that calls `ctx.cache.purge(...)`.
  A gateway purge does not purge a downstream service Worker cache.
- Use live Cloudflare requests and `Cf-Cache-Status` to verify behavior. Local
  development cannot fully prove the network cache path.
