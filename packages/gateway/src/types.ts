import type { AuthContext, FlagsClient } from "@gmode/core";

export type { FetcherLike, GatewayContext } from "@gmode/core";

/** HTTP methods that can be cached by the gateway forwarding layer. */
export type GatewayCacheMethod = "GET" | "HEAD";

/**
 * Static value or per-request resolver used by gateway configuration.
 *
 * Resolver functions receive the full gateway request context, including
 * `env`, auth state, matched service, request id, and feature flag client.
 */
export type GatewayCacheResolver<Env, T> =
  | T
  | ((context: GatewayRequestContext<Env>) => T);

/**
 * Cache policy applied when forwarding a request to a bound downstream Worker.
 *
 * `cacheControl` is passed to Cloudflare's Workers `fetch()` `cf.cacheControl`
 * option. `cacheKey`, when provided, is passed as `cf.cacheKey`.
 */
export type GatewayDownstreamCachePolicy<Env> = {
  /** Cache-Control directive used by Cloudflare Workers cache. */
  cacheControl: GatewayCacheResolver<Env, string>;
  /** Optional custom Cloudflare cache key. Return `undefined` to use default keying. */
  cacheKey?: GatewayCacheResolver<Env, string | undefined>;
  /** Methods eligible for caching. Defaults to `["GET", "HEAD"]`. */
  methods?: readonly GatewayCacheMethod[];
};

/** Gateway-wide cache configuration inherited by services unless overridden. */
export type GatewayCacheOptions<Env> = {
  /** Enables or disables Cloudflare Workers cache forwarding for this gateway. */
  enabled: boolean;
  /** Default downstream cache policy for services with `cache: true`. */
  default?: GatewayDownstreamCachePolicy<Env>;
};

/**
 * Registers a downstream Worker service binding under a public gateway mount.
 *
 * The gateway forwards requests to `env[binding].fetch(...)`, injects the
 * private `x-gmode-context` header, and enforces auth/scopes before forwarding.
 */
export type GatewayServiceConfig<Env, Binding extends keyof Env & string> = {
  /** Public path prefix handled by this service. Must start with `/`. */
  mount: `/${string}`;
  /** Name of the Worker service binding in the gateway `Env` type. */
  binding: Binding;
  /** Audience value encoded into the private gateway context for this service. */
  audience?: string;
  /** Strip `mount` from the forwarded URL path. Defaults to `true`. */
  stripPrefix?: boolean;
  /** Whether this service requires an authenticated gateway auth context. */
  auth?: boolean;
  /** Scopes required before forwarding to this service. Supports `foo:*`. */
  scopes?: string[];
  /** Permissions required before forwarding to this service. Supports `foo:*`. */
  permissions?: string[];
  /** Include this service's internal OpenAPI document in gateway aggregation. */
  openapi?:
    | boolean
    | {
        /** Internal OpenAPI path on the downstream service. Defaults to `/internal/openapi.json`. */
        path?: string;
      };
  /** Static headers added to every forwarded request for this service. */
  headers?: Record<string, string>;
  /** Override gateway cache inheritance for this service. */
  cache?: boolean | GatewayDownstreamCachePolicy<Env>;
};

/**
 * Registers a full web application Worker (TanStack Start, Vite SPA, any
 * framework served by a Worker) under a public gateway mount.
 *
 * Web forwarding differs from service forwarding:
 * - `stripPrefix` defaults to `false` — the framework owns its base path.
 * - `auth` defaults to `false` — pages are public unless opted in.
 * - Responses (HTML, streamed SSR, WebSocket upgrades) pass through untouched.
 * - When `dev.url` resolves (injected by `gmode dev`), requests are proxied
 *   to the local Vite dev server instead of the Service Binding, preserving HMR.
 */
export type GatewayWebConfig<Env, Binding extends keyof Env & string> = {
  /** Public path prefix handled by this web app. Must start with `/`. */
  mount: `/${string}`;
  /** Name of the Worker service binding in the gateway `Env` type. */
  binding: Binding;
  /** Strip `mount` from the forwarded URL path. Defaults to `false` for web apps. */
  stripPrefix?: boolean;
  /** Whether this app requires an authenticated gateway auth context. Defaults to `false`. */
  auth?: boolean;
  /** Scopes required before forwarding. */
  scopes?: string[];
  /** Permissions required before forwarding. */
  permissions?: string[];
  /** Audience encoded into the private gateway context. Defaults to the app name. */
  audience?: string;
  /**
   * Embedded API surface served by the app (via `withGmode()` / `createWebApp()`
   * from `@gmode/web`). When `openapi` is enabled, the app's API routes are
   * aggregated into the gateway OpenAPI document under `mount + api.mount`.
   */
  api?: {
    /** API mount inside the app, relative to the app mount. Defaults to `/api`. */
    mount?: `/${string}`;
    /** Aggregate the app's API routes into gateway OpenAPI. Defaults to `true`. */
    openapi?: boolean;
  };
  /**
   * Dev-mode proxy target. When the resolver returns a URL (set by `gmode dev`
   * via an env var), the gateway forwards to it with plain `fetch()` instead
   * of the Service Binding so Vite HMR keeps working.
   */
  dev?: {
    url?: (env: Env) => string | undefined;
  };
  /** Static headers added to every forwarded request for this app. */
  headers?: Record<string, string>;
};

/** Resolved web-specific metadata stored on a gateway entry. */
export type GatewayWebEntryInfo<Env> = {
  /** API mount inside the app, relative to the app mount. */
  apiMount: `/${string}`;
  /** Whether the app's API routes join OpenAPI aggregation. */
  openapi: boolean;
  /** Dev proxy URL resolver. */
  devUrl?: (env: Env) => string | undefined;
};

/** Metadata rendered into OpenAPI for a deprecated API version. */
export type GatewayApiVersionDeprecation = {
  /** RFC 8594 sunset date value. */
  sunset?: string;
  /** Optional documentation or migration link. */
  link?: string;
  /** Human-readable deprecation message. */
  message?: string;
};

/** A versioned namespace that can register its own services under a prefix. */
export type GatewayApiVersion = {
  /** Version label, for example `"v1"` or `"2026-07-01"`. */
  name: string;
  /** Public path prefix for this version. Must start with `/`. */
  prefix: `/${string}`;
  /** Marks this version deprecated, optionally with OpenAPI metadata. */
  deprecated?: boolean | GatewayApiVersionDeprecation;
};

export type RegisteredGatewayServiceConfig<Env> =
  GatewayServiceConfig<Env, keyof Env & string>;

export type GatewayServiceEntry<Env> = {
  /** Stable service name used in docs, telemetry, and MCP operation IDs. */
  name: string;
  /** Registered gateway forwarding configuration. */
  config: RegisteredGatewayServiceConfig<Env>;
  /** API version namespace if the service was registered through `apiVersion()`. */
  apiVersion?: GatewayApiVersion;
  /** Entry kind. Defaults to `"service"`. */
  kind?: "service" | "web";
  /** Web-specific metadata when `kind` is `"web"`. */
  web?: GatewayWebEntryInfo<Env>;
};

/** Top-level options passed to `createGateway()`. */
export type GatewayOptions<Env> = {
  /** Display name used in generated OpenAPI and docs UI. */
  name: string;
  /** Gateway version used in generated OpenAPI and docs UI. */
  version: string;
  /** Optional public base path prepended to docs and service matching. */
  basePath?: string;
  /** Built-in docs and OpenAPI route configuration. */
  docs?: {
    /** Path for the aggregated OpenAPI JSON document. Defaults to `/openapi.json`. */
    openapi?: string;
    /** Path for Swagger UI. Defaults to `/docs`. */
    swagger?: string;
    /** Path for Scalar UI. Set `null` to disable Scalar. */
    scalar?: string | null;
    /** Default docs UI linked from the gateway index. Defaults to `"swagger"`. */
    ui?: "swagger" | "scalar";
    /**
     * Path that serves an HTML landing page with links to the swagger UI,
     * the OpenAPI spec, and the registered services. Defaults to `"/"`.
     * Set to `null` (or an empty string) to disable; the gateway will then
     * 404 on `/` like any other unmatched path. The landing page only fires
     * when no service mount matches, so a root-mounted service still wins.
     */
    index?: string | null;
    /**
     * How long, in seconds, the aggregated OpenAPI document is cached per
     * isolate before service specs are re-fetched. Defaults to `60`.
     * Set to `0` to disable caching. Clients can bypass with `?refresh=1`.
     */
    openapiCacheTtlSeconds?: number;
  };
  /** Internal gateway context settings used only for private service-bound requests. */
  internal?: {
    /** Lifetime, in seconds, of the private gateway context header. Defaults to `60`. */
    tokenTtlSeconds?: number;
    /**
     * HMAC signing of the private gateway context header.
     *
     * By default the gateway signs when `env.GMODE_CONTEXT_SECRET` is set and
     * sends unsigned tokens otherwise. Pass `false` to always send unsigned,
     * or `{ secret }` to resolve the shared secret from a different binding.
     */
    signing?:
      | false
      | {
          /** Resolve the shared HMAC secret from env bindings. */
          secret: (env: Env) => string | undefined;
        };
  };
  /** Gateway-level Workers cache configuration inherited by services. */
  cache?: GatewayCacheOptions<Env>;
  /** Defaults applied to services unless each service overrides them. */
  defaults?: {
    /** Whether services require auth by default. Defaults to `false`. */
    auth?: boolean;
    /** Scopes required by default before forwarding. */
    scopes?: string[];
    /** Permissions required by default before forwarding. */
    permissions?: string[];
    /** Public request id header name. Defaults to `x-request-id`. */
    requestIdHeader?: string;
  };
};

/** Mutable per-request state passed through every gateway middleware. */
export type GatewayRequestContext<Env> = {
  /** Original incoming request. */
  request: Request;
  /** Cloudflare Worker environment bindings. */
  env: Env;
  /** Cloudflare Worker execution context. */
  executionContext: ExecutionContext;
  /** Parsed request URL. */
  url: URL;
  /** Correlation id set by `requestId()` or generated by the gateway. */
  requestId: string;
  /** Current authenticated identity, scopes, permissions, and raw auth payload. */
  auth: AuthContext;
  /** Shared state map for middleware and framework integrations. */
  state: Map<string, unknown>;
  /** Service matched by routing, when known. */
  matchedService?: {
    name: string;
    mount: string;
    /** `"web"` for full web apps that must return responses untouched. */
    kind?: "service" | "web";
  };
  /** Feature flag client attached by `featureFlags()`, when configured. */
  flags?: FlagsClient;
};

/**
 * Gateway middleware function.
 *
 * Call `next()` exactly once to continue the chain. Throw `ApiError` for
 * structured JSON errors when `jsonErrors()` is installed.
 */
export type GatewayMiddleware<Env> = (
  context: GatewayRequestContext<Env>,
  next: () => Promise<Response>,
) => Promise<Response>;

/** Runtime object returned by `createGateway()`. Export it as the Worker default. */
export interface Gateway<Env> {
  readonly name: string;
  readonly version: string;

  /** Register middleware in execution order. */
  use(middleware: GatewayMiddleware<Env>): Gateway<Env>;

  /** Register a downstream Worker service binding under a public mount. */
  service<Binding extends keyof Env & string>(
    name: string,
    config: GatewayServiceConfig<Env, Binding>,
  ): Gateway<Env>;

  /** Register a full web application Worker under a public mount. */
  web<Binding extends keyof Env & string>(
    name: string,
    config: GatewayWebConfig<Env, Binding>,
  ): Gateway<Env>;

  /** Create a versioned service registration scope. */
  apiVersion(version: GatewayApiVersion): GatewayVersion<Env>;

  /** Cloudflare Worker `fetch` handler. */
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

/** Versioned gateway scope returned by `gateway.apiVersion(...)`. */
export interface GatewayVersion<Env> {
  readonly name: string;
  readonly prefix: `/${string}`;

  /** Register a service under this version prefix. */
  service<Binding extends keyof Env & string>(
    name: string,
    config: GatewayServiceConfig<Env, Binding>,
  ): GatewayVersion<Env>;
}

export type ResolvedGatewayDefaults = {
  auth: boolean;
  scopes: string[];
  permissions: string[];
  requestIdHeader: string;
  openapiPath: string;
  swaggerPath: string;
  scalarPath: string | null;
  docsUi: "swagger" | "scalar";
  indexPath: string | null;
  tokenTtlSeconds: number;
  basePath: string;
  openapiCacheTtlSeconds: number;
};

export type GatewayInternals<Env> = {
  options: GatewayOptions<Env>;
  defaults: ResolvedGatewayDefaults;
  middleware: GatewayMiddleware<Env>[];
  services: GatewayServiceEntry<Env>[];
  /** Per-isolate cache of the aggregated OpenAPI document. */
  openapiCache?: { doc: unknown; expiresAt: number };
};
