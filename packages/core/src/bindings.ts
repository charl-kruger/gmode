export type GModeKvNamespace = Pick<
  KVNamespace,
  "get" | "put" | "delete" | "list"
>;

export type GModeR2Bucket = Pick<
  R2Bucket,
  "get" | "put" | "delete" | "head" | "list"
>;

export type GModeQueue<Message> = {
  send(message: Message, options?: QueueSendOptions): Promise<void>;
  sendBatch?(
    messages: Iterable<MessageSendRequest<Message>>,
    options?: QueueSendBatchOptions,
  ): Promise<void>;
};

export type GModeD1Database = Pick<
  D1Database,
  "prepare" | "batch" | "exec" | "dump"
>;

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
