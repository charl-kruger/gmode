/**
 * Wrap a web framework's Worker handler (TanStack Start, Remix, any
 * `fetch`-shaped handler) so the app can run as a GMode gateway service:
 *
 * - `<basePath><api.mount>/*` requests go to a typed `@gmode/service` instance
 *   (validated routes that join the gateway's aggregated OpenAPI + Swagger).
 * - `/__gmode/openapi.json` and `/__gmode/health` are served for the gateway's
 *   aggregation, health checks, and the `gmode dev` dashboard.
 * - `<basePath><api.mount>/openapi.json` mirrors the OpenAPI document for local
 *   dev binding probes (Vite may block `__gmode` paths on service bindings).
 * - Everything else falls through to the framework handler untouched — SSR
 *   streaming, server functions, and WebSockets keep working.
 */

/** Structural type for a `createService()` instance (avoids a hard dependency). */
export type ServiceLike<Env> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

/** A framework Worker handler: either `{ fetch }` or a bare fetch function. */
export type WebFrameworkHandler<Env> =
  | {
      fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
      ): Response | Promise<Response>;
    }
  | ((
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ) => Response | Promise<Response>);

/** Embedded API configuration for a web app. */
export type GmodeWebApiOptions<Env> = {
  /** The `createService()` instance serving the app's API routes. */
  service: ServiceLike<Env>;
  /** API mount inside the app, relative to `basePath`. Defaults to `/api`. */
  mount?: `/${string}`;
};

export type WithGmodeOptions<Env> = {
  /**
   * The public mount of this app on the gateway (matches `gateway.web()` /
   * gmode.jsonc). Needed because the gateway forwards web requests without
   * stripping the prefix. Defaults to `/`.
   */
  basePath?: `/${string}`;
  /** Optional typed API served by this app. */
  api?: GmodeWebApiOptions<Env>;
};

const INTERNAL_PREFIX = "/__gmode/";

function joinPrefix(basePath: string, mount: string): string {
  const left = basePath === "/" ? "" : basePath.replace(/\/$/, "");
  const right = mount === "/" ? "" : mount;
  return `${left}${right}`;
}

function isInternalPath(path: string, basePath: string): boolean {
  if (path.startsWith(INTERNAL_PREFIX)) return true;
  if (basePath !== "/") {
    const left = basePath.replace(/\/$/, "");
    return path === `${left}/__gmode` || path.startsWith(`${left}/__gmode/`);
  }
  return false;
}

function toInternalPath(path: string, basePath: string): string {
  if (path.startsWith(INTERNAL_PREFIX)) return path;
  if (basePath !== "/") {
    const left = basePath.replace(/\/$/, "");
    if (path === `${left}/__gmode` || path.startsWith(`${left}/__gmode/`)) {
      return path.slice(left.length);
    }
  }
  return path;
}

function rewritePath(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url.toString(), request);
}

function callHandler<Env>(
  handler: WebFrameworkHandler<Env>,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Response | Promise<Response> {
  if (typeof handler === "function") return handler(request, env, ctx);
  return handler.fetch(request, env, ctx);
}

/** Wrap a framework handler so the app runs as a GMode gateway web service. */
export function withGmode<Env = unknown>(
  handler: WebFrameworkHandler<Env>,
  options: WithGmodeOptions<Env> = {},
): ExportedHandler<Env> {
  const basePath = options.basePath ?? "/";
  const apiPrefix = options.api
    ? joinPrefix(basePath, options.api.mount ?? "/api")
    : null;

  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      // Internal endpoints for gateway aggregation and health checks.
      if (isInternalPath(path, basePath)) {
        const internalPath = toInternalPath(path, basePath);
        const internalRequest = rewritePath(request, internalPath);
        if (options.api) {
          return options.api.service.fetch(internalRequest, env, ctx);
        }
        if (internalPath === "/__gmode/health") {
          return Response.json({ ok: true });
        }
        if (internalPath === "/__gmode/openapi.json") {
          return Response.json({
            openapi: "3.1.0",
            info: { title: "Web app", version: "0.0.0" },
            paths: {},
          });
        }
        return new Response("Not found", { status: 404 });
      }

      // OpenAPI alias under the API mount (dev-friendly for gateway binding probes).
      if (apiPrefix && options.api && path === `${apiPrefix}/openapi.json`) {
        return options.api.service.fetch(
          rewritePath(request, "/__gmode/openapi.json"),
          env,
          ctx,
        );
      }

      // Typed API routes under `<basePath><api.mount>`.
      if (
        apiPrefix &&
        options.api &&
        (path === apiPrefix || path.startsWith(`${apiPrefix}/`))
      ) {
        const remainder = path.slice(apiPrefix.length) || "/";
        return options.api.service.fetch(
          rewritePath(request, remainder),
          env,
          ctx,
        );
      }

      return callHandler(handler, request, env, ctx);
    },
  };
}
