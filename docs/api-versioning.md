# API Versioning

GMode supports versioned gateway mounts without changing the normal service
runtime. Use `gateway.apiVersion(...)` to group one or more services under a
public prefix such as `/v1` or `/v2`.

## Mount Versions

```ts
const gateway = createGateway<Env>({
  name: "Acme API",
  version: "2.0.0",});

gateway
  .apiVersion({ name: "v1", prefix: "/v1" })
  .service("users-v1", {
    mount: "/users",
    binding: "USERS_V1",
    audience: "users",
    openapi: true,
  });

gateway
  .apiVersion({ name: "v2", prefix: "/v2" })
  .service("users-v2", {
    mount: "/users",
    binding: "USERS_V2",
    audience: "users",
    openapi: true,
  });
```

Requests to `/v1/users/:id` reach `USERS_V1` as `/:id`. Requests to
`/v2/users/:id` reach `USERS_V2` as `/:id`. Gateway auth, request IDs,
idempotency, rate limiting, feature flags, private gateway context, and service
OpenAPI aggregation all continue to run through the same gateway pipeline.

## Deprecate A Version

```ts
gateway
  .apiVersion({
    name: "v1",
    prefix: "/v1",
    deprecated: {
      sunset: "Wed, 31 Dec 2025 23:59:59 GMT",
      link: "https://docs.example.com/api/v1-deprecation",
      message: "Use v2.",
    },
  })
  .service("users-v1", {
    mount: "/users",
    binding: "USERS_V1",
    audience: "users",
    openapi: true,
  });
```

Deprecated versions add these response headers to matched service responses:

- `Deprecation: true`
- `Sunset: <configured sunset>` when provided
- `Link: <configured link>; rel="deprecation"` when provided
- `x-gmode-api-version: <version name>`
- `x-gmode-deprecation-message: <message>` when provided

The aggregated gateway OpenAPI document marks operations under deprecated
versions with `deprecated: true` and includes GMode extension metadata:

- `x-gmode-api-version`
- `x-gmode-deprecated-version`
- `x-gmode-sunset`
- `x-gmode-deprecation-link`
- `x-gmode-deprecation-message`
