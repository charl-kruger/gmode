import { z, ZodError } from "zod";

/** Constructor input for `ApiError`. */
export type ApiErrorInput = {
  /** Stable machine-readable error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** HTTP status code. */
  status: number;
  /** Optional structured details safe for callers when `expose` is true. */
  details?: unknown;
  /** Whether this error may be exposed to clients. Defaults to `true`. */
  expose?: boolean;
};

/** Structured HTTP error used across gateway, service, RPC, and MCP flows. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(input: ApiErrorInput) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    if (input.details !== undefined) {
      this.details = input.details;
    }
    this.expose = input.expose ?? true;
  }
}

/** Convenience factories for common `ApiError` status codes. */
export const error = {
  badRequest(
    code: string = "BAD_REQUEST",
    message: string = "Bad request",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 400, details });
  },
  unauthorized(
    code: string = "UNAUTHORIZED",
    message: string = "Unauthorized",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 401, details });
  },
  forbidden(
    code: string = "FORBIDDEN",
    message: string = "Forbidden",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 403, details });
  },
  notFound(
    code: string = "NOT_FOUND",
    message: string = "Not found",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 404, details });
  },
  conflict(
    code: string = "CONFLICT",
    message: string = "Conflict",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 409, details });
  },
  payloadTooLarge(
    code: string = "PAYLOAD_TOO_LARGE",
    message: string = "Payload too large",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 413, details });
  },
  unsupportedMediaType(
    code: string = "UNSUPPORTED_MEDIA_TYPE",
    message: string = "Unsupported media type",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 415, details });
  },
  tooManyRequests(
    code: string = "TOO_MANY_REQUESTS",
    message: string = "Too many requests",
    details?: unknown,
  ): ApiError {
    return new ApiError({ code, message, status: 429, details });
  },
  internal(
    code: string = "INTERNAL_ERROR",
    message: string = "Internal server error",
    details?: unknown,
  ): ApiError {
    return new ApiError({
      code,
      message,
      status: 500,
      details,
      expose: false,
    });
  },
};

/** JSON error response shape returned by `serializeError()`. */
export type SerializedError = {
  status: number;
  body: {
    error: {
      code: string;
      message: string;
      status: number;
      requestId?: string;
      details?: unknown;
      stack?: string;
    };
  };
};

/**
 * Convert unknown thrown values into a stable JSON error body.
 *
 * `ApiError` keeps its status/code/message. Zod errors become
 * `400 VALIDATION_ERROR`. Unknown errors become `500 INTERNAL_ERROR`.
 */
export function serializeError(input: {
  err: unknown;
  requestId?: string | undefined;
  includeStack?: boolean | undefined;
}): SerializedError {
  const { err, requestId, includeStack } = input;

  if (err instanceof ApiError) {
    if (!err.expose) {
      const errorBody: SerializedError["body"]["error"] = {
        code: "INTERNAL_ERROR",
        message: includeStack ? err.message : "Internal server error",
        status: err.status,
      };
      if (requestId !== undefined) errorBody.requestId = requestId;
      if (includeStack && err.stack) errorBody.stack = err.stack;
      return { status: err.status, body: { error: errorBody } };
    }

    const errorBody: SerializedError["body"]["error"] = {
      code: err.code,
      message: err.message,
      status: err.status,
    };
    if (requestId !== undefined) errorBody.requestId = requestId;
    if (err.details !== undefined) errorBody.details = err.details;
    if (includeStack && err.stack) errorBody.stack = err.stack;
    return { status: err.status, body: { error: errorBody } };
  }

  if (err instanceof ZodError) {
    const errorBody: SerializedError["body"]["error"] = {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      status: 400,
      details: {
        issues: err.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      },
    };
    if (requestId !== undefined) errorBody.requestId = requestId;
    if (includeStack && err.stack) errorBody.stack = err.stack;
    return { status: 400, body: { error: errorBody } };
  }

  const errorBody: SerializedError["body"]["error"] = {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    status: 500,
  };
  if (requestId !== undefined) errorBody.requestId = requestId;
  if (includeStack && err instanceof Error && err.stack) {
    errorBody.stack = err.stack;
  }
  return { status: 500, body: { error: errorBody } };
}

/** JSON Schema for the standard GMode error envelope. */
export const apiErrorJsonSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "status"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        status: { type: "integer" },
        requestId: { type: "string" },
        details: {},
      },
    },
  },
} as const;

/** Zod schema for the standard GMode error envelope. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
