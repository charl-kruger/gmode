import { GatewayImpl } from "./gateway";
import type { Gateway, GatewayOptions } from "./types";

/**
 * Create a Cloudflare Worker gateway that runs middleware, authenticates
 * public requests, and forwards matched paths to private Worker service
 * bindings.
 *
 * Pass your Worker `Env` type as the generic so service binding names,
 * middleware binding names, and cache resolvers are checked at compile time.
 *
 * @example
 * ```ts
 * type Env = { USERS_API: FetcherLike; JWT_SECRET: string };
 *
 * const gateway = createGateway<Env>({
 *   name: "Public API",
 *   version: "1.0.0",
 * });
 *
 * gateway.service("users", {
 *   mount: "/users",
 *   binding: "USERS_API",
 *   audience: "users",
 * });
 * ```
 */
export function createGateway<Env = unknown>(
  options: GatewayOptions<Env>,
): Gateway<Env> {
  return new GatewayImpl<Env>(options);
}
