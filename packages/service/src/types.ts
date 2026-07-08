import type {
  GModeTenant,
  GModeUser,
  EnvResolver,
  FlagshipBinding,
  FlagshipEvaluationContext,
  FlagsClient,
  GatewayContext,
  MaybePromise,
  ShieldSchemaAction,
} from "@gmode/core";
import type {
  accepted,
  created,
  noContent,
  ok,
  paginated,
  error as errorFactory,
  ApiErrorSchema,
} from "@gmode/core";
import type { GModeSchema } from "./schema";

/** Flagship configuration for a downstream service. */
export type ServiceFlagsOptions<Env> = {
  /** Flagship binding or env resolver. */
  binding: EnvResolver<Env, FlagshipBinding>;
  /** Override the default evaluation context built from gateway auth. */
  contextBuilder?: (input: {
    gateway: GatewayContext;
    env: Env;
  }) => FlagshipEvaluationContext;
};

/** Options passed to `createService()`. */
export type ServiceOptions<Env> = {
  /** Service name used in generated OpenAPI and gateway docs. */
  name: string;
  /** Service version used in generated OpenAPI. */
  version: string;
  /** Optional base path for routes inside this service. */
  basePath?: string;
  /**
   * Decode and require the private gateway context header.
   *
   * This is intended for private Workers reached through Service Bindings. The
   * `audience` must match the gateway service config.
   */
  trustGateway?: {
    /** Expected gateway context audience for this service. */
    audience: string;
    /** Whether the header is required. Defaults to `true`. */
    required?: boolean;
  };
  /** Internal documentation route settings. */
  docs?: {
    /** Path for this service's internal OpenAPI document. Defaults to `/internal/openapi.json`. */
    internalOpenapi?: string;
  };
  /** Optional Flagship binding used by route feature gates and handlers. */
  flags?: ServiceFlagsOptions<Env>;
};

/** Context object passed to every service route handler. */
export type RouteHandlerContext<Env> = {
  /** Original request received by this service Worker. */
  request: Request;
  /** Cloudflare Worker env bindings. */
  env: Env;
  /** Cloudflare Worker execution context. */
  executionContext: ExecutionContext;

  /** Validated path parameters. */
  params: Record<string, string>;
  /** Validated query values. */
  query: Record<string, unknown>;
  /** Validated header values. */
  headers: Record<string, unknown>;
  /** Validated request body, when configured. */
  body: unknown;

  /** Private context forwarded by the gateway. */
  gateway: GatewayContext;
  /** Authenticated user forwarded by the gateway, when present. */
  user?: GModeUser;
  /** Tenant forwarded by the gateway, when present. */
  tenant?: GModeTenant;
  /** Scopes forwarded by the gateway. */
  scopes: string[];
  /** Permissions forwarded by the gateway. */
  permissions: string[];
  /** Request id forwarded by the gateway. */
  requestId: string;
  /** Flagship client, when service flags are configured. */
  flags?: FlagsClient;

  /** Return a JSON `200 OK` response. */
  ok: typeof ok;
  /** Return a JSON `201 Created` response. */
  created: typeof created;
  /** Return a JSON `202 Accepted` response. */
  accepted: typeof accepted;
  /** Return a `204 No Content` response. */
  noContent: typeof noContent;
  /** Return a paginated JSON response. */
  paginated: typeof paginated;
  /** Factory for structured `ApiError` instances. */
  error: typeof errorFactory;
};

/** Feature flag guard for a route. */
export type FeatureFlagGate =
  | string
  | {
    /** Flagship boolean flag key. */
    key: string;
    /** Default value passed to Flagship. Defaults to `false`. */
    default?: boolean;
    /** Error behavior when the flag is off. Defaults to `404`. */
    behavior?: "404" | "403";
  };

/** Route definition passed to `service.get/post/put/patch/delete`. */
export type RouteConfig<Env> = {
  /** Stable OpenAPI operation id. Generated when omitted. */
  operationId?: string;
  /** Short OpenAPI summary. */
  summary?: string;
  /** Longer OpenAPI description. */
  description?: string;
  /** OpenAPI tags for grouping operations. */
  tags?: string[];

  /** Scopes required from the gateway context before the handler runs. */
  scopes?: string[];
  /** Permissions required from the gateway context before the handler runs. */
  permissions?: string[];

  /** Optional Flagship guard evaluated before the handler runs. */
  featureFlag?: FeatureFlagGate;

  /** Dot paths redacted when producing API Shield-compatible schemas. */
  sensitiveFields?: string[];

  /** API Shield schema action for generated OpenAPI metadata. */
  shieldAction?: ShieldSchemaAction;

  /** Schema for path params. */
  params?: GModeSchema;
  /** Schema for query params. */
  query?: GModeSchema;
  /** Schema for request headers. */
  headers?: GModeSchema;
  /** Schema for JSON request body. */
  body?: GModeSchema;

  /** Response schemas keyed by HTTP status code. Used for OpenAPI and docs. */
  responses: Record<number, GModeSchema>;

  /** Handler called after gateway context, authz, feature flags, and validation. */
  handler: (
    context: RouteHandlerContext<Env>,
  ) => MaybePromise<Response | unknown>;
};

/** HTTP verbs supported by the service router. */
export type HttpVerb = "get" | "post" | "put" | "patch" | "delete";

/** Internal route registry entry. Mostly useful for framework integrations. */
export type RegisteredRoute<Env> = {
  method: HttpVerb;
  path: string;
  config: RouteConfig<Env>;
};

/** Runtime service object returned by `createService()`. */
export interface Service<Env> {
  readonly name: string;
  readonly version: string;

  /** Register a GET route. */
  get<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env>;
  /** Register a POST route. */
  post<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env>;
  /** Register a PUT route. */
  put<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env>;
  /** Register a PATCH route. */
  patch<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env>;
  /** Register a DELETE route. */
  delete<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env>;

  /** JSON `200 OK` response helper. */
  ok: typeof ok;
  /** JSON `201 Created` response helper. */
  created: typeof created;
  /** JSON `202 Accepted` response helper. */
  accepted: typeof accepted;
  /** `204 No Content` response helper. */
  noContent: typeof noContent;
  /** Paginated response helper. */
  paginated: typeof paginated;
  /** Structured API error factory. */
  error: typeof errorFactory;
  /** Common response schemas, including the standard error schema. */
  errors: { schema: typeof ApiErrorSchema };

  /** Cloudflare Worker `fetch` handler. */
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}
