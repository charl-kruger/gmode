import {
  ApiError,
  ApiErrorSchema,
  GMODE_HEADERS,
  PUBLIC_REQUEST_ID_HEADER,
  accepted,
  buildFlagshipContext,
  createFlagsClient,
  created,
  error as errorFactory,
  json,
  matchesAllScopes,
  noContent,
  ok,
  paginated,
  resolveEnvValue,
  serializeError,
  type FlagsClient,
  type FlagshipBinding,
  type GatewayContext,
} from "@gmode/core";
import { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import { verifyServiceGatewayContext } from "./gateway-context";
import { buildServiceOpenApi } from "./openapi";
import { parseSchema } from "./schema";
import type {
  FeatureFlagGate,
  HttpVerb,
  RegisteredRoute,
  RouteConfig,
  RouteHandlerContext,
  Service,
  ServiceOptions,
} from "./types";

type ServiceEnv<Env> = {
  Bindings: Env extends Record<string, unknown> ? Env : Record<string, unknown>;
  Variables: {
    gmodeGateway: GatewayContext | undefined;
  };
};

function anonymousGatewayContext(audience: string): GatewayContext {
  return {
    iss: "gmode-gateway",
    aud: audience,
    requestId: "anonymous",
    authenticated: false,
    scopes: [],
    permissions: [],
    issuedAt: 0,
    expiresAt: 0,
  };
}

function authorizeForRoute(
  config: RouteConfig<unknown>,
  scopes: string[],
  permissions: string[],
): void {
  if (
    config.scopes &&
    config.scopes.length > 0 &&
    !matchesAllScopes(config.scopes, scopes)
  ) {
    throw new ApiError({
      code: "INSUFFICIENT_SCOPE",
      message: "Insufficient scope",
      status: 403,
      details: { required: config.scopes },
    });
  }
  if (
    config.permissions &&
    config.permissions.length > 0 &&
    !matchesAllScopes(config.permissions, permissions)
  ) {
    throw new ApiError({
      code: "INSUFFICIENT_PERMISSION",
      message: "Insufficient permission",
      status: 403,
      details: { required: config.permissions },
    });
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function queryToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const seen = new Set<string>();
  url.searchParams.forEach((_value, key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const values = url.searchParams.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? "");
  });
  return out;
}

async function readJsonBody(
  request: Request,
  hasBodySchema: boolean,
): Promise<unknown> {
  const method = request.method.toUpperCase();
  const expectsBody = ["POST", "PUT", "PATCH"].includes(method);
  if (!hasBodySchema || !expectsBody) {
    return undefined;
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const isJson =
    contentType.includes("application/json") || /\+json/.test(contentType);
  if (!isJson) {
    throw new ApiError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json",
      status: 415,
    });
  }
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError({
      code: "INVALID_JSON",
      message: "Request body is not valid JSON",
      status: 400,
    });
  }
}

function normalizeHandlerResponse(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value === undefined) return noContent();
  return ok(value);
}

function normalizeFeatureFlag(
  gate: FeatureFlagGate,
): { key: string; default: boolean; behavior: "404" | "403" } {
  if (typeof gate === "string") {
    return { key: gate, default: false, behavior: "404" };
  }
  return {
    key: gate.key,
    default: gate.default ?? false,
    behavior: gate.behavior ?? "404",
  };
}

function gateError(behavior: "404" | "403"): ApiError {
  if (behavior === "403") {
    return new ApiError({
      code: "FEATURE_NOT_AVAILABLE",
      message: "Feature not available",
      status: 403,
    });
  }
  return new ApiError({
    code: "NOT_FOUND",
    message: "Not found",
    status: 404,
  });
}

async function evaluateGate(
  gate: ReturnType<typeof normalizeFeatureFlag>,
  flags: FlagsClient | undefined,
  gatewayFlags: Record<string, unknown> | undefined,
): Promise<boolean> {
  if (flags) {
    return flags.getBooleanValue(gate.key, gate.default);
  }
  if (gatewayFlags && gate.key in gatewayFlags) {
    const value = gatewayFlags[gate.key];
    return typeof value === "boolean" ? value : gate.default;
  }
  return gate.default;
}

export class ServiceImpl<Env> implements Service<Env> {
  readonly name: string;
  readonly version: string;
  readonly ok = ok;
  readonly created = created;
  readonly accepted = accepted;
  readonly noContent = noContent;
  readonly paginated = paginated;
  readonly error = errorFactory;
  readonly errors = { schema: ApiErrorSchema };

  private readonly options: ServiceOptions<Env>;
  private readonly app: Hono<ServiceEnv<Env>>;
  private readonly routes: RegisteredRoute<Env>[] = [];
  private readonly internalOpenapiPath: string;

  constructor(options: ServiceOptions<Env>) {
    this.options = options;
    this.name = options.name;
    this.version = options.version;
    this.internalOpenapiPath =
      options.docs?.internalOpenapi ?? "/__gmode/openapi.json";

    this.app = new Hono<ServiceEnv<Env>>();

    this.app.onError((err, c) => {
      const requestId =
        c.req.header(GMODE_HEADERS.requestId) ??
        c.req.header(PUBLIC_REQUEST_ID_HEADER) ??
        undefined;
      const { status, body } = serializeError({ err, requestId });
      return c.json(body, status as 400);
    });

    this.app.get(this.internalOpenapiPath, (c) => {
      const doc = buildServiceOpenApi({
        name: this.name,
        version: this.version,
        routes: this.routes,
      });
      return c.json(doc);
    });

    this.fetch = this.fetch.bind(this);
  }

  private register(
    method: HttpVerb,
    path: string,
    config: RouteConfig<Env>,
  ): Service<Env> {
    this.routes.push({ method, path, config });

    const handler = async (c: HonoContext<ServiceEnv<Env>>): Promise<Response> => {
      const request = c.req.raw;
      const url = new URL(request.url);

      const state = await verifyServiceGatewayContext({
        request,
        env: c.env as Env,
        options: this.options.trustGateway,
      });

      const gatewayContext: GatewayContext =
        state.context ??
        anonymousGatewayContext(
          this.options.trustGateway?.audience ?? this.name,
        );

      authorizeForRoute(
        config as RouteConfig<unknown>,
        gatewayContext.scopes,
        gatewayContext.permissions,
      );

      let flagsClient: FlagsClient | undefined;
      if (this.options.flags) {
        const binding = resolveEnvValue(
          this.options.flags.binding,
          c.env as Env,
        ) as FlagshipBinding;
        const evalContext = this.options.flags.contextBuilder
          ? this.options.flags.contextBuilder({
              gateway: gatewayContext,
              env: c.env as Env,
            })
          : buildFlagshipContext({
              auth: {
                authenticated: gatewayContext.authenticated,
                ...(gatewayContext.user ? { user: gatewayContext.user } : {}),
                ...(gatewayContext.tenant
                  ? { tenant: gatewayContext.tenant }
                  : {}),
                scopes: gatewayContext.scopes,
                permissions: gatewayContext.permissions,
              },
              requestId: gatewayContext.requestId,
            });
        flagsClient = createFlagsClient(binding, evalContext);
      }

      if (config.featureFlag) {
        const gate = normalizeFeatureFlag(config.featureFlag);
        const enabled = await evaluateGate(
          gate,
          flagsClient,
          gatewayContext.flags,
        );
        if (!enabled) {
          throw gateError(gate.behavior);
        }
      }

      const rawParams = c.req.param() as Record<string, string>;
      const params = config.params
        ? ((await parseSchema(config.params, rawParams)) as Record<
            string,
            string
          >)
        : rawParams;

      const rawQuery = queryToObject(url);
      const query = config.query
        ? ((await parseSchema(config.query, rawQuery)) as Record<
            string,
            unknown
          >)
        : (rawQuery as Record<string, unknown>);

      const rawHeaders = headersToObject(request.headers);
      const headers = config.headers
        ? ((await parseSchema(config.headers, rawHeaders)) as Record<
            string,
            unknown
          >)
        : (rawHeaders as Record<string, unknown>);

      const rawBody = await readJsonBody(request, !!config.body);
      const body = config.body
        ? await parseSchema(config.body, rawBody)
        : rawBody;

      const handlerContext: RouteHandlerContext<Env> = {
        request,
        env: c.env as Env,
        executionContext: c.executionCtx as ExecutionContext,
        params,
        query,
        headers,
        body,
        gateway: gatewayContext,
        scopes: gatewayContext.scopes,
        permissions: gatewayContext.permissions,
        requestId: gatewayContext.requestId,
        ok,
        created,
        accepted,
        noContent,
        paginated,
        error: errorFactory,
      };
      if (gatewayContext.user) handlerContext.user = gatewayContext.user;
      if (gatewayContext.tenant) handlerContext.tenant = gatewayContext.tenant;
      if (flagsClient) handlerContext.flags = flagsClient;

      const result = await config.handler(handlerContext);
      return normalizeHandlerResponse(result);
    };

    switch (method) {
      case "get":
        this.app.get(path, handler);
        break;
      case "post":
        this.app.post(path, handler);
        break;
      case "put":
        this.app.put(path, handler);
        break;
      case "patch":
        this.app.patch(path, handler);
        break;
      case "delete":
        this.app.delete(path, handler);
        break;
    }

    return this;
  }

  get<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env> {
    return this.register("get", path, config);
  }
  post<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env> {
    return this.register("post", path, config);
  }
  put<Path extends string>(path: Path, config: RouteConfig<Env>): Service<Env> {
    return this.register("put", path, config);
  }
  patch<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env> {
    return this.register("patch", path, config);
  }
  delete<Path extends string>(
    path: Path,
    config: RouteConfig<Env>,
  ): Service<Env> {
    return this.register("delete", path, config);
  }

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return this.app.fetch(request, env as Record<string, unknown>, ctx);
  }
}
