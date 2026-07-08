import type { GatewayMiddleware } from "@gmode/gateway";
import { handleMcpRequest } from "./handler";
import { mergeMcpOAuthAuth } from "./oauth";
import {
  MCP_STATE_KEY,
  type McpStateInfo,
  type MountMcpOptions,
  type ResolvedMcpOptions,
} from "./types";

function resolveOptions<Env>(
  options: MountMcpOptions<Env> | undefined,
): ResolvedMcpOptions<Env> {
  const path = options?.path ?? "/mcp";
  const resolved: ResolvedMcpOptions<Env> = {
    path,
    mode: options?.mode ?? "catalog",
    serverInfo: options?.serverInfo ?? {
      name: "GMode Gateway MCP",
      version: "1.0.0",
    },
    include: options?.include ?? [],
    exclude: options?.exclude ?? [],
    maxToolsInToolsMode: options?.maxToolsInToolsMode ?? 100,
  };
  if (options?.oauth) {
    resolved.oauth = options.oauth;
  }
  return resolved;
}

function matchesPath(pathname: string, mcpPath: string): boolean {
  if (pathname === mcpPath) return true;
  if (pathname === `${mcpPath}/`) return true;
  return false;
}

/**
 * Gateway middleware that exposes every aggregated service operation as
 * MCP tools over `POST <path>` (default: `/mcp`). Mount **after** auth and
 * rate-limit middleware so each `tools/call` inherits the same identity
 * and budget as a normal HTTP route.
 *
 * @example
 * ```ts
 * gateway.use(jwtAuth({ secret: (e) => e.JWT_SECRET, required: false }));
 * gateway.use(cloudflareRateLimit({ binding: "API_RATE_LIMITER" }));
 * gateway.use(
 *   mountMcp({
 *     path: "/mcp",
 *     serverInfo: { name: "Example API", version: "1.0.0" },
 *   }),
 * );
 * ```
 */
export function mountMcp<Env>(
  options?: MountMcpOptions<Env>,
): GatewayMiddleware<Env> {
  const resolved = resolveOptions<Env>(options);

  return async (context, next) => {
    // Always expose the MCP state info to the landing page renderer, even
    // for non-MCP requests — this lets `/` show "MCP endpoint: /mcp"
    // without a parallel registration mechanism.
    const stateInfo: McpStateInfo = {
      path: resolved.path,
      mode: resolved.mode,
      serverInfo: resolved.serverInfo,
    };
    context.state.set(MCP_STATE_KEY, stateInfo);

    if (
      context.request.method.toUpperCase() === "POST" &&
      matchesPath(context.url.pathname, resolved.path)
    ) {
      if (resolved.oauth) {
        const oauth = await resolved.oauth.verify({
          request: context.request,
          env: context.env,
          context,
        });
        context.auth = mergeMcpOAuthAuth({
          existing: context.auth,
          oauth,
        });
        context.state.set("gmode.mcp.oauth", oauth);
      }
      return handleMcpRequest({ context, options: resolved });
    }
    return next();
  };
}
