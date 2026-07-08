import type { McpOperationEntry, McpServerCatalog, McpTool } from "./types";
import { describeOperationLine } from "./tools-from-openapi";

/** Catalog-mode tool used to search available API operations. */
export const DISCOVER_TOOL: McpTool = {
  name: "discover",
  description:
    "Search the available API operations and return their JSON schemas. " +
    "Use this first to find the right operationId for a task. " +
    "Returns name, summary, method, path, required scopes/permissions, and inputSchema. " +
    "Pass a query string to fuzzy-match against operationId/summary/tags, or leave empty to list everything.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text filter against operationId/summary/tags (case-insensitive). Empty matches all.",
      },
      tag: {
        type: "string",
        description: "Filter by OpenAPI tag (exact match).",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 20,
      },
    },
    additionalProperties: false,
  },
};

/** Catalog-mode tool used to invoke a discovered operation by operation id. */
export const INVOKE_TOOL: McpTool = {
  name: "invoke",
  description:
    "Invoke a discovered operation by its operationId. Pass path params, query params, headers, and JSON body inline. " +
    "Returns the downstream response status, content-type, and parsed body.",
  inputSchema: {
    type: "object",
    required: ["operationId"],
    properties: {
      operationId: { type: "string" },
      pathParams: {
        type: "object",
        additionalProperties: { type: ["string", "number"] },
      },
      query: { type: "object" },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      body: {},
    },
    additionalProperties: false,
  },
};

function matchesQuery(entry: McpOperationEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (entry.operationId.toLowerCase().includes(q)) return true;
  if (entry.summary && entry.summary.toLowerCase().includes(q)) return true;
  if (entry.description && entry.description.toLowerCase().includes(q)) {
    return true;
  }
  if (entry.tags && entry.tags.some((t) => t.toLowerCase().includes(q))) {
    return true;
  }
  return false;
}

/** Input accepted by the catalog-mode `discover` tool. */
export type DiscoverInput = {
  query?: string;
  tag?: string;
  limit?: number;
};

/** Output returned by the catalog-mode `discover` tool. */
export type DiscoverOutput = {
  total: number;
  returned: number;
  operations: ReturnType<typeof describeOperationLine>[];
};

/** Search an MCP operation catalog by query/tag and return compact operation lines. */
export function runDiscover(
  catalog: McpServerCatalog,
  input: DiscoverInput,
): DiscoverOutput {
  const query = (input.query ?? "").trim();
  const tag = (input.tag ?? "").trim();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  const filtered = catalog.operations.filter((op) => {
    if (!matchesQuery(op, query)) return false;
    if (tag) {
      if (!op.tags || !op.tags.includes(tag)) return false;
    }
    return true;
  });

  return {
    total: filtered.length,
    returned: Math.min(filtered.length, limit),
    operations: filtered.slice(0, limit).map(describeOperationLine),
  };
}
