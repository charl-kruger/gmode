import {
  ApiError,
  GMODE_HEADERS,
  PUBLIC_REQUEST_ID_HEADER,
  json,
  serializeError,
  toShieldCompatibleSpec,
  type AuthContext,
  type GatewayContext,
} from "@gmode/core";
import {
  GATEWAY_INTERNALS_STATE_KEY,
  authorizeForService,
  type AnyServiceConfig,
} from "./authorize";
import { forwardToService } from "./forward";
import {
  gatewayIndexHtml,
  type GatewayIndexFlagsInfo,
  type GatewayIndexMcpInfo,
} from "./gateway-index";
import {
  FLAGS_BINDING_MISSING_STATE_KEY,
  FLAGS_BINDING_NAME_STATE_KEY,
  FLAGS_GATES_STATE_KEY,
  FORWARDED_FLAGS_STATE_KEY,
} from "./middleware/feature-flags";
import {
  aggregateOpenApi,
  scalarUiHtml,
  swaggerUiHtml,
} from "./openapi-aggregate";
import {
  buildInternalUrl,
  matchService,
  validateMount,
} from "./route-matcher";
import type { ForwardCachePolicy } from "./forward";
import type {
  GatewayCacheMethod,
  GatewayDownstreamCachePolicy,
  GatewayApiVersion,
  Gateway,
  GatewayInternals,
  GatewayMiddleware,
  GatewayOptions,
  GatewayRequestContext,
  GatewayServiceConfig,
  GatewayServiceEntry,
  GatewayVersion,
  ResolvedGatewayDefaults,
} from "./types";

const CACHEABLE_METHODS: readonly GatewayCacheMethod[] = ["GET", "HEAD"];

function buildDefaults<Env>(
  options: GatewayOptions<Env>,
): ResolvedGatewayDefaults {
  const rawIndex = options.docs?.index;
  const docsUi = options.docs?.ui ?? "swagger";
  const scalarPath = options.docs?.scalar === null
    ? null
    : options.docs?.scalar ?? (docsUi === "scalar" ? "/scalar" : null);
  const indexPath: string | null =
    rawIndex === null || rawIndex === ""
      ? null
      : rawIndex ?? "/";
  return {
    auth: options.defaults?.auth ?? false,
    scopes: options.defaults?.scopes ?? [],
    permissions: options.defaults?.permissions ?? [],
    requestIdHeader: options.defaults?.requestIdHeader ?? PUBLIC_REQUEST_ID_HEADER,
    openapiPath: options.docs?.openapi ?? "/openapi.json",
    swaggerPath: options.docs?.swagger ?? "/docs",
    scalarPath,
    docsUi,
    indexPath,
    tokenTtlSeconds: options.internal?.tokenTtlSeconds ?? 60,
    basePath: options.basePath ?? "",
  };
}

function emptyAuth(): AuthContext {
  return {
    authenticated: false,
    scopes: [],
    permissions: [],
  };
}

function buildGatewayContext<Env>(
  context: GatewayRequestContext<Env>,
  audience: string,
  ttlSeconds: number,
): GatewayContext {
  const now = Math.floor(Date.now() / 1000);
  const out: GatewayContext = {
    iss: "gmode-gateway",
    aud: audience,
    requestId: context.requestId,
    authenticated: context.auth.authenticated,
    scopes: context.auth.scopes,
    permissions: context.auth.permissions,
    issuedAt: now,
    expiresAt: now + ttlSeconds,
  };
  if (context.auth.user) out.user = context.auth.user;
  if (context.auth.tenant) out.tenant = context.auth.tenant;
  const forwarded = context.state.get(FORWARDED_FLAGS_STATE_KEY);
  if (
    forwarded &&
    typeof forwarded === "object" &&
    Object.keys(forwarded as Record<string, unknown>).length > 0
  ) {
    out.flags = forwarded as Record<string, unknown>;
  }
  return out;
}

function joinMount(prefix: `/${string}`, mount: `/${string}`): `/${string}` {
  const normalizedPrefix = prefix === "/"
    ? ""
    : prefix.endsWith("/")
      ? prefix.slice(0, -1)
      : prefix;
  const normalizedMount = mount === "/"
    ? ""
    : mount.startsWith("/")
      ? mount
      : `/${mount}`;
  const joined = `${normalizedPrefix}${normalizedMount}` || "/";
  return joined as `/${string}`;
}

function normalizeApiVersion(version: GatewayApiVersion): GatewayApiVersion {
  validateMount(version.prefix);
  return {
    ...version,
    prefix: joinMount(version.prefix, "/"),
  };
}

function deprecationHeaders(
  version: GatewayApiVersion | undefined,
): HeadersInit | undefined {
  if (!version?.deprecated) return undefined;

  const headers = new Headers();
  headers.set("Deprecation", "true");
  headers.set("x-gmode-api-version", version.name);

  if (typeof version.deprecated === "object") {
    if (version.deprecated.sunset) {
      headers.set("Sunset", version.deprecated.sunset);
    }
    if (version.deprecated.link) {
      headers.append(
        "Link",
        `<${version.deprecated.link}>; rel="deprecation"`,
      );
    }
    if (version.deprecated.message) {
      headers.set("x-gmode-deprecation-message", version.deprecated.message);
    }
  }

  return headers;
}

function withMutableHeaders(
  response: Response,
  extra: HeadersInit | undefined,
): Response {
  const headers = new Headers(response.headers);
  if (extra) {
    new Headers(extra).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function resolveGatewayCacheValue<Env, T>(
  value: T | ((context: GatewayRequestContext<Env>) => T),
  context: GatewayRequestContext<Env>,
): T {
  if (typeof value === "function") {
    return (value as (context: GatewayRequestContext<Env>) => T)(context);
  }
  return value;
}

function mergeCachePolicy<Env>(
  base: GatewayDownstreamCachePolicy<Env> | undefined,
  override: GatewayDownstreamCachePolicy<Env> | undefined,
): GatewayDownstreamCachePolicy<Env> | undefined {
  if (!base) return override;
  if (!override) return base;
  const methods = override.methods ?? base.methods;
  const merged = {
    ...base,
    ...override,
  };
  if (!methods) return merged;
  return {
    ...merged,
    methods,
  };
}

function resolveDownstreamCachePolicy<Env>(
  context: GatewayRequestContext<Env>,
  internals: GatewayInternals<Env>,
  service: GatewayServiceEntry<Env>,
): ForwardCachePolicy | undefined {
  const options = internals.options.cache;
  if (!options?.enabled) return undefined;

  const method = context.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return undefined;

  const serviceCache = service.config.cache;
  if (serviceCache === false) return undefined;

  const defaultPolicy = options.default;
  let policy: GatewayDownstreamCachePolicy<Env> | undefined;
  if (serviceCache === true) {
    if (!defaultPolicy) {
      throw new Error(
        `Service "${service.name}" enables cache inheritance but the gateway has no default cache policy`,
      );
    }
    policy = defaultPolicy;
  } else if (serviceCache && typeof serviceCache === "object") {
    policy = mergeCachePolicy(defaultPolicy, serviceCache);
  } else {
    policy = defaultPolicy;
  }

  if (!policy) return undefined;

  const allowedMethods = policy.methods ?? CACHEABLE_METHODS;
  if (!allowedMethods.includes(method as GatewayCacheMethod)) {
    return undefined;
  }

  const cacheControl = resolveGatewayCacheValue(
    policy.cacheControl,
    context,
  ).trim();
  if (!cacheControl) {
    throw new Error(`Service "${service.name}" resolved an empty cache policy`);
  }

  const cacheKey = policy.cacheKey
    ? resolveGatewayCacheValue(policy.cacheKey, context)
    : undefined;

  return cacheKey !== undefined
    ? { cacheControl, cacheKey }
    : { cacheControl };
}

async function handleRequest<Env>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  internals: GatewayInternals<Env>,
): Promise<Response> {
  const url = new URL(request.url);

  const context: GatewayRequestContext<Env> = {
    request,
    env,
    executionContext: ctx,
    url,
    requestId: "",
    auth: emptyAuth(),
    state: new Map(),
  };
  context.state.set(GATEWAY_INTERNALS_STATE_KEY, {
    services: internals.services,
    defaults: internals.defaults,
  });

  const middleware = internals.middleware;

  const dispatch = async (i: number): Promise<Response> => {
    if (i < middleware.length) {
      return middleware[i]!(context, () => dispatch(i + 1));
    }
    return route(context, internals);
  };

  try {
    if (!context.requestId) {
      context.requestId = crypto.randomUUID();
    }
    return await dispatch(0);
  } catch (err) {
    const { status, body } = serializeError({
      err,
      requestId: context.requestId,
    });
    return json(body, status, {
      [PUBLIC_REQUEST_ID_HEADER]: context.requestId,
    });
  }
}

async function route<Env>(
  context: GatewayRequestContext<Env>,
  internals: GatewayInternals<Env>,
): Promise<Response> {
  const pathname = context.url.pathname;
  const basePath = internals.defaults.basePath;
  const stripped = basePath && pathname.startsWith(basePath)
    ? pathname.slice(basePath.length) || "/"
    : pathname;

  if (stripped === internals.defaults.openapiPath) {
    const doc = await aggregateOpenApi({
      context,
      env: context.env,
      gateway: {
        name: internals.options.name,
        version: internals.options.version,
      },
      services: internals.services,
    });
    if (context.url.searchParams.get("profile") === "shield") {
      const { spec, warnings } = toShieldCompatibleSpec(doc);
      return json(spec, 200, {
        "x-gmode-shield-warnings": String(warnings.length),
      });
    }
    return json(doc);
  }

  if (stripped === internals.defaults.swaggerPath) {
    const html = swaggerUiHtml(
      basePath + internals.defaults.openapiPath,
      internals.options.name,
    );
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (
    internals.defaults.scalarPath &&
    stripped === internals.defaults.scalarPath
  ) {
    const html = scalarUiHtml(
      basePath + internals.defaults.openapiPath,
      internals.options.name,
    );
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (stripped === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  const match = matchService(stripped, internals.services);
  if (!match) {
    if (
      internals.defaults.indexPath &&
      stripped === internals.defaults.indexPath
    ) {
      let flagsInfo: GatewayIndexFlagsInfo | undefined;
      const bindingName = context.state.get(FLAGS_BINDING_NAME_STATE_KEY);
      const bindingMissing = context.state.get(
        FLAGS_BINDING_MISSING_STATE_KEY,
      );
      if (context.flags || typeof bindingName === "string") {
        flagsInfo = {};
        if (context.flags) {
          flagsInfo.evaluationContext = context.flags.context;
        }
        if (typeof bindingName === "string") {
          flagsInfo.bindingName = bindingName;
        }
        if (bindingMissing === true) {
          flagsInfo.bindingMissing = true;
        }
        const gates = context.state.get(FLAGS_GATES_STATE_KEY);
        if (gates && typeof gates === "object") {
          flagsInfo.gates = gates as Record<string, string>;
        }
        const forwarded = context.state.get(FORWARDED_FLAGS_STATE_KEY);
        if (forwarded && typeof forwarded === "object") {
          flagsInfo.forwarded = forwarded as Record<string, unknown>;
        }
      }
      // Read MCP info if `@gmode/mcp`'s middleware ran earlier in the
      // chain. Duck-typed so the gateway package doesn't depend on @gmode/mcp.
      let mcpInfo: GatewayIndexMcpInfo | undefined;
      const mcpRaw = context.state.get("gmode.mcp");
      if (mcpRaw && typeof mcpRaw === "object") {
        const m = mcpRaw as {
          path?: unknown;
          mode?: unknown;
          serverInfo?: { name?: unknown; version?: unknown; };
        };
        if (
          typeof m.path === "string" &&
          (m.mode === "catalog" || m.mode === "tools") &&
          m.serverInfo &&
          typeof m.serverInfo.name === "string" &&
          typeof m.serverInfo.version === "string"
        ) {
          mcpInfo = {
            path: m.path,
            mode: m.mode,
            serverInfo: {
              name: m.serverInfo.name,
              version: m.serverInfo.version,
            },
            origin: context.url.origin,
          };
        }
      }
      const html = gatewayIndexHtml({
        name: internals.options.name,
        version: internals.options.version,
        basePath,
        openapiPath: internals.defaults.openapiPath,
        swaggerPath: internals.defaults.swaggerPath,
        scalarPath: internals.defaults.scalarPath,
        docsUi: internals.defaults.docsUi,
        services: internals.services,
        requestId: context.requestId,
        ...(flagsInfo ? { flags: flagsInfo } : {}),
        ...(mcpInfo ? { mcp: mcpInfo } : {}),
      });
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    throw new ApiError({
      code: "NOT_FOUND",
      message: "Not found",
      status: 404,
    });
  }

  context.matchedService = {
    name: match.service.name,
    mount: match.service.config.mount,
  };

  authorizeForService(
    context as GatewayRequestContext<unknown>,
    match.service.config as unknown as AnyServiceConfig,
    internals.defaults,
  );

  const audience = match.service.config.audience ?? match.service.name;
  const gatewayContext = buildGatewayContext(
    context,
    audience,
    internals.defaults.tokenTtlSeconds,
  );

  const rewrittenUrl = buildInternalUrl(context.url, match.rewrittenPath);
  const cache = resolveDownstreamCachePolicy(context, internals, match.service);

  const response = await forwardToService({
    request: context.request,
    env: context.env,
    service: match.service.config,
    serviceName: match.service.name,
    rewrittenUrl,
    gatewayContext,
    context,
    ...(cache ? { cache } : {}),
  });
  return withMutableHeaders(
    response,
    deprecationHeaders(match.service.apiVersion),
  );
}

export class GatewayImpl<Env> implements Gateway<Env> {
  readonly name: string;
  readonly version: string;
  private readonly internals: GatewayInternals<Env>;

  constructor(options: GatewayOptions<Env>) {
    this.name = options.name;
    this.version = options.version;
    this.internals = {
      options,
      defaults: buildDefaults(options),
      middleware: [],
      services: [],
    };
    this.fetch = this.fetch.bind(this);
  }

  use(middleware: GatewayMiddleware<Env>): Gateway<Env> {
    this.internals.middleware.push(middleware);
    return this;
  }

  service<Binding extends keyof Env & string>(
    name: string,
    config: GatewayServiceConfig<Env, Binding>,
  ): Gateway<Env> {
    this.registerService({
      name,
      config: config as GatewayServiceConfig<Env, keyof Env & string>,
    });
    return this;
  }

  apiVersion(version: GatewayApiVersion): GatewayVersion<Env> {
    return new GatewayVersionImpl(this, normalizeApiVersion(version));
  }

  registerService(entry: GatewayServiceEntry<Env>): void {
    validateMount(entry.config.mount);
    this.internals.services.push(entry);
  }

  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handleRequest(request, env, ctx, this.internals);
  }
}

class GatewayVersionImpl<Env> implements GatewayVersion<Env> {
  readonly name: string;
  readonly prefix: `/${string}`;
  private readonly gateway: GatewayImpl<Env>;
  private readonly version: GatewayApiVersion;

  constructor(gateway: GatewayImpl<Env>, version: GatewayApiVersion) {
    this.gateway = gateway;
    this.version = version;
    this.name = version.name;
    this.prefix = version.prefix;
  }

  service<Binding extends keyof Env & string>(
    name: string,
    config: GatewayServiceConfig<Env, Binding>,
  ): GatewayVersion<Env> {
    this.gateway.registerService({
      name,
      config: {
        ...config,
        mount: joinMount(this.prefix, config.mount),
      } as GatewayServiceConfig<Env, keyof Env & string>,
      apiVersion: this.version,
    });
    return this;
  }

}
