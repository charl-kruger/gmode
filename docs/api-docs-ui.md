# API Docs UI

The gateway always exposes the aggregated OpenAPI document at
`/openapi.json` unless you configure another path. Swagger UI remains the
default interactive docs page at `/docs`.

## Swagger UI

```ts
const gateway = createGateway<Env>({
  name: "Acme API",
  version: "1.0.0",
  docs: {
    openapi: "/openapi.json",
    swagger: "/docs",
  },
  internal: { signingSecret: (env) => env.INTERNAL_SIGNING_SECRET },
});
```

`GET /docs` serves Swagger UI and points it at `/openapi.json`.

## Scalar

Enable Scalar by configuring a Scalar route:

```ts
const gateway = createGateway<Env>({
  name: "Acme API",
  version: "1.0.0",
  docs: {
    scalar: "/reference",
    ui: "scalar",
  },
  internal: { signingSecret: (env) => env.INTERNAL_SIGNING_SECRET },
});
```

`GET /reference` serves Scalar and points it at `/openapi.json`. Swagger UI
still remains available at `/docs` unless you move it.

To make Scalar the `/docs` page and keep Swagger available elsewhere:

```ts
const gateway = createGateway<Env>({
  name: "Acme API",
  version: "1.0.0",
  docs: {
    swagger: "/swagger",
    scalar: "/docs",
    ui: "scalar",
  },
  internal: { signingSecret: (env) => env.INTERNAL_SIGNING_SECRET },
});
```

The landing page marks whichever UI you set in `docs.ui` as the default docs
experience.
