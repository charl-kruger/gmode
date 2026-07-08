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

export type ServiceFlagsOptions<Env> = {
  binding: EnvResolver<Env, FlagshipBinding>;
  contextBuilder?: (input: {
    gateway: GatewayContext;
    env: Env;
  }) => FlagshipEvaluationContext;
};

export type ServiceOptions<Env> = {
  name: string;
  version: string;
  basePath?: string;
  trustGateway?: {
    signingSecret: EnvResolver<Env, string>;
    audience: string;
    required?: boolean;
  };
  docs?: {
    internalOpenapi?: string;
  };
  flags?: ServiceFlagsOptions<Env>;
};

export type RouteHandlerContext<Env> = {
  request: Request;
  env: Env;
  executionContext: ExecutionContext;

  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: unknown;

  gateway: GatewayContext;
  user?: GModeUser;
  tenant?: GModeTenant;
  scopes: string[];
  permissions: string[];
  requestId: string;
  flags?: FlagsClient;

  ok: typeof ok;
  created: typeof created;
  accepted: typeof accepted;
  noContent: typeof noContent;
  paginated: typeof paginated;
  error: typeof errorFactory;
};

export type FeatureFlagGate =
  | string
  | {
      key: string;
      default?: boolean;
      behavior?: "404" | "403";
    };

export type RouteConfig<Env> = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];

  scopes?: string[];
  permissions?: string[];

  featureFlag?: FeatureFlagGate;

  sensitiveFields?: string[];

  shieldAction?: ShieldSchemaAction;

  params?: GModeSchema;
  query?: GModeSchema;
  headers?: GModeSchema;
  body?: GModeSchema;

  responses: Record<number, GModeSchema>;

  handler: (
    context: RouteHandlerContext<Env>,
  ) => MaybePromise<Response | unknown>;
};

export type HttpVerb = "get" | "post" | "put" | "patch" | "delete";

export type RegisteredRoute<Env> = {
  method: HttpVerb;
  path: string;
  config: RouteConfig<Env>;
};

export interface Service<Env> {
  readonly name: string;
  readonly version: string;

  get<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env>;
  post<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env>;
  put<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env>;
  patch<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env>;
  delete<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env>;

  ok: typeof ok;
  created: typeof created;
  accepted: typeof accepted;
  noContent: typeof noContent;
  paginated: typeof paginated;
  error: typeof errorFactory;
  errors: { schema: typeof ApiErrorSchema };

  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}
