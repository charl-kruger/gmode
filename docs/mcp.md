# MCP Server

`@gmode/mcp` turns your gateway into a Streamable HTTP MCP server. It exposes
the gateway's aggregated OpenAPI operations without adding a code-execution
runtime.

## Mount

```ts
import { mountMcp } from "@gmode/mcp";

gateway.use(
  mountMcp({
    path: "/mcp",
    mode: "catalog",
    serverInfo: { name: "Example API MCP", version: "1.0.0" },
  }),
);
```

Mount MCP after auth and rate-limit middleware so tool calls inherit the same
identity, scopes, permissions, feature flags, and rate-limit policy as HTTP
requests.

## Modes

| Mode | Shape | Use when |
|---|---|---|
| `catalog` | Two tools: `discover` and `invoke` | Default. APIs with many operations or agent-driven discovery. |
| `tools` | One MCP tool per operation | Small APIs where direct tool lists are useful. |

```ts
mountMcp({ mode: "tools", maxToolsInToolsMode: 100 });
```

`include` and `exclude` filter operations by operation ID. `exclude` wins on
overlap.

```ts
mountMcp({
  include: ["users.*", "billing.createInvoice"],
  exclude: ["internal.*"],
});
```

## OAuth

Production MCP endpoints can require an explicit bearer token before any
JSON-RPC request is handled.

```ts
import { bearerTokenOAuthProvider, mountMcp } from "@gmode/mcp";

gateway.use(
  mountMcp({
    path: "/mcp",
    oauth: bearerTokenOAuthProvider({
      requiredScopes: ["mcp:access"],
      verifyToken: async ({ token, env }) => {
        const session = await env.OAUTH.verify(token);
        if (!session) return null;
        return {
          subject: session.subject,
          scopes: session.scopes,
          clientId: session.clientId,
          raw: session,
        };
      },
    }),
  }),
);
```

When OAuth is configured, missing or invalid bearer tokens fail with `401`
before MCP dispatch. Verified scopes are merged into the gateway auth context,
so `gateway.service(...)` auth, scopes, permissions, and per-operation service
rules still decide each `tools/call`.

Client requests must include:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H "authorization: Bearer $MCP_TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Resources And Prompts

The MCP server exposes API context without requiring clients to call HTTP docs
routes directly.

| Method | Result |
|---|---|
| `resources/list` | Lists `gmode://openapi.json` and `gmode://operations.json` |
| `resources/read` | Returns the aggregated OpenAPI document or compact operation catalog |
| `prompts/list` | Lists workflow prompts |
| `prompts/get` | Returns prompt messages for API inspection or operation invocation |

Resource read example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/read",
  "params": { "uri": "gmode://openapi.json" }
}
```

Prompt example:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "invoke-operation",
    "arguments": { "operationId": "getUser" }
  }
}
```

## Client Configuration

Claude Desktop example:

```json
{
  "mcpServers": {
    "gmode-example": {
      "url": "https://api.example.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

For local dev, use `http://127.0.0.1:8787/mcp`.

### MCP Inspector

`@gmode/mcp` supports the MCP Streamable HTTP transport. In the inspector UI,
choose:

| Field | Value |
|---|---|
| Transport Type | `Streamable HTTP` |
| URL | `http://127.0.0.1:8787/mcp` |

Do not choose `SSE`. The inspector still exposes that legacy transport, but
GMode does not serve an SSE session endpoint. If the inspector logs
`SSE transport` or `Does the MCP server support SSE?`, switch the transport
type to `Streamable HTTP`.

When running the repository example locally, start the gateway with
`pnpm dev -- --port 8787` from `examples/gateway-basic/gateway`. The example
Wrangler config runs `pnpm build:deps` first, so local `@gmode/gateway` and
`@gmode/mcp` workspace packages have their `dist` exports before Wrangler
bundles the Worker.

## Manual Smoke

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

curl -s -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"resources/list"}'

curl -s -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"discover","arguments":{"query":"user"}}}'

curl -s -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"invoke","arguments":{"operationId":"getUser","pathParams":{"id":"123"}}}}'
```
