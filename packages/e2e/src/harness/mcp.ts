/** POST a JSON-RPC 2.0 message to the gateway MCP endpoint. */
export async function postMcpRpc(
  gatewayUrl: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${gatewayUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text) return { status: res.status, json: null };
  return { status: res.status, json: JSON.parse(text) as unknown };
}
