import { GatewayImpl } from "./gateway";
import type { Gateway, GatewayOptions } from "./types";

export function createGateway<Env = unknown>(
  options: GatewayOptions<Env>,
): Gateway<Env> {
  return new GatewayImpl<Env>(options);
}
