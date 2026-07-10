# @gmode/mcp
Expose a GMode gateway as a Streamable HTTP MCP server backed by aggregated OpenAPI operations.

## Install

```bash
npm i @gmode/mcp @gmode/gateway
```

`@gmode/gateway` is a peer dependency. `@gmode/core` and `zod` are installed as dependencies.

## Quick example

```ts
import { createGateway, jsonErrors, requestId } from "@gmode/gateway";
import { bearerTokenOAuthProvider, mountMcp } from "@gmode/mcp";

type Env = { OAUTH: { verify(token: string): Promise<{ sub: string } | null> } };
const gateway = createGateway<Env>({ name: "Acme API", version: "1.0.0" });

gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(mountMcp({ path: "/mcp", mode: "catalog" }));
gateway.use(mountMcp({
  path: "/secure-mcp",
  mode: "tools",
  oauth: bearerTokenOAuthProvider({
    requiredScopes: ["mcp:access"],
    verifyToken: async ({ token, env }) => {
      const session = await env.OAUTH.verify(token);
      return session && { subject: session.sub, scopes: ["mcp:access"] };
    },
  }),
}));

export default gateway;
```

`catalog` mode exposes stable `discover` and `invoke` tools. `tools` mode exposes one MCP tool per operation and is best for small APIs; `maxToolsInToolsMode` defaults to 100.

## API

| Export | Purpose |
|---|---|
| `mountMcp` | Gateway middleware that serves MCP JSON-RPC at `path` (default `/mcp`). |
| `handleMcpRequest`, `dispatchMcp`, `invokeOperation` | Lower-level request and tool dispatch helpers. |
| `bearerTokenOAuthProvider`, `mergeMcpOAuthAuth` | OAuth bearer-token verification and auth-context merge helpers. |
| `runDiscover`, `DISCOVER_TOOL`, `INVOKE_TOOL` | Catalog-mode discovery and invocation tools. |
| `buildOperationTools`, `describeOperationLine` | Tools-mode descriptors derived from OpenAPI operations. |
| `listResources`, `readResource`, `listPrompts`, `getPrompt` | MCP resources and prompts for API inspection. |
| `toMcpError`, `mcpInvalidParams`, `McpErrorCode` | MCP error helpers. |
| `parseStreamableRequest`, `jsonRpcResponse`, `success`, `error`, `invalidRequest`, `methodNotFound` | Streamable HTTP JSON-RPC helpers. |
| `MountMcpOptions`, `McpMode`, `McpOAuthProvider`, `McpServerCatalog`, `McpTool` | Main MCP configuration and catalog types. |

## Works with

[`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/core`](../core) · [`@gmode/testing`](../testing) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
