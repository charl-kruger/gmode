import {
  withGmode,
  type GmodeWebApiOptions,
  type WithGmodeOptions,
} from "./with-gmode";

/** Cloudflare Workers static assets binding. */
export type AssetsBinding = {
  fetch(request: Request): Promise<Response>;
};

export type CreateWebAppOptions<Env> = WithGmodeOptions<Env> & {
  /**
   * Env key holding the static assets binding. Defaults to `"ASSETS"`.
   * Configure the same name under `assets.binding` in wrangler.jsonc.
   */
  assetsBinding?: string;
};

/**
 * Worker entry for a static/SPA web app (Vite + React, etc.) behind the
 * GMode gateway.
 *
 * - `<basePath><api.mount>/*` -> typed `@gmode/service` routes
 * - `/__gmode/*`              -> health + OpenAPI for gateway aggregation
 * - everything else           -> static assets (with SPA fallback handled by
 *   wrangler's `not_found_handling: "single-page-application"`)
 */
export function createWebApp<Env = unknown>(
  options: CreateWebAppOptions<Env> = {},
): ExportedHandler<Env> {
  const assetsKey = options.assetsBinding ?? "ASSETS";

  const wrapped: WithGmodeOptions<Env> = {
    basePath: options.basePath ?? "/",
    ...(options.api ? { api: options.api as GmodeWebApiOptions<Env> } : {}),
  };

  return withGmode<Env>((request, env) => {
    const assets = (env as Record<string, unknown>)[assetsKey];
    if (
      !assets ||
      typeof (assets as Record<string, unknown>)["fetch"] !== "function"
    ) {
      return new Response(
        `Static assets binding "${assetsKey}" is not configured. ` +
          `Add an "assets" section to wrangler.jsonc with "binding": "${assetsKey}".`,
        { status: 500 },
      );
    }
    return (assets as AssetsBinding).fetch(request);
  }, wrapped);
}
