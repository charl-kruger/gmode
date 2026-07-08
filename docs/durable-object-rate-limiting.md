# Durable Object Rate Limiting

Use Cloudflare native rate limiting for most public API traffic. Use the
Durable Object limiter when you need strongly coordinated counters for a
tenant, user, API key, or route group.

## Worker Code

Export the Durable Object class from your gateway Worker and mount the
middleware:

```ts
import {
  DurableObjectRateLimiter,
  durableObjectRateLimit,
  createGateway,
} from "@gmode/gateway";

export { DurableObjectRateLimiter };

type Env = {
  USERS_API: Fetcher;
  RATE_LIMITER: DurableObjectNamespace<DurableObjectRateLimiter>;
};

const gateway = createGateway<Env>({
  name: "Acme API",
  version: "1.0.0",});

gateway.use(
  durableObjectRateLimit<Env, "RATE_LIMITER">({
    binding: "RATE_LIMITER",
    namespace: "tenant",
    key: (ctx) => ctx.auth.tenant?.id ?? "anonymous",
    limit: 120,
    periodSeconds: 60,
  }),
);
```

The middleware routes each key to a deterministic Durable Object name with
`getByName()`, calls the object's RPC `limit()` method, and returns `429` when
the fixed-window quota is exhausted.

Successful responses include:

- `x-rate-limit-policy: durable-object`
- `x-rate-limit-limit`
- `x-rate-limit-remaining`
- `x-rate-limit-reset`

## Wrangler Configuration

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "RATE_LIMITER",
        "class_name": "DurableObjectRateLimiter"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["DurableObjectRateLimiter"]
    }
  ]
}
```

## When To Use Which Limiter

Use Cloudflare native rate limiting when:

- Regional/eventual counters are acceptable.
- You want dashboard-managed rules.
- You need very low overhead for broad public traffic.

Use Durable Object rate limiting when:

- A tenant or API key must have one coordinated quota globally.
- You need application-defined keys from gateway auth context.
- You are willing to pay the Durable Object coordination cost for stricter behavior.
