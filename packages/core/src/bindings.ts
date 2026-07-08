/** Minimal KV namespace methods used by GMode helpers. */
export type GModeKvNamespace = Pick<
  KVNamespace,
  "get" | "put" | "delete" | "list"
>;

/** Minimal R2 bucket methods used by GMode helpers. */
export type GModeR2Bucket = Pick<
  R2Bucket,
  "get" | "put" | "delete" | "head" | "list"
>;

/** Minimal Queue binding methods used by GMode helpers. */
export type GModeQueue<Message> = {
  send(message: Message, options?: QueueSendOptions): Promise<void>;
  sendBatch?(
    messages: Iterable<MessageSendRequest<Message>>,
    options?: QueueSendBatchOptions,
  ): Promise<void>;
};

/** Minimal D1 database methods used by GMode helpers. */
export type GModeD1Database = Pick<
  D1Database,
  "prepare" | "batch" | "exec" | "dump"
>;

/**
 * Read a required binding from `env` and fail loudly if it is missing.
 *
 * Use this when a Worker cannot safely continue without a configured binding.
 */
export function requireBinding<Env, Binding extends keyof Env & string>(
  env: Env,
  binding: Binding,
): NonNullable<Env[Binding]> {
  const value = env[binding];
  if (value === null || value === undefined) {
    throw new Error(`Required binding "${binding}" is not configured`);
  }
  return value as NonNullable<Env[Binding]>;
}

/** Read and validate a required KV namespace binding. */
export function requireKvNamespace<Env, Binding extends keyof Env & string>(
  env: Env,
  binding: Binding,
): NonNullable<Env[Binding]> & GModeKvNamespace {
  const value = requireBinding(env, binding);
  assertBindingMethods(value, binding, "KV namespace", [
    "get",
    "put",
    "delete",
    "list",
  ]);
  return value as NonNullable<Env[Binding]> & GModeKvNamespace;
}

/** Read and validate a required R2 bucket binding. */
export function requireR2Bucket<Env, Binding extends keyof Env & string>(
  env: Env,
  binding: Binding,
): NonNullable<Env[Binding]> & GModeR2Bucket {
  const value = requireBinding(env, binding);
  assertBindingMethods(value, binding, "R2 bucket", [
    "get",
    "put",
    "delete",
    "head",
    "list",
  ]);
  return value as NonNullable<Env[Binding]> & GModeR2Bucket;
}

/** Read and validate a required Queue binding. */
export function requireQueue<
  Env,
  Binding extends keyof Env & string,
  Message,
>(
  env: Env,
  binding: Binding,
): NonNullable<Env[Binding]> & GModeQueue<Message> {
  const value = requireBinding(env, binding);
  assertBindingMethods(value, binding, "Queue", ["send"]);
  return value as NonNullable<Env[Binding]> & GModeQueue<Message>;
}

/** Read and validate a required D1 database binding. */
export function requireD1Database<Env, Binding extends keyof Env & string>(
  env: Env,
  binding: Binding,
): NonNullable<Env[Binding]> & GModeD1Database {
  const value = requireBinding(env, binding);
  assertBindingMethods(value, binding, "D1 database", [
    "prepare",
    "batch",
    "exec",
    "dump",
  ]);
  return value as NonNullable<Env[Binding]> & GModeD1Database;
}

function assertBindingMethods(
  value: unknown,
  binding: string,
  kind: string,
  methods: string[],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`Binding "${binding}" is not a ${kind}`);
  }
  const record = value as Record<string, unknown>;
  for (const method of methods) {
    if (typeof record[method] !== "function") {
      throw new Error(
        `Binding "${binding}" is not a ${kind}: missing ${method}()`,
      );
    }
  }
}
