import { ApiError, serializeError } from "@gmode/core";

/** Standard JSON-RPC 2.0 error codes plus MCP-specific extensions. */
export const McpErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export type McpErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

/**
 * Map a thrown ApiError (or any error) into the JSON-RPC error shape used by
 * `tools/call` responses. 4xx → InvalidParams, 5xx → InternalError, everything
 * else → InternalError. The framework's `ApiError.code` is preserved in `data`
 * so MCP clients can still discriminate on it.
 */
export function toMcpError(err: unknown): McpErrorPayload {
  const { status, body } = serializeError({ err });
  const code =
    status >= 400 && status < 500
      ? McpErrorCode.InvalidParams
      : McpErrorCode.InternalError;

  const payload: McpErrorPayload = {
    code,
    message: body.error.message,
    data: {
      code: body.error.code,
      status: body.error.status,
      ...(body.error.details !== undefined
        ? { details: body.error.details }
        : {}),
    },
  };
  return payload;
}

/** Convenience: throw an MCP-shaped error for clearly client-side issues. */
export function mcpInvalidParams(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "INVALID_PARAMS",
    message,
    status: 400,
    ...(details !== undefined ? { details } : {}),
  });
}
