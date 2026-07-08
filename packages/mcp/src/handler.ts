import { aggregateOpenApi, getGatewayInternals } from "@gmode/gateway";
import type { GatewayRequestContext } from "@gmode/gateway";
import {
  DISCOVER_TOOL,
  INVOKE_TOOL,
  runDiscover,
  type DiscoverInput,
} from "./catalog-mode";
import { invokeOperation } from "./dispatch";
import { mcpInvalidParams, toMcpError } from "./errors";
import { buildMountIndex, findOperation } from "./mount-index";
import {
  getPrompt,
  listPrompts,
  listResources,
  readResource,
} from "./resources-prompts";
import { buildOperationTools } from "./tools-from-openapi";
import {
  jsonRpcResponse,
  methodNotFound,
  parseStreamableRequest,
  success,
  type JsonRpcRequest,
} from "./transport";
import type {
  McpServerCatalog,
  McpTool,
  McpToolDispatchInput,
  ResolvedMcpOptions,
} from "./types";

const MCP_PROTOCOL_VERSION = "2024-11-05";

async function buildCatalog<Env>(
  context: GatewayRequestContext<Env>,
  options: ResolvedMcpOptions<Env>,
): Promise<McpServerCatalog> {
  const internals = getGatewayInternals(context);
  if (!internals) {
    throw mcpInvalidParams(
      "Gateway internals unavailable to MCP handler",
    );
  }
  const spec = await aggregateOpenApi({
    context,
    env: context.env,
    gateway: {
      name: options.serverInfo.name,
      version: options.serverInfo.version,
    },
    services: [...internals.services],
  });
  return buildMountIndex({ spec, internals, options });
}

function listTools<Env>(
  catalog: McpServerCatalog,
  options: ResolvedMcpOptions<Env>,
): McpTool[] {
  if (options.mode === "tools") {
    return buildOperationTools(catalog, options);
  }
  return [DISCOVER_TOOL, INVOKE_TOOL];
}

function paramsRecord(params: unknown, method: string): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw mcpInvalidParams(`${method} params must be an object`);
  }
  return params as Record<string, unknown>;
}

function requiredStringParam(
  params: Record<string, unknown>,
  key: string,
  method: string,
): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw mcpInvalidParams(`${method} requires a string "${key}"`);
  }
  return value;
}

function optionalArgumentsParam(
  params: Record<string, unknown>,
  method: string,
): Record<string, unknown> | undefined {
  const value = params.arguments;
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw mcpInvalidParams(`${method} arguments must be an object`);
  }
  return value as Record<string, unknown>;
}

async function handleToolsCall<Env>(input: {
  context: GatewayRequestContext<Env>;
  options: ResolvedMcpOptions<Env>;
  catalog: McpServerCatalog;
  params: unknown;
}) {
  const params = (input.params ?? {}) as {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  const name = params.name;
  const args = params.arguments ?? {};
  if (typeof name !== "string") {
    throw mcpInvalidParams("tools/call requires a tool name");
  }

  if (input.options.mode === "catalog") {
    if (name === "discover") {
      const result = runDiscover(input.catalog, args as DiscoverInput);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    if (name === "invoke") {
      const toolInput = args as McpToolDispatchInput;
      if (typeof toolInput.operationId !== "string") {
        throw mcpInvalidParams(
          "invoke requires an `operationId` (string)",
        );
      }
      const entry = findOperation(input.catalog, toolInput.operationId);
      if (!entry) {
        throw mcpInvalidParams(
          `Unknown operationId: ${toolInput.operationId}. Use the \`discover\` tool to list available operations.`,
        );
      }
      const result = await invokeOperation({
        context: input.context,
        entry,
        toolInput,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.status >= 400,
      };
    }
    throw mcpInvalidParams(
      `Unknown tool: ${name}. Available: discover, invoke.`,
    );
  }

  // tools mode — one MCP tool per operation
  const entry = findOperation(input.catalog, name);
  if (!entry) {
    throw mcpInvalidParams(`Unknown tool: ${name}`);
  }
  const toolInput = args as Omit<McpToolDispatchInput, "operationId">;
  const result = await invokeOperation({
    context: input.context,
    entry,
    toolInput: { operationId: name, ...toolInput },
  });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: result.status >= 400,
  };
}

/**
 * Dispatch a single MCP JSON-RPC request and return the JSON-RPC reply.
 * Pure function over the request body — the middleware handles HTTP and
 * passes the parsed envelope here. Extracted so it can be unit-tested
 * without spinning up a gateway.
 */
export async function dispatchMcp<Env>(input: {
  context: GatewayRequestContext<Env>;
  options: ResolvedMcpOptions<Env>;
  rpc: JsonRpcRequest;
}): Promise<ReturnType<typeof success> | ReturnType<typeof methodNotFound>> {
  const { context, options, rpc } = input;
  const id = rpc.id ?? null;

  switch (rpc.method) {
    case "initialize": {
      return success(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: options.serverInfo,
      });
    }
    case "notifications/initialized":
    case "initialized": {
      return success(id, {});
    }
    case "tools/list": {
      const catalog = await buildCatalog(context, options);
      return success(id, { tools: listTools(catalog, options) });
    }
    case "resources/list": {
      return success(id, { resources: listResources() });
    }
    case "resources/read": {
      const catalog = await buildCatalog(context, options);
      const params = paramsRecord(rpc.params, "resources/read");
      return success(
        id,
        readResource({
          catalog,
          uri: requiredStringParam(params, "uri", "resources/read"),
        }),
      );
    }
    case "prompts/list": {
      return success(id, { prompts: listPrompts() });
    }
    case "prompts/get": {
      const params = paramsRecord(rpc.params, "prompts/get");
      const promptArguments = optionalArgumentsParam(params, "prompts/get");
      return success(
        id,
        getPrompt(
          promptArguments
            ? {
                name: requiredStringParam(params, "name", "prompts/get"),
                arguments: promptArguments,
              }
            : {
                name: requiredStringParam(params, "name", "prompts/get"),
              },
        ),
      );
    }
    case "tools/call": {
      const catalog = await buildCatalog(context, options);
      const result = await handleToolsCall({
        context,
        options,
        catalog,
        params: rpc.params,
      });
      return success(id, result);
    }
    case "ping": {
      return success(id, {});
    }
    default:
      return methodNotFound(id, rpc.method);
  }
}

/**
 * Handle a complete incoming HTTP request for the MCP endpoint. Parses,
 * dispatches, serializes — returns a `Response` ready to send to the client.
 */
export async function handleMcpRequest<Env>(input: {
  context: GatewayRequestContext<Env>;
  options: ResolvedMcpOptions<Env>;
}): Promise<Response> {
  const parsed = await parseStreamableRequest(input.context.request);
  if (!parsed.ok) {
    return jsonRpcResponse(parsed.response);
  }
  try {
    const reply = await dispatchMcp({
      context: input.context,
      options: input.options,
      rpc: parsed.request,
    });
    return jsonRpcResponse(reply);
  } catch (err) {
    return jsonRpcResponse({
      jsonrpc: "2.0",
      id: parsed.request.id ?? null,
      error: toMcpError(err),
    });
  }
}
