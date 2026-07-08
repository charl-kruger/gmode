import { ServiceImpl } from "./service";
import type { Service, ServiceOptions } from "./types";

/**
 * Create a typed downstream service Worker.
 *
 * Services define validated HTTP routes, internal OpenAPI metadata, gateway
 * context trust settings, and optional Flagship access. Export the returned
 * service as the Worker default, or pass it to `defineEntrypoint()` when the
 * same Worker also exposes RPC methods.
 *
 * @example
 * ```ts
 * const service = createService<Env>({
 *   name: "Users API",
 *   version: "1.0.0",
 *   trustGateway: { audience: "users" },
 * });
 *
 * service.get("/:id", {
 *   params: z.object({ id: z.string() }),
 *   responses: { 200: User },
 *   handler: ({ params }) => ({ id: params.id }),
 * });
 * ```
 */
export function createService<Env = unknown>(
  options: ServiceOptions<Env>,
): Service<Env> {
  return new ServiceImpl<Env>(options);
}
