import type { FlagshipEvaluationContext } from "@gmode/core";
import type { GatewayServiceEntry } from "./types";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderValue(value: unknown): string {
  if (value === null) return '<span class="null">null</span>';
  if (value === undefined) return '<span class="null">undefined</span>';
  if (typeof value === "boolean") {
    return `<span class="bool ${value ? "true" : "false"}">${value}</span>`;
  }
  if (typeof value === "number") return `<span class="num">${value}</span>`;
  if (typeof value === "string") {
    return `<span class="str">"${escape(value)}"</span>`;
  }
  try {
    return `<span class="json">${escape(JSON.stringify(value))}</span>`;
  } catch {
    return `<span class="str">${escape(String(value))}</span>`;
  }
}

function renderKeyValueTable(rows: Array<[string, unknown]>): string {
  return rows
    .map(
      ([k, v]) =>
        `<tr><td class="k">${escape(k)}</td><td class="v">${renderValue(v)}</td></tr>`,
    )
    .join("\n      ");
}

export type GatewayIndexFlagsInfo = {
  bindingName?: string;
  bindingMissing?: boolean;
  evaluationContext?: FlagshipEvaluationContext;
  forwarded?: Record<string, unknown>;
  gates?: Record<string, string>;
};

export type GatewayIndexMcpInfo = {
  path: string;
  mode: "catalog" | "tools";
  serverInfo: { name: string; version: string; };
};

export function gatewayIndexHtml<Env>(input: {
  name: string;
  version: string;
  basePath: string;
  openapiPath: string;
  swaggerPath: string;
  scalarPath: string | null;
  docsUi: "swagger" | "scalar";
  services: GatewayServiceEntry<Env>[];
  requestId: string;
  flags?: GatewayIndexFlagsInfo;
  mcp?: GatewayIndexMcpInfo;
}): string {
  const join = (p: string) =>
    input.basePath
      ? `${input.basePath.replace(/\/$/, "")}${p}`
      : p;

  const openapiHref = join(input.openapiPath);
  const swaggerHref = join(input.swaggerPath);
  const scalarHref = input.scalarPath ? join(input.scalarPath) : null;
  const swaggerHint = input.docsUi === "swagger"
    ? "Interactive API reference · default"
    : "Interactive API reference";
  const scalarHint = input.docsUi === "scalar"
    ? "Modern API reference · default"
    : "Modern API reference";
  const scalarItem = scalarHref
    ? `<li><a href="${escape(scalarHref)}">Scalar</a><span class="hint">${escape(scalarHint)}</span></li>`
    : "";

  const servicesHtml = input.services
    .slice()
    .sort((a, b) => a.config.mount.localeCompare(b.config.mount))
    .map(
      (s) =>
        `<li><span class="mount">${escape(s.config.mount)}</span> <span class="svc">${escape(s.name)}${s.kind === "web" ? " · web app" : ""
        }${s.kind === "web" && s.web?.openapi
          ? ` · api at ${escape(s.config.mount === "/" ? s.web.apiMount : s.config.mount + s.web.apiMount)}`
          : ""
        }${s.config.auth ? " · auth required" : ""
        }${s.config.scopes && s.config.scopes.length > 0
          ? ` · scopes: ${s.config.scopes.map(escape).join(", ")}`
          : ""
        }</span></li>`,
    )
    .join("\n      ");

  const flags = input.flags;
  const badgeClass = flags?.bindingMissing ? "badge missing" : "badge";
  const badgeLabel = flags?.bindingMissing
    ? `${escape(flags.bindingName ?? "FLAGS")} · unavailable`
    : flags?.bindingName
      ? escape(flags.bindingName)
      : "";
  const flagsSection = flags
    ? `
  <h2>Feature flags${badgeLabel ? ` <span class="${badgeClass}">${badgeLabel}</span>` : ""}</h2>
  ${flags.bindingMissing
      ? `<div class="card warn">
    <div class="card-h">Binding "${escape(flags.bindingName ?? "FLAGS")}" not bound</div>
    <div class="hint">
      The <code>featureFlags()</code> middleware is mounted but <code>env.${escape(flags.bindingName ?? "FLAGS")}</code> is undefined at runtime.
      Common causes: <code>wrangler dev</code> wasn't restarted after editing <code>wrangler.jsonc</code>;
      wrangler version &lt; 4.92 (doesn't parse the <code>"flagship"</code> key);
      OAuth token missing the <code>flagship:write</code> scope (run <code>wrangler login</code>).
      <code>failOpen: true</code> is masking this — every request degrades silently.
    </div>
  </div>`
      : ""
    }
  ${!flags.bindingMissing && flags.evaluationContext && Object.keys(flags.evaluationContext).length > 0
      ? `<div class="card">
    <div class="card-h">Evaluation context</div>
    <div class="hint">Attributes shipped with every <code>env.${escape(flags.bindingName ?? "FLAGS")}.get*Value()</code> call. Targeting rules in the Flagship dashboard can match on these.</div>
    <table class="kv">
      ${renderKeyValueTable(Object.entries(flags.evaluationContext))}
    </table>
  </div>`
      : !flags.bindingMissing
        ? `<p class="hint">No evaluation context — the request is anonymous. Flag rules use configured defaults until you authenticate.</p>`
        : ""
    }
  ${flags.gates && Object.keys(flags.gates).length > 0
      ? `<div class="card">
    <div class="card-h">Service-mount gates</div>
    <div class="hint">When a gate flag evaluates to <code>false</code>, the matched mount short-circuits without forwarding.</div>
    <table class="kv">
      ${renderKeyValueTable(
        Object.entries(flags.gates).map(([mount, key]) => [
          mount,
          key,
        ]),
      )}
    </table>
  </div>`
      : ""
    }
  ${flags.forwarded && Object.keys(flags.forwarded).length > 0
      ? `<div class="card">
    <div class="card-h">Forwarded flags <span class="hint">(this request)</span></div>
    <div class="hint">Pre-evaluated values rolled into the private gateway context as <code>ctx.gateway.flags</code>.</div>
    <table class="kv">
      ${renderKeyValueTable(Object.entries(flags.forwarded))}
    </table>
  </div>`
      : flags.evaluationContext
        ? `<p class="hint">No flags forwarded for this request. Configure <code>featureFlags({ forward: [...] })</code> to ship values to services.</p>`
        : ""
    }`
    : "";

  const mcp = input.mcp;
  const mcpEndpointPath = mcp ? join(mcp.path) : "";
  const mcpEndpointUrl = mcpEndpointPath;
  const claudeConfig = mcp
    ? JSON.stringify(
      {
        mcpServers: {
          [escape(mcp.serverInfo.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || "gmode"]: {
            url: mcpEndpointUrl,
            transport: "streamable-http",
          },
        },
      },
      null,
      2,
    )
    : "";

  const curlInit = mcp
    ? `curl -X POST ${mcpEndpointUrl} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`
    : "";
  const curlList = mcp
    ? `curl -X POST ${mcpEndpointUrl} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'`
    : "";
  const curlInvoke =
    mcp && mcp.mode === "catalog"
      ? `curl -X POST ${mcpEndpointUrl} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"discover","arguments":{"query":""}}}'`
      : mcp
        ? `# tools mode — call any operation directly by name
curl -X POST ${mcpEndpointUrl} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"<operationId>","arguments":{}}}'`
        : "";

  const mcpSection = mcp
    ? `
  <h2>MCP <span class="badge">${escape(mcp.mode)} mode</span></h2>
  <div class="card">
    <div class="card-h">${escape(mcp.serverInfo.name)} <span class="hint">· v${escape(mcp.serverInfo.version)}</span></div>
    <div class="hint">
      Every aggregated API operation is callable as an MCP tool. Point an MCP-compatible
      client (Claude Desktop, Cursor, etc.) at <code>POST ${escape(mcpEndpointPath)}</code>
      using the Streamable-HTTP transport. Auth, scopes, feature flags, and rate limits
      apply per call exactly like regular HTTP routes.
    </div>
    <table class="kv">
      <tr><td class="k">endpoint</td><td class="v"><span class="str">"${escape(mcpEndpointUrl)}"</span></td></tr>
      <tr><td class="k">transport</td><td class="v"><span class="str">"streamable-http"</span></td></tr>
      <tr><td class="k">mode</td><td class="v"><span class="str">"${escape(mcp.mode)}"</span></td></tr>
      ${mcp.mode === "catalog"
      ? `<tr><td class="k">tools</td><td class="v"><span class="str">"discover"</span>, <span class="str">"invoke"</span></td></tr>`
      : `<tr><td class="k">tools</td><td class="v"><span class="hint">one per operation (see Swagger UI)</span></td></tr>`
    }
    </table>
  </div>
  <div class="card">
    <div class="card-h">Connect from Claude Desktop / Cursor</div>
    <div class="hint">Add this to your <code>claude_desktop_config.json</code> (or equivalent client config), then restart.</div>
    <pre class="codeblock"><code>${escape(claudeConfig)}</code></pre>
  </div>
  <div class="card">
    <div class="card-h">Quick test from your terminal</div>
    <div class="hint">Confirm the handshake, list tools, and run ${mcp.mode === "catalog" ? "<code>discover</code>" : "an operation"
    }:</div>
    <pre class="codeblock"><code>${escape(curlInit)}</code></pre>
    <pre class="codeblock"><code>${escape(curlList)}</code></pre>
    <pre class="codeblock"><code>${escape(curlInvoke)}</code></pre>
  </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escape(input.name)}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 24px; line-height: 1.5; color: #111827; }
    @media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #0b0d12; } }
    header { margin-bottom: 32px; }
    h1 { margin: 0 0 4px; font-size: 28px; }
    .meta { color: #6b7280; font-size: 14px; }
    h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; margin: 32px 0 12px; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { padding: 10px 0; border-bottom: 1px solid rgba(127,127,127,0.18); display: flex; flex-direction: column; gap: 2px; }
    li:last-child { border-bottom: none; }
    a { color: #2563eb; text-decoration: none; font-weight: 500; }
    @media (prefers-color-scheme: dark) { a { color: #60a5fa; } }
    a:hover { text-decoration: underline; }
    .hint { color: #6b7280; font-size: 13px; }
    .mount { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-weight: 600; }
    .svc { color: #6b7280; font-size: 13px; }
    code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; background: rgba(127,127,127,0.12); padding: 1px 6px; border-radius: 4px; font-size: 13px; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid rgba(127,127,127,0.18); color: #6b7280; font-size: 12px; }
    pre.codeblock { background: rgba(127,127,127,0.10); border: 1px solid rgba(127,127,127,0.18); border-radius: 6px; padding: 10px 12px; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 12px; line-height: 1.45; overflow-x: auto; margin: 8px 0; white-space: pre; }
    pre.codeblock code { background: transparent; padding: 0; font-size: 12px; }
    .badge { display: inline-block; background: rgba(34,197,94,0.15); color: #16a34a; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; vertical-align: middle; margin-left: 8px; text-transform: none; letter-spacing: 0; font-family: ui-monospace, monospace; }
    .badge.missing { background: rgba(234,179,8,0.15); color: #b45309; }
    @media (prefers-color-scheme: dark) {
      .badge { background: rgba(34,197,94,0.2); color: #4ade80; }
      .badge.missing { background: rgba(234,179,8,0.2); color: #fbbf24; }
    }
    .card { border: 1px solid rgba(127,127,127,0.18); border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
    .card.warn { border-color: rgba(234,179,8,0.4); background: rgba(234,179,8,0.06); }
    .card-h { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
    .card .hint { font-size: 12px; margin-bottom: 10px; }
    table.kv { width: 100%; border-collapse: collapse; font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 13px; }
    table.kv td { padding: 4px 8px; border-bottom: 1px solid rgba(127,127,127,0.10); vertical-align: top; }
    table.kv tr:last-child td { border-bottom: none; }
    table.kv td.k { color: #6b7280; white-space: nowrap; width: 40%; }
    table.kv td.v { word-break: break-word; }
    .bool.true { color: #16a34a; }
    .bool.false { color: #dc2626; }
    .num { color: #9333ea; }
    .str { color: #2563eb; }
    .null { color: #9ca3af; font-style: italic; }
    @media (prefers-color-scheme: dark) {
      .bool.true { color: #4ade80; }
      .bool.false { color: #f87171; }
      .num { color: #c084fc; }
      .str { color: #60a5fa; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escape(input.name)}</h1>
    <div class="meta">v${escape(input.version)} · built with GMode</div>
  </header>

  <h2>Documentation</h2>
  <ul>
    <li><a href="${escape(swaggerHref)}">Swagger UI</a><span class="hint">${escape(swaggerHint)}</span></li>
    ${scalarItem}
    <li><a href="${escape(openapiHref)}">OpenAPI 3.1 spec</a><span class="hint">Raw JSON · <code>${escape(openapiHref)}</code></span></li>
    <li><a href="${escape(openapiHref)}?profile=shield">OpenAPI 3.0 (Shield-compatible)</a><span class="hint">Downgraded variant for Cloudflare API Shield upload</span></li>
  </ul>

  <h2>Services${input.services.length ? ` (${input.services.length})` : ""}</h2>
  ${input.services.length === 0
      ? '<p class="hint">No services registered yet. Call <code>gateway.service(name, { mount, binding })</code> to add one.</p>'
      : `<ul>
      ${servicesHtml}
    </ul>`
    }
${flagsSection}${mcpSection}
  <footer>Request ID: <code>${escape(input.requestId)}</code></footer>
</body>
</html>`;
}
