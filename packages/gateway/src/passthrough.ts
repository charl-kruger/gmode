import type { GatewayRequestContext } from "./types";

/** Web apps and WebSocket upgrades must not be re-wrapped by middleware. */
export function isPassthroughResponse(
  context: GatewayRequestContext<unknown>,
  response: Response,
): boolean {
  if (response.status === 101) return true;
  return context.matchedService?.kind === "web";
}
