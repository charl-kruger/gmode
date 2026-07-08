export { mountMcp } from "./middleware";

export { handleMcpRequest, dispatchMcp } from "./handler";

export { invokeOperation } from "./dispatch";

export { bearerTokenOAuthProvider, mergeMcpOAuthAuth } from "./oauth";
export type { BearerTokenOAuthProviderOptions } from "./oauth";

export { buildMountIndex, findOperation } from "./mount-index";

export { runDiscover, DISCOVER_TOOL, INVOKE_TOOL } from "./catalog-mode";
export type { DiscoverInput, DiscoverOutput } from "./catalog-mode";

export {
  getPrompt,
  listPrompts,
  listResources,
  readResource,
} from "./resources-prompts";

export {
  buildOperationTools,
  describeOperationLine,
} from "./tools-from-openapi";

export { toMcpError, mcpInvalidParams, McpErrorCode } from "./errors";
export type { McpErrorPayload } from "./errors";

export {
  parseStreamableRequest,
  jsonRpcResponse,
  isJsonRpcRequest,
  success,
  error,
  parseError,
  invalidRequest,
  methodNotFound,
} from "./transport";
export type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  JsonRpcError,
} from "./transport";

export { MCP_STATE_KEY } from "./types";
export type {
  McpMode,
  McpOAuthContext,
  McpOAuthProvider,
  MountMcpOptions,
  ResolvedMcpOptions,
  McpOperationEntry,
  McpServerCatalog,
  McpToolDispatchInput,
  McpToolDispatchResult,
  McpStateInfo,
  McpTool,
  McpResource,
  McpPrompt,
  McpAuthMergeInput,
} from "./types";
