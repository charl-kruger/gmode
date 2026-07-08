export type MockR2Object = {
  key: string;
  body: Uint8Array;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  uploaded: Date;
};

export type MockR2ObjectBody = MockR2Object & {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T = unknown>(): Promise<T>;
};

export type MockR2ListResult = {
  objects: MockR2Object[];
  truncated: boolean;
  delimitedPrefixes: string[];
  cursor?: string;
};

export type MockR2Bucket = {
  readonly objects: Map<string, MockR2Object>;
  get(key: string): Promise<MockR2ObjectBody | null>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
    },
  ): Promise<MockR2Object>;
  delete(key: string | string[]): Promise<void>;
  head(key: string): Promise<MockR2Object | null>;
  list(options?: { prefix?: string; limit?: number }): Promise<MockR2ListResult>;
  clear(): void;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createMockR2Bucket(): MockR2Bucket {
  const objects = new Map<string, MockR2Object>();
  return {
    objects,
    async get(key) {
      const object = objects.get(key);
      return object ? toBody(object) : null;
    },
    async put(key, value, options) {
      const object: MockR2Object = {
        key,
        body: toBytes(value),
        uploaded: new Date(),
      };
      if (options?.httpMetadata) {
        object.httpMetadata = options.httpMetadata;
      }
      if (options?.customMetadata) {
        object.customMetadata = options.customMetadata;
      }
      objects.set(key, object);
      return object;
    },
    async delete(key) {
      if (Array.isArray(key)) {
        for (const item of key) objects.delete(item);
        return;
      }
      objects.delete(key);
    },
    async head(key) {
      return objects.get(key) ?? null;
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 1_000;
      const listed = [...objects.values()]
        .filter((object) => object.key.startsWith(prefix))
        .slice(0, limit);
      return {
        objects: listed,
        truncated: listed.length === limit,
        delimitedPrefixes: [],
      };
    },
    clear() {
      objects.clear();
    },
  };
}

function toBody(object: MockR2Object): MockR2ObjectBody {
  return {
    ...object,
    async text() {
      return decoder.decode(object.body);
    },
    async arrayBuffer() {
      const out = new ArrayBuffer(object.body.byteLength);
      new Uint8Array(out).set(object.body);
      return out;
    },
    async json<T = unknown>() {
      return JSON.parse(decoder.decode(object.body)) as T;
    },
  };
}

function toBytes(value: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}
