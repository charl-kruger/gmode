# Feature Flags

GMode integrates with Cloudflare Flagship through its Workers binding.
Evaluation can happen at the gateway and inside services.

## Gateway Binding

```jsonc
{
  "flagship": [
    { "binding": "FLAGS", "app_id": "my-app" }
  ]
}
```

## Gateway Middleware

```ts
import { featureFlags } from "@gmode/gateway";

gateway.use(
  featureFlags<Env, "FLAGS">({
    binding: "FLAGS",
    gates: { "/billing": "billing-enabled" },
    forward: ["new-checkout"],
  }),
);
```

- `gates` can disable whole service mounts.
- `forward` pre-evaluates flags and includes them in signed gateway context.
- The default evaluation context is built from auth: user ID, email, tenant ID, scopes, and request ID.
- `gateBehavior: "503"` is available when disabled features should return 503 instead of 404.

## Service Checks

```ts
const service = createService<Env>({
  name: "Users API",
  version: "1.0.0",
  trustGateway: { signingSecret, audience: "users" },
  flags: { binding: (env) => env.FLAGS },
});

service.get("/v2/:id", {
  operationId: "getUserV2",
  featureFlag: "users-v2",
  responses: { 200: User },
  handler: async ({ flags, params }) => {
    const showEmail = await flags!.getBooleanValue("show-email", true);
    return { id: params.id, email: showEmail ? "u@example.com" : "" };
  },
});
```

If a service has no Flagship binding but the gateway forwarded a matching
flag, route gates can use `ctx.gateway.flags`.

## Testing

```ts
import { createMockFlagship } from "@gmode/testing";

const flags = createMockFlagship({
  booleans: { "users-v2": true, "billing-enabled": false },
  strings: { tier: "gold" },
});

flags.setBoolean("users-v2", false);
flags.calls;
```

Routes with `featureFlag` are documented with
`x-gmode-feature-flag: <key>` in OpenAPI.
