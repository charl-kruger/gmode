import { mcpInvalidParams } from "./errors";
import type {
  McpPrompt,
  McpResource,
  McpServerCatalog,
} from "./types";

const OPENAPI_URI = "gmode://openapi.json";
const OPERATIONS_URI = "gmode://operations.json";

export function listResources(): McpResource[] {
  return [
    {
      uri: OPENAPI_URI,
      name: "Aggregated OpenAPI",
      description:
        "Gateway-level OpenAPI document with all exposed service operations.",
      mimeType: "application/json",
    },
    {
      uri: OPERATIONS_URI,
      name: "Operation Catalog",
      description:
        "Compact MCP operation catalog with operationIds, mounts, methods, paths, scopes, and input schemas.",
      mimeType: "application/json",
    },
  ];
}

export function readResource(input: {
  catalog: McpServerCatalog;
  uri: string;
}): { contents: { uri: string; mimeType: string; text: string }[] } {
  if (input.uri === OPENAPI_URI) {
    return {
      contents: [
        {
          uri: OPENAPI_URI,
          mimeType: "application/json",
          text: JSON.stringify(input.catalog.spec, null, 2),
        },
      ],
    };
  }
  if (input.uri === OPERATIONS_URI) {
    return {
      contents: [
        {
          uri: OPERATIONS_URI,
          mimeType: "application/json",
          text: JSON.stringify(
            { operations: input.catalog.operations },
            null,
            2,
          ),
        },
      ],
    };
  }
  throw mcpInvalidParams(`Unknown resource URI: ${input.uri}`);
}

export function listPrompts(): McpPrompt[] {
  return [
    {
      name: "inspect-api",
      description:
        "Guide an MCP client through inspecting the available GMode API operations.",
      arguments: [
        {
          name: "query",
          description: "Optional API area or operation keyword to focus on.",
          required: false,
        },
      ],
    },
    {
      name: "invoke-operation",
      description:
        "Guide an MCP client through discovering and invoking one GMode operation safely.",
      arguments: [
        {
          name: "operationId",
          description: "Optional operationId if already known.",
          required: false,
        },
      ],
    },
  ];
}

function optionalStringArgument(
  args: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!args || args[key] === undefined) return undefined;
  const value = args[key];
  if (typeof value !== "string") {
    throw mcpInvalidParams(`Prompt argument "${key}" must be a string`);
  }
  return value;
}

function inspectApiPrompt(query: string | undefined): string {
  const focus = query ? ` Focus on operations matching "${query}".` : "";
  return [
    "Inspect this GMode API before making changes or invoking operations.",
    "Use resources/read for gmode://openapi.json when you need full schemas.",
    "Use tools/call discover to find operationIds, scopes, parameters, and request body shapes.",
    "Summarize the relevant operations and call out required authentication scopes.",
    focus,
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function invokeOperationPrompt(operationId: string | undefined): string {
  const target = operationId
    ? ` The target operationId is "${operationId}".`
    : " Start by discovering the correct operationId.";
  return [
    "Invoke an GMode API operation through MCP.",
    target,
    "Inspect the operation schema first, prepare path params, query params, headers, and JSON body explicitly, then call the operation through the gateway.",
    "If the operation requires scopes or permissions, verify the current identity has them before invoking.",
  ].join(" ");
}

export function getPrompt(input: {
  name: string;
  arguments?: Record<string, unknown>;
}): {
  description: string;
  messages: { role: "user"; content: { type: "text"; text: string } }[];
} {
  if (input.name === "inspect-api") {
    return {
      description: "Inspect available GMode API operations.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: inspectApiPrompt(
              optionalStringArgument(input.arguments, "query"),
            ),
          },
        },
      ],
    };
  }
  if (input.name === "invoke-operation") {
    return {
      description: "Discover and invoke one GMode operation safely.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: invokeOperationPrompt(
              optionalStringArgument(input.arguments, "operationId"),
            ),
          },
        },
      ],
    };
  }
  throw mcpInvalidParams(`Unknown prompt: ${input.name}`);
}
