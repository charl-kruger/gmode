# Auth And Security

## JWT

Use HS256 JWT verification with `jwtAuth({ secret, required })`.

```ts
gateway.use(
  jwtAuth({
    secret: (env) => env.JWT_SECRET,
    required: true,
  }),
);
```

Default claim mapping reads `sub`, `email`, `name`, `scope`/`scopes`, and
`permissions`. Override with `mapUser`, `mapTenant`, `mapScopes`, and
`mapPermissions`.

When Cloudflare API Shield validates JWTs at the edge, pass
`assumeShieldVerified: true` to decode claims without re-verifying the
signature. Only enable this when Shield is enforcing JWT validation for the
same routes.

## API Keys

```ts
gateway.use(
  apiKeyAuth({
    header: "x-api-key",
    required: true,
    verify: async (key) => {
      if (key !== "expected") return null;
      return {
        authenticated: true,
        user: { id: "api-user" },
        scopes: ["users:read"],
        permissions: [],
      };
    },
  }),
);
```

## mTLS

`mtls()` reads `request.cf.tlsClientAuth`, which Cloudflare sets when mTLS
is configured on the zone.

```ts
gateway.use(
  mtls({
    required: true,
    accept: (cert) => cert.certVerified === "SUCCESS",
  }),
);
```

The verified cert is available at `context.auth.raw.mtls` and
`context.state.get("gmode.mtls")`.

## Signed Gateway Context

Per request, the gateway signs a context token with HMAC-SHA256 and forwards
it as `x-gmode-context`. Services configured with `trustGateway` verify the
token before running handlers.

Client-supplied `x-gmode-*` headers are stripped before forwarding, so
clients cannot forge internal identity or request context.

## Hidden Landing Page

Set `docs.index: null` on `createGateway` to disable the public `/` landing
page.
