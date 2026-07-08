import type {
  AuthContext,
  GModeTenant,
  GModeUser,
  MaybePromise,
  OpenApiDocument,
} from "@gmode/core";
import type { GatewayRequestContext } from "@gmode/gateway";

export type McpMode = "catalog" | "tools";

export type McpOAuthContext = {
  subject: string;
  scopes: string[];
  permissions?: string[];
  user?: GModeUser;
  tenant?: GModeTenant;
  clientId?: string;
  raw?: unknown;
};

export type McpOAuthProvider<Env = unknown> = {
  verify(input: {
    request: Request;
    env: Env;
    context: GatewayRequestContext<Env>;
  }): MaybePromise<McpOAuthContext>;
};

export type MountMcpOptions<Env = unknown> = {
  /** URL path served by the MCP handler. Default: "/mcp". */
  path?: string;

  /** Tool registration strategy. Default: "catalog". */
  mode?: McpMode;

  /** Server identity returned in the MCP `initialize` handshake. */
  serverInfo?: { name: string; version: string };

  /**
   * Optional whitelist of operationIds (after gateway collision-rewriting).
   * Wildcards: `*` matches any chars, `?` matches one. If set, only matching
   * operations are exposed. include + exclude can both be set; exclude wins
   * on collision.
   */
  include?: string[];

  /** Optional blacklist of operationIds. Wildcards same as `include`. */
  exclude?: string[];

  /**
   * Hard cap on the operation-tool count when mode = "tools". The handler
   * refuses to start if exceeded; the framework recommends "catalog" mode for
   * >100 operations. Default: 100.
   */
  maxToolsInToolsMode?: number;

  /**
   * Optional MCP-specific OAuth guard. When configured, every POST to the MCP
   * endpoint must present a valid bearer token before JSON-RPC handling starts.
   * The verified identity is merged into the gateway auth context so normal
   * service auth/scopes/permissions still decide each tool invocation.
   */
  oauth?: McpOAuthProvider<Env>;

};

export type ResolvedMcpOptions<Env = unknown> = {
  path: string;
  mode: McpMode;
  serverInfo: { name: string; version: string };
  include: string[];
  exclude: string[];
  maxToolsInToolsMode: number;
  oauth?: McpOAuthProvider<Env>;
};

export type McpOperationEntry = {
  operationId: string;
  serviceName: string;
  mount: string;
  binding: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** OpenAPI-style path (with `{param}` placeholders), relative to the service mount. */
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  scopes?: string[];
  permissions?: string[];
  featureFlag?: string;
  /** Synthesized `{ params, query, headers, body }` JSON Schema object. */
  inputSchema: Record<string, unknown>;
};

export type McpToolDispatchInput = {
  operationId: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  headers?: Record<string, string>;
  body?: unknown;
};

export type McpToolDispatchResult = {
  status: number;
  contentType: string | null;
  body: unknown;
};

export type McpServerCatalog = {
  spec: OpenApiDocument;
  operations: McpOperationEntry[];
};

export const MCP_STATE_KEY = "gmode.mcp";

export type McpStateInfo = {
  path: string;
  mode: McpMode;
  serverInfo: { name: string; version: string };
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export type McpPrompt = {
  name: string;
  description: string;
  arguments?: {
    name: string;
    description: string;
    required?: boolean;
  }[];
};

export type McpAuthMergeInput = {
  existing: AuthContext;
  oauth: McpOAuthContext;
};
