import { describe, expect, it } from "vitest";
import {
  requireBinding,
  requireD1Database,
  requireKvNamespace,
  requireQueue,
  requireR2Bucket,
} from "./bindings";

describe("binding helpers", () => {
  it("returns configured bindings", () => {
    const kv = {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
      async list() {
        return { keys: [], list_complete: true, cacheStatus: null };
      },
    };
    const env = { KV: kv };
    expect(requireBinding(env, "KV")).toBe(kv);
    expect(requireKvNamespace(env, "KV")).toBe(kv);
  });

  it("throws when a binding is missing", () => {
    const env: { KV?: unknown } = {};
    expect(() => requireBinding(env, "KV")).toThrow(
      'Required binding "KV" is not configured',
    );
  });

  it("throws when a binding is the wrong kind", () => {
    const env = { KV: { get: async () => null } };
    expect(() => requireKvNamespace(env, "KV")).toThrow(
      'Binding "KV" is not a KV namespace: missing put()',
    );
  });

  it("checks common Cloudflare binding shapes", () => {
    const env = {
      BUCKET: {
        async get() {
          return null;
        },
        async put() {
          return null;
        },
        async delete() {},
        async head() {
          return null;
        },
        async list() {
          return { objects: [], delimitedPrefixes: [], truncated: false };
        },
      },
      QUEUE: {
        async send() {},
      },
      DB: {
        prepare() {
          return {};
        },
        async batch() {
          return [];
        },
        async exec() {
          return { count: 0, duration: 0 };
        },
        async dump() {
          return new ArrayBuffer(0);
        },
      },
    };

    expect(requireR2Bucket(env, "BUCKET")).toBe(env.BUCKET);
    expect(requireQueue<typeof env, "QUEUE", { id: string }>(
      env,
      "QUEUE",
    )).toBe(env.QUEUE);
    expect(requireD1Database(env, "DB")).toBe(env.DB);
  });
});
