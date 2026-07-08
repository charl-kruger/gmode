import { describe, expect, it } from "vitest";
import {
  accepted,
  created,
  json,
  noContent,
  ok,
  paginated,
} from "./response";

describe("response helpers", () => {
  it("json sets status and content-type", async () => {
    const r = json({ a: 1 }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(await r.json()).toEqual({ a: 1 });
  });

  it("ok/created/accepted use correct statuses", () => {
    expect(ok({}).status).toBe(200);
    expect(created({}).status).toBe(201);
    expect(accepted({}).status).toBe(202);
  });

  it("noContent returns 204 with no body", async () => {
    const r = noContent();
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
  });

  it("paginated wraps data + pagination", async () => {
    const r = paginated([1, 2, 3], { hasMore: true, nextCursor: "c2" });
    const json = (await r.json()) as { data: number[]; pagination: unknown };
    expect(json.data).toEqual([1, 2, 3]);
    expect(json.pagination).toEqual({ hasMore: true, nextCursor: "c2" });
  });
});
