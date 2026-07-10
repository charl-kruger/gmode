# @gmode/client
Tiny typed fetch runtime for manually wired GMode clients, with generated-client workflows handled by `gmode generate client`.

## Install

```bash
npm i @gmode/client
```

No peer dependencies. Generated clients from `@gmode/cli` are self-contained and do not require this runtime.

## Quick example

```ts
import { createClient, type OperationTypes } from "@gmode/client";

type User = { id: string; email: string };
type Api = Record<string, OperationTypes> & {
  getUser: { params: { id: string }; response: User };
  listUsers: { query: { limit?: number }; response: { data: User[] } };
  createUser: { body: { email: string }; response: User };
};

const api = createClient<Api>({
  baseUrl: "https://api.example.com",
  headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN}` }),
  operations: {
    getUser: { method: "GET", path: "/users/{id}" },
    listUsers: { method: "GET", path: "/users" },
    createUser: { method: "POST", path: "/users" },
  },
});

const user = await api.getUser({ params: { id: "u_1" } });
const created = await api.createUser({ body: { email: user.email } });
```

Generated usage:

```bash
npx gmode generate client --url https://api.example.com/openapi.json --out src/gmode
```

Manual mode uses `createClient<Api>()` when you want to write the operation map yourself or test against a partial gateway surface.

## API

| Export | Purpose |
|---|---|
| `createClient` | Build a typed fetch client from an operation type map and runtime operation definitions. |
| `ApiClientError` | Error thrown for non-2xx responses, preserving status, code, details, and request id. |
| `OperationTypes` | Type-level shape for params, query, body, and response. |
| `OperationDef` | Runtime method and OpenAPI-style path template. |
| `ClientOptions` | Client configuration for base URL, operations, headers, and custom fetch. |
| `TypedClient` | Method surface inferred from an API operation map. |

## Works with

[`@gmode/cli`](../cli) · [`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/testing`](../testing) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
