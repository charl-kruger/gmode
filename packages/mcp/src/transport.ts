import { McpErrorCode, type McpErrorPayload } from "./errors";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: McpErrorPayload;
};

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj["jsonrpc"] === "2.0" && typeof obj["method"] === "string";
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function error(
  id: JsonRpcId,
  err: McpErrorPayload,
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: err };
}

export function parseError(id: JsonRpcId, message: string): JsonRpcError {
  return error(id, { code: McpErrorCode.ParseError, message });
}

export function invalidRequest(
  id: JsonRpcId,
  message: string,
): JsonRpcError {
  return error(id, { code: McpErrorCode.InvalidRequest, message });
}

export function methodNotFound(
  id: JsonRpcId,
  method: string,
): JsonRpcError {
  return error(id, {
    code: McpErrorCode.MethodNotFound,
    message: `Method not found: ${method}`,
  });
}

export type StreamableRequestParseResult =
  | { ok: true; request: JsonRpcRequest }
  | { ok: false; response: JsonRpcResponse };

/**
 * Parse a Streamable-HTTP MCP request body. Single-message JSON only for
 * MVP — batched calls and SSE streaming are spec-allowed but unused by
 * the major MCP clients (Claude Desktop, Cursor, Continue). Adding them
 * later only requires changes here, not in handler.ts.
 */
export async function parseStreamableRequest(
  request: Request,
): Promise<StreamableRequestParseResult> {
  let text: string;
  try {
    text = await request.text();
  } catch (e) {
    return {
      ok: false,
      response: parseError(
        null,
        `Failed to read request body: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    };
  }
  if (!text) {
    return { ok: false, response: invalidRequest(null, "Empty request body") };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      response: parseError(
        null,
        `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      ),
    };
  }
  if (!isJsonRpcRequest(parsed)) {
    return {
      ok: false,
      response: invalidRequest(
        null,
        "Request is not a JSON-RPC 2.0 message",
      ),
    };
  }
  return { ok: true, request: parsed };
}

/** Build a streamable-HTTP-compatible Response from a JSON-RPC reply. */
export function jsonRpcResponse(payload: JsonRpcResponse): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
