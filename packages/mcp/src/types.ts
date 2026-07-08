import type {
  AuthContext,
  GModeTenant,
  GModeUser,
  MaybePromise,
  OpenApiDocument,
} from "@gmode/core";
import type { GatewayRequestContext } from "@gmode/gateway";

/**
 * MCP exposure strategy.
 *
 * `catalog` exposes two stable tools (`discover`, `invoke`) and is best for
 * larger APIs. `tools` exposes one MCP tool per operation and is best for
 * small APIs where direct tool lists are useful.
 */
export type McpMode = "catalog" | "tools";

/** Verified MCP OAuth identity returned by an `McpOAuthProvider`. */
export type McpOAuthContext = {
  /** Stable OAuth subject. Used as the default GMode user id. */
  subject: string;
  /** OAuth scopes granted to the MCP client. */
  scopes: string[];
  /** Optional GMode permissions granted to the MCP client. */
  permissions?: string[];
  /** Optional GMode user override. Defaults to `{ id: subject }`. */
  user?: GModeUser;
  /** Optional tenant merged into the gateway auth context. */
  tenant?: GModeTenant;
  /** Optional OAuth client id for audit trails. */
  clientId?: string;
  /** Raw provider-specific token/session payload. */
  raw?: unknown;
};

/** Verifies MCP-specific auth before JSON-RPC dispatch. */
export type McpOAuthProvider<Env = unknown> = {
  verify(input: {
    /** Incoming MCP HTTP request. */
    request: Request;
    /** Cloudflare Worker env bindings. */
    env: Env;
    /** Gateway middleware context before MCP dispatch. */
    context: GatewayRequestContext<Env>;
  }): MaybePromise<McpOAuthContext>;
};

/** Options passed to `mountMcp()`. */
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

/** Single API operation exposed through MCP. */
export type McpOperationEntry = {
  /** Stable operation id used as the MCP tool name or `invoke.operationId`. */
  operationId: string;
  /** Gateway service name that owns this operation. */
  serviceName: string;
  /** Gateway mount prefix for the owning service. */
  mount: string;
  /** Worker service binding name. */
  binding: string;
  /** HTTP method used when invoking the operation. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** OpenAPI-style path (with `{param}` placeholders), relative to the service mount. */
  path: string;
  /** Short operation summary from OpenAPI. */
  summary?: string;
  /** Longer operation description from OpenAPI. */
  description?: string;
  /** OpenAPI tags from the service route. */
  tags?: string[];
  /** Required scopes for this operation. */
  scopes?: string[];
  /** Required permissions for this operation. */
  permissions?: string[];
  /** Feature flag key guarding this operation. */
  featureFlag?: string;
  /** Synthesized `{ params, query, headers, body }` JSON Schema object. */
  inputSchema: Record<string, unknown>;
};

/** Arguments accepted by catalog-mode `invoke` and tools-mode operation tools. */
export type McpToolDispatchInput = {
  /** Operation id to invoke. In tools mode this is the tool name. */
  operationId: string;
  /** Path parameters matching `{param}` placeholders. */
  pathParams?: Record<string, string | number>;
  /** Query string parameters. Arrays become repeated query parameters. */
  query?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  /** Headers to include on the synthesized gateway request. */
  headers?: Record<string, string>;
  /** JSON body for POST/PUT/PATCH operations. */
  body?: unknown;
};

/** Result returned from invoking an operation through MCP. */
export type McpToolDispatchResult = {
  status: number;
  contentType: string | null;
  body: unknown;
};

/** Aggregated OpenAPI document plus operation catalog used by MCP handlers. */
export type McpServerCatalog = {
  spec: OpenApiDocument;
  operations: McpOperationEntry[];
};

export const MCP_STATE_KEY = "gmode.mcp";

/** Small state payload exposed to the gateway landing page. */
export type McpStateInfo = {
  path: string;
  mode: McpMode;
  serverInfo: { name: string; version: string };
};

/** MCP tool descriptor returned from `tools/list`. */
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** MCP resource descriptor returned from `resources/list`. */
export type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

/** MCP prompt descriptor returned from `prompts/list`. */
export type McpPrompt = {
  name: string;
  description: string;
  arguments?: {
    name: string;
    description: string;
    required?: boolean;
  }[];
};

/** Input for merging verified MCP OAuth identity into gateway auth context. */
export type McpAuthMergeInput = {
  existing: AuthContext;
  oauth: McpOAuthContext;
};
