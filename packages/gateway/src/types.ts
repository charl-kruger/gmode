import type { AuthContext, FlagsClient } from "@gmode/core";

export type { FetcherLike, GatewayContext } from "@gmode/core";

export type GatewayCacheMethod = "GET" | "HEAD";

export type GatewayCacheResolver<Env, T> =
  | T
  | ((context: GatewayRequestContext<Env>) => T);

export type GatewayDownstreamCachePolicy<Env> = {
  cacheControl: GatewayCacheResolver<Env, string>;
  cacheKey?: GatewayCacheResolver<Env, string | undefined>;
  methods?: readonly GatewayCacheMethod[];
};

export type GatewayCacheOptions<Env> = {
  enabled: boolean;
  default?: GatewayDownstreamCachePolicy<Env>;
};

export type GatewayServiceConfig<Env, Binding extends keyof Env & string> = {
  mount: `/${string}`;
  binding: Binding;
  audience?: string;
  stripPrefix?: boolean;
  auth?: boolean;
  scopes?: string[];
  permissions?: string[];
  openapi?:
    | boolean
    | {
        path?: string;
      };
  headers?: Record<string, string>;
  cache?: boolean | GatewayDownstreamCachePolicy<Env>;
};

export type GatewayApiVersionDeprecation = {
  sunset?: string;
  link?: string;
  message?: string;
};

export type GatewayApiVersion = {
  name: string;
  prefix: `/${string}`;
  deprecated?: boolean | GatewayApiVersionDeprecation;
};

export type RegisteredGatewayServiceConfig<Env> =
  GatewayServiceConfig<Env, keyof Env & string>;

export type GatewayServiceEntry<Env> = {
  name: string;
  config: RegisteredGatewayServiceConfig<Env>;
  apiVersion?: GatewayApiVersion;
};

export type GatewayOptions<Env> = {
  name: string;
  version: string;
  basePath?: string;
  docs?: {
    openapi?: string;
    swagger?: string;
    scalar?: string | null;
    ui?: "swagger" | "scalar";
    /**
     * Path that serves an HTML landing page with links to the swagger UI,
     * the OpenAPI spec, and the registered services. Defaults to `"/"`.
     * Set to `null` (or an empty string) to disable; the gateway will then
     * 404 on `/` like any other unmatched path. The landing page only fires
     * when no service mount matches, so a root-mounted service still wins.
     */
    index?: string | null;
  };
  internal?: {
    tokenTtlSeconds?: number;
  };
  cache?: GatewayCacheOptions<Env>;
  defaults?: {
    auth?: boolean;
    scopes?: string[];
    permissions?: string[];
    requestIdHeader?: string;
  };
};

export type GatewayRequestContext<Env> = {
  request: Request;
  env: Env;
  executionContext: ExecutionContext;
  url: URL;
  requestId: string;
  auth: AuthContext;
  state: Map<string, unknown>;
  matchedService?: {
    name: string;
    mount: string;
  };
  flags?: FlagsClient;
};

export type GatewayMiddleware<Env> = (
  context: GatewayRequestContext<Env>,
  next: () => Promise<Response>,
) => Promise<Response>;

export interface Gateway<Env> {
  readonly name: string;
  readonly version: string;

  use(middleware: GatewayMiddleware<Env>): Gateway<Env>;

  service<Binding extends keyof Env & string>(
    name: string,
    config: GatewayServiceConfig<Env, Binding>,
  ): Gateway<Env>;

  apiVersion(version: GatewayApiVersion): GatewayVersion<Env>;

  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

export interface GatewayVersion<Env> {
  readonly name: string;
  readonly prefix: `/${string}`;

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
};

export type GatewayInternals<Env> = {
  options: GatewayOptions<Env>;
  defaults: ResolvedGatewayDefaults;
  middleware: GatewayMiddleware<Env>[];
  services: GatewayServiceEntry<Env>[];
};
