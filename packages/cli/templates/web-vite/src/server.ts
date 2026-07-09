import { createWebApp } from "@gmode/web";
import { api } from "./api";

/**
 * Worker entry: serves the SPA from static assets and mounts the typed API
 * at `__MOUNT__/api`. The API routes are aggregated into the gateway's
 * OpenAPI document and Swagger UI automatically.
 */
export default createWebApp({
  basePath: "__MOUNT__",
  api: { service: api, mount: "/api" },
});
