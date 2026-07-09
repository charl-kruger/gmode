import { ApiError, readContextSecret, type GatewayContext } from "@gmode/core";
import {
  authorizeForService,
  FLAGS_BINDING_MISSING_STATE_KEY,
  FLAGS_GATE_BEHAVIOR_STATE_KEY,
  FLAGS_GATES_STATE_KEY,
  forwardToService,
  getGatewayInternals,
  type AnyServiceConfig,
  type GatewayRequestContext,
} from "@gmode/gateway";
import { mcpInvalidParams } from "./errors";
import type {
  McpOperationEntry,
  McpToolDispatchInput,
  McpToolDispatchResult,
} from "./types";

function substitutePath(
  template: string,
  pathParams: Record<string, string | number> | undefined,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (!pathParams || pathParams[name] === undefined) {
      throw mcpInvalidParams(
        `Missing required path parameter "${name}" for operation`,
        { parameter: name },
      );
    }
    return encodeURIComponent(String(pathParams[name]!));
  });
}

function encodeQuery(
  query: McpToolDispatchInput["query"] | undefined,
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else {
      params.set(k, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function buildGatewayContextFor(
  context: GatewayRequestContext<unknown>,
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
  return out;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function pathMatchesMount(pathname: string, mount: string): boolean {
  if (mount === "/" || mount === "") return true;
  const normalized = mount.endsWith("/") ? mount.slice(0, -1) : mount;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}

function gateError(behavior: "404" | "503"): ApiError {
  if (behavior === "503") {
    return new ApiError({
      code: "SERVICE_DISABLED",
      message: "Service temporarily disabled",
      status: 503,
    });
  }
  return new ApiError({
    code: "NOT_FOUND",
    message: "Not found",
    status: 404,
  });
}

async function authorizeFeatureFlagMountGate<Env>(
  context: GatewayRequestContext<Env>,
  pathname: string,
): Promise<void> {
  const rawGates = context.state.get(FLAGS_GATES_STATE_KEY);
  if (!isStringRecord(rawGates)) return;
  if (!context.flags) {
    if (context.state.get(FLAGS_BINDING_MISSING_STATE_KEY) === true) return;
    throw new ApiError({
      code: "FEATURE_FLAGS_UNAVAILABLE",
      message: "Feature flags client unavailable",
      status: 500,
      expose: false,
    });
  }

  const rawBehavior = context.state.get(FLAGS_GATE_BEHAVIOR_STATE_KEY);
  const behavior = rawBehavior === "503" ? "503" : "404";
  for (const [mount, flagKey] of Object.entries(rawGates)) {
    if (pathMatchesMount(pathname, mount)) {
      const enabled = await context.flags.getBooleanValue(flagKey, false);
      if (!enabled) {
        throw gateError(behavior);
      }
    }
  }
}

async function evaluateFeatureFlag<Env>(
  context: GatewayRequestContext<Env>,
  flagKey: string,
): Promise<boolean> {
  if (!context.flags) {
    // No featureFlags middleware mounted upstream. Default closed — matches
    // service-level behaviour (`gate.default = false`).
    return false;
  }
  try {
    return await context.flags.getBooleanValue(flagKey, false);
  } catch {
    return false;
  }
}

async function parseResponseBody(
  res: Response,
): Promise<{ contentType: string | null; body: unknown; }> {
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    try {
      return { contentType, body: await res.json() };
    } catch {
      return { contentType, body: null };
    }
  }
  if (res.status === 204) return { contentType, body: null };
  const text = await res.text();
  return { contentType, body: text };
}

/**
 * Synthesize an HTTP request from a typed MCP tool invocation and dispatch
 * it through the gateway's existing forwarding pipeline. Re-uses the same
 * authorization rules and feature-flag gates as a normal HTTP route.
 */
export async function invokeOperation<Env>(input: {
  context: GatewayRequestContext<Env>;
  entry: McpOperationEntry;
  toolInput: McpToolDispatchInput;
}): Promise<McpToolDispatchResult> {
  const { context, entry, toolInput } = input;

  const internals = getGatewayInternals(context);
  if (!internals) {
    throw new ApiError({
      code: "INTERNAL_ERROR",
      message: "Gateway internals unavailable to MCP dispatcher",
      status: 500,
      expose: false,
    });
  }

  const service = internals.services.find(
    (s) => s.name === entry.serviceName,
  );
  if (!service) {
    throw new ApiError({
      code: "SERVICE_NOT_FOUND",
      message: `Service "${entry.serviceName}" is not registered with this gateway`,
      status: 500,
    });
  }

  // Same mount-level authorization the gateway's normal route dispatcher
  // applies (auth/scopes/permissions declared on `gateway.service(...)`).
  authorizeForService(
    context as GatewayRequestContext<unknown>,
    service.config as unknown as AnyServiceConfig,
    internals.defaults,
  );

  // Per-operation gates declared on the service-side route. The service
  // also enforces these, but checking here short-circuits before the
  // service binding fetch.
  if (entry.scopes && entry.scopes.length > 0) {
    authorizeForService(
      context as GatewayRequestContext<unknown>,
      {
        mount: entry.mount as `/${string}`,
        scopes: entry.scopes,
      },
      internals.defaults,
    );
  }
  if (entry.permissions && entry.permissions.length > 0) {
    authorizeForService(
      context as GatewayRequestContext<unknown>,
      {
        mount: entry.mount as `/${string}`,
        permissions: entry.permissions,
      },
      internals.defaults,
    );
  }
  if (entry.featureFlag) {
    const enabled = await evaluateFeatureFlag(context, entry.featureFlag);
    if (!enabled) {
      throw new ApiError({
        code: "FEATURE_NOT_AVAILABLE",
        message: "Feature not available",
        status: 404,
        details: { flag: entry.featureFlag },
      });
    }
  }

  const substitutedPath = substitutePath(entry.path, toolInput.pathParams);
  const queryString = encodeQuery(toolInput.query);

  const headers = new Headers();
  if (toolInput.headers) {
    for (const [k, v] of Object.entries(toolInput.headers)) {
      headers.set(k, v);
    }
  }

  const hasBody =
    entry.method === "POST" ||
    entry.method === "PUT" ||
    entry.method === "PATCH";
  let body: BodyInit | null = null;
  if (hasBody && toolInput.body !== undefined) {
    body = JSON.stringify(toolInput.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  const fullPath =
    entry.mount === "/"
      ? substitutedPath
      : `${entry.mount}${substitutedPath === "/" ? "" : substitutedPath}`;
  const internalUrl = new URL(
    `${fullPath}${queryString}`,
    context.url.origin,
  );
  await authorizeFeatureFlagMountGate(context, internalUrl.pathname);

  const syntheticRequest = new Request(internalUrl.toString(), {
    method: entry.method,
    headers,
    ...(body !== null ? { body } : {}),
  });

  // Build the rewritten URL the same way the gateway's route() does:
  // strip the mount prefix when stripPrefix !== false.
  const rewrittenUrl = new URL(internalUrl.toString());
  if (service.config.stripPrefix !== false && entry.mount !== "/") {
    rewrittenUrl.pathname =
      substitutedPath === "" ? "/" : substitutedPath;
  }

  const audience = service.config.audience ?? service.name;
  const gatewayContext = buildGatewayContextFor(
    context as GatewayRequestContext<unknown>,
    audience,
    internals.defaults.tokenTtlSeconds,
  );
  const contextSecret = readContextSecret(context.env);

  const response = await forwardToService({
    request: syntheticRequest,
    env: context.env,
    service: service.config as never,
    serviceName: service.name,
    rewrittenUrl,
    gatewayContext,
    context,
    ...(contextSecret ? { contextSecret } : {}),
  });

  const parsed = await parseResponseBody(response);
  return {
    status: response.status,
    contentType: parsed.contentType,
    body: parsed.body,
  };
}
