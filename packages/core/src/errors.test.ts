import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, error, serializeError } from "./errors";

describe("ApiError", () => {
  it("constructs with the provided fields", () => {
    const err = new ApiError({
      code: "FOO",
      message: "foo",
      status: 418,
      details: { x: 1 },
    });
    expect(err.code).toBe("FOO");
    expect(err.status).toBe(418);
    expect(err.message).toBe("foo");
    expect(err.details).toEqual({ x: 1 });
    expect(err.expose).toBe(true);
  });
});

describe("error factory", () => {
  it("builds standard 400/401/403/404/409/413/415/429/500", () => {
    expect(error.badRequest().status).toBe(400);
    expect(error.unauthorized().status).toBe(401);
    expect(error.forbidden().status).toBe(403);
    expect(error.notFound().status).toBe(404);
    expect(error.conflict().status).toBe(409);
    expect(error.payloadTooLarge().status).toBe(413);
    expect(error.unsupportedMediaType().status).toBe(415);
    expect(error.tooManyRequests().status).toBe(429);
    expect(error.internal().status).toBe(500);
  });
});

describe("serializeError", () => {
  it("keeps message and details for exposed ApiError", () => {
    const err = error.notFound("U_NOT_FOUND", "no user", { id: "1" });
    const { status, body } = serializeError({
      err,
      requestId: "req_1",
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("U_NOT_FOUND");
    expect(body.error.message).toBe("no user");
    expect(body.error.requestId).toBe("req_1");
    expect(body.error.details).toEqual({ id: "1" });
  });

  it("redacts message and details for expose:false ApiError but keeps status", () => {
    const err = new ApiError({
      code: "DATABASE_ERROR",
      message: "database password leaked",
      status: 503,
      details: { secret: "value" },
      expose: false,
    });
    const { status, body } = serializeError({
      err,
      requestId: "req_private",
    });
    expect(status).toBe(503);
    expect(body.error.status).toBe(503);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.requestId).toBe("req_private");
    expect(body.error.details).toBeUndefined();
    expect(body.error.stack).toBeUndefined();
  });

  it("reveals message and stack for expose:false ApiError when includeStack is true", () => {
    const err = new ApiError({
      code: "DATABASE_ERROR",
      message: "database password leaked",
      status: 503,
      details: { secret: "value" },
      expose: false,
    });
    const { body } = serializeError({ err, includeStack: true });
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("database password leaked");
    expect(body.error.details).toBeUndefined();
    expect(body.error.stack).toContain("database password leaked");
  });

  it("returns 500 for unknown errors and hides internals by default", () => {
    const { status, body } = serializeError({
      err: new Error("kaboom"),
      requestId: "req_2",
    });
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.stack).toBeUndefined();
  });

  it("returns 400 VALIDATION_ERROR for ZodError", () => {
    const schema = z.object({ id: z.string() });
    const parsed = schema.safeParse({ id: 1 });
    if (parsed.success) throw new Error("expected failure");
    const { status, body } = serializeError({ err: parsed.error });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray((body.error.details as { issues: unknown[] }).issues))
      .toBe(true);
  });
});
