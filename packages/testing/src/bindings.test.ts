import { describe, expect, it } from "vitest";
import { createMockD1Database } from "./mock-d1";
import { createMockKvNamespace } from "./mock-kv";
import { createMockQueue } from "./mock-queue";
import { createMockR2Bucket } from "./mock-r2";

describe("Cloudflare binding mocks", () => {
  it("stores and lists KV values", async () => {
    const kv = createMockKvNamespace({ "user:1": "Ada" });
    await kv.put("user:2", "Grace", { metadata: { role: "admin" } });

    await expect(kv.get("user:1")).resolves.toBe("Ada");
    await expect(kv.list({ prefix: "user:" })).resolves.toMatchObject({
      keys: [{ name: "user:1" }, { name: "user:2", metadata: { role: "admin" } }],
      list_complete: true,
    });
  });

  it("stores and reads R2 objects", async () => {
    const bucket = createMockR2Bucket();
    await bucket.put("users/u_123.json", JSON.stringify({ id: "u_123" }));

    const object = await bucket.get("users/u_123.json");
    await expect(object?.json<{ id: string }>()).resolves.toEqual({
      id: "u_123",
    });
    await expect(bucket.head("users/u_123.json")).resolves.toMatchObject({
      key: "users/u_123.json",
    });
  });

  it("records Queue messages", async () => {
    const queue = createMockQueue<{ id: string }>();
    await queue.send({ id: "msg_123" }, { delaySeconds: 5 });

    expect(queue.messages).toEqual([
      {
        message: { id: "msg_123" },
        options: { delaySeconds: 5 },
      },
    ]);
  });

  it("records D1 statements and returns registered rows", async () => {
    const db = createMockD1Database();
    db.setResult("select * from users where id = ?", [{ id: "u_123" }]);

    const row = await db
      .prepare<{ id: string }>("select * from users where id = ?")
      .bind("u_123")
      .first();

    expect(row).toEqual({ id: "u_123" });
    expect(db.statements).toEqual([
      {
        sql: "select * from users where id = ?",
        params: ["u_123"],
      },
    ]);
  });
});
