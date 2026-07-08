import type {
  McpOperationEntry,
  McpServerCatalog,
  McpTool,
  ResolvedMcpOptions,
} from "./types";

function describe(entry: McpOperationEntry): string {
  const parts: string[] = [];
  if (entry.summary) parts.push(entry.summary);
  if (entry.description && entry.description !== entry.summary) {
    parts.push(entry.description);
  }
  parts.push(`(${entry.method} ${entry.mount}${entry.path})`);
  if (entry.scopes && entry.scopes.length > 0) {
    parts.push(`Requires scopes: ${entry.scopes.join(", ")}.`);
  }
  if (entry.permissions && entry.permissions.length > 0) {
    parts.push(`Requires permissions: ${entry.permissions.join(", ")}.`);
  }
  if (entry.featureFlag) {
    parts.push(`Gated by feature flag: ${entry.featureFlag}.`);
  }
  return parts.join(" ");
}

/**
 * Convert each operation in the catalog into an MCP tool descriptor (one
 * tool per operation). Tool name = operationId (already de-duplicated by
 * the gateway's collision rewriter as `${serviceName}_${operationId}` when
 * needed).
 */
export function buildOperationTools<Env = unknown>(
  catalog: McpServerCatalog,
  options: ResolvedMcpOptions<Env>,
): McpTool[] {
  if (options.mode !== "tools") return [];
  if (catalog.operations.length > options.maxToolsInToolsMode) {
    throw new Error(
      `@gmode/mcp: ${catalog.operations.length} operations exceeds maxToolsInToolsMode=${options.maxToolsInToolsMode}. ` +
        `Use mode: "catalog" for large APIs, or raise maxToolsInToolsMode.`,
    );
  }
  return catalog.operations.map((op) => ({
    name: op.operationId,
    description: describe(op),
    inputSchema: op.inputSchema,
  }));
}

/** Short string describing an operation, used by catalog-mode `discover`. */
export function describeOperationLine(entry: McpOperationEntry): {
  operationId: string;
  method: string;
  path: string;
  serviceName: string;
  summary?: string;
  description?: string;
  tags?: string[];
  scopes?: string[];
  permissions?: string[];
  featureFlag?: string;
  inputSchema: Record<string, unknown>;
} {
  const out: ReturnType<typeof describeOperationLine> = {
    operationId: entry.operationId,
    method: entry.method,
    path: `${entry.mount}${entry.path}`,
    serviceName: entry.serviceName,
    inputSchema: entry.inputSchema,
  };
  if (entry.summary) out.summary = entry.summary;
  if (entry.description) out.description = entry.description;
  if (entry.tags) out.tags = entry.tags;
  if (entry.scopes) out.scopes = entry.scopes;
  if (entry.permissions) out.permissions = entry.permissions;
  if (entry.featureFlag) out.featureFlag = entry.featureFlag;
  return out;
}
