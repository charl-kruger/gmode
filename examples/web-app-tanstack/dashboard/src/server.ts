import handler from "@tanstack/react-start/server-entry";
import { withGmode } from "@gmode/web";
import { api } from "./api";

/**
 * Custom TanStack Start server entry wrapped with GMode.
 *
 * - `/app/api/*`  -> typed gmode service routes (validated, in gateway Swagger)
 * - `/__gmode/*`  -> health + OpenAPI endpoints used by the gateway
 * - everything else -> TanStack Start SSR
 */
export default withGmode(handler, {
  basePath: "/app",
  api: { service: api, mount: "/api" },
});
