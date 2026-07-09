# @gmode/client

Lightweight typed fetch runtime for generated OpenAPI clients.

`gmode generate client` emits a self-contained `gmode-client.ts` that imports
nothing at runtime except the platform `fetch`. This package provides the
shared patterns and error types used by the generator.

## Generated usage

```bash
gmode generate client --url http://localhost:8787/openapi.json --out ./generated
```

```ts
import { createClient } from "./generated/gmode-client";

const api = createClient({ baseUrl: "https://api.example.com" });
const user = await api.getUser({ params: { id: "u_1" } });
```

## Errors

Failed responses throw `ApiClientError` with `status`, `code`, and parsed body:

```ts
try {
  await api.getUser({ params: { id: "missing" } });
} catch (err) {
  if (err instanceof ApiClientError) {
    console.log(err.status, err.body);
  }
}
```

See `packages/cli/src/codegen/openapi-client.ts` for the generator.
