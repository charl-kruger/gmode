# Cloudflare Binding Helpers

GMode keeps Cloudflare bindings visible. The helpers in `@gmode/core` only
resolve required bindings and verify that the expected methods exist. They do
not wrap D1, R2, KV, or Queues with a custom data abstraction.

## Runtime Helpers

```ts
import {
  requireD1Database,
  requireKvNamespace,
  requireQueue,
  requireR2Bucket,
} from "@gmode/core";

type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  FILES: R2Bucket;
  JOBS: Queue<{ id: string }>;
};

const db = requireD1Database(env, "DB");
const cache = requireKvNamespace(env, "CACHE");
const files = requireR2Bucket(env, "FILES");
const jobs = requireQueue<Env, "JOBS", { id: string }>(env, "JOBS");
```

Each helper throws when the binding is missing or does not expose the required
Cloudflare methods. This keeps configuration errors explicit during local
development and production startup paths.

## Test Mocks

`@gmode/testing` includes in-memory mocks for common binding tests:

```ts
import {
  createMockD1Database,
  createMockKvNamespace,
  createMockQueue,
  createMockR2Bucket,
} from "@gmode/testing";

const env = {
  DB: createMockD1Database(),
  CACHE: createMockKvNamespace(),
  FILES: createMockR2Bucket(),
  JOBS: createMockQueue<{ id: string }>(),
};
```

The mocks cover the common local-test surface:

- KV: `get`, `put`, `delete`, `list`
- R2: `get`, `put`, `delete`, `head`, `list`
- Queue: `send`
- D1: `prepare`, `bind`, `first`, `all`, `raw`, `run`, `batch`, `exec`, `dump`

They are deterministic in-memory test doubles. Use Wrangler/workerd or a live
Cloudflare environment for platform behavior such as D1 SQL execution, R2
metadata edge cases, Queue retry timing, and KV eventual consistency.
