# OpenFeature Provider

GMode exposes an OpenFeature-style provider backed by the same Cloudflare
Flagship binding used by `createFlagsClient()`.

```ts
import { createOpenFeatureProvider } from "@gmode/core";

const provider = createOpenFeatureProvider(env.FLAGS, {
  tenantId: "t_123",
});

const enabled = await provider.resolveBooleanEvaluation(
  "checkout.enabled",
  false,
  { userId: "u_123" },
);
```

The provider exposes:

- `resolveBooleanEvaluation`
- `resolveStringEvaluation`
- `resolveNumberEvaluation`
- `resolveObjectEvaluation`

Each method returns:

```ts
type OpenFeatureResolutionDetails<T> = {
  value: T;
  variant?: string;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
};
```

## Context Values

Cloudflare Flagship only accepts primitive context values, so GMode keeps the
provider context type to:

```ts
Record<string, string | number | boolean>
```

Flatten arrays or nested objects before passing them to the provider:

```ts
await provider.resolveBooleanEvaluation("admin-tools", false, {
  userId: "u_123",
  scopes: ["admin", "users:write"].join(" "),
});
```

This matches `buildFlagshipContext()`, which converts auth scopes and
permissions into space-separated strings.
