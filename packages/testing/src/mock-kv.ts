export type MockKvValue = {
  value: string;
  metadata?: unknown;
  expiration?: number;
};

export type MockKvListKey = {
  name: string;
  expiration?: number;
  metadata?: unknown;
};

export type MockKvListResult = {
  keys: MockKvListKey[];
  list_complete: boolean;
  cursor?: string;
  cacheStatus: null;
};

export type MockKvNamespace = {
  readonly entries: Map<string, MockKvValue>;
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<MockKvListResult>;
  clear(): void;
};

export function createMockKvNamespace(
  initial?: Record<string, string>,
): MockKvNamespace {
  const entries = new Map<string, MockKvValue>();
  for (const [key, value] of Object.entries(initial ?? {})) {
    entries.set(key, { value });
  }
  return {
    entries,
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      const next: MockKvValue = { value };
      if (options?.metadata !== undefined) {
        next.metadata = options.metadata;
      }
      if (options?.expiration !== undefined) {
        next.expiration = options.expiration;
      } else if (options?.expirationTtl !== undefined) {
        next.expiration =
          Math.floor(Date.now() / 1000) + options.expirationTtl;
      }
      entries.set(key, next);
    },
    async delete(key) {
      entries.delete(key);
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 1_000;
      const keys = [...entries.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .slice(0, limit)
        .map(([name, entry]) => {
          const key: MockKvListKey = { name };
          if (entry.expiration !== undefined) key.expiration = entry.expiration;
          if (entry.metadata !== undefined) key.metadata = entry.metadata;
          return key;
        });
      return {
        keys,
        list_complete: keys.length < limit,
        cacheStatus: null,
      };
    },
    clear() {
      entries.clear();
    },
  };
}
