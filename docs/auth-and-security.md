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

## Private Gateway Context

Per request, the gateway forwards an encoded context header as
`x-gmode-context`. Services configured with `trustGateway` decode it, check the
issuer, audience, and expiry, then expose it to handlers as `ctx.gateway`.

Client-supplied `x-gmode-*` headers are stripped before forwarding, so
clients cannot override the gateway-generated identity or request context.

### HMAC signing

Set the same `GMODE_CONTEXT_SECRET` secret on the gateway and every service
Worker to upgrade the context header to a signed token
(`base64url(payload).base64url(hmac-sha256)`):

```bash
# Same value on the gateway and every service
wrangler secret put GMODE_CONTEXT_SECRET
```

No code changes are needed. When the secret is present:

- the gateway signs every forwarded context with HMAC-SHA256, and
- services reject unsigned or tampered tokens automatically.

`gmode init` generates this secret into `.dev.vars` for local development.
If your gateway `wrangler.jsonc` uses `secrets.required`, list
`GMODE_CONTEXT_SECRET` there too — otherwise Wrangler may not inject it from
`.dev.vars` even when the file contains the value.
You can customize resolution with `internal.signing.secret` on
`createGateway()` and `trustGateway.secret` on `createService()`, disable
signing with `internal: { signing: false }`, or accept unsigned tokens during
a rollout with `trustGateway: { allowUnsigned: true }`.

Without a secret, tokens are unsigned base64url JSON. That is safe only while
downstream services stay private Workers reached exclusively through
Cloudflare Service Bindings. Keep `workers_dev: false` and do not attach routes
or custom domains to service Workers. If a service must be public, protect that
public route with its own authentication layer — and configure the signing
secret.

## Hidden Landing Page

Set `docs.index: null` on `createGateway` to disable the public `/` landing
page.
