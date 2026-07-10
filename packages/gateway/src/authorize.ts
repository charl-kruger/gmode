import { ApiError, matchesAllScopes } from "@gmode/core";
import type {
  GatewayRequestContext,
  GatewayServiceEntry,
  ResolvedGatewayDefaults,
} from "./types";

/**
 * State key on `GatewayRequestContext.state` carrying a read-only handle to
 * the gateway's services list and resolved defaults. The gateway sets this
 * at the start of every request so
 * internal middleware (like `@gmode/mcp`) can index operations, apply the
 * same authorization rules as the normal route dispatcher, and dispatch
 * through `forwardToService` with the same private context.
 *
 * Treat the returned data as read-only. Mutating it does not propagate.
 */
export const GATEWAY_INTERNALS_STATE_KEY = "gmode.gateway.internals";

/** Read-only gateway internals exposed to trusted framework middleware. */
export type GatewayInternalsHandle<Env = unknown> = {
  /** Registered services and API versions. Treat as read-only. */
  services: ReadonlyArray<GatewayServiceEntry<Env>>;
  /** Resolved gateway defaults used by the route dispatcher. */
  defaults: ResolvedGatewayDefaults;
  /** Opaque stable key for per-gateway integration caches. */
  cacheKey?: object;
};

/**
 * Read the gateway internals handle that the gateway writes onto
 * `context.state` at the start of every request. Returns `undefined` if
 * called outside a gateway request (i.e. in a standalone test harness).
 */
export function getGatewayInternals<Env>(
  context: GatewayRequestContext<Env>,
): GatewayInternalsHandle<Env> | undefined {
  const raw = context.state.get(GATEWAY_INTERNALS_STATE_KEY);
  if (!raw || typeof raw !== "object") return undefined;
  return raw as GatewayInternalsHandle<Env>;
}

/**
 * Loose type for service config — used by both the gateway's normal route
 * dispatcher and by `@gmode/mcp`'s tool dispatcher. Both need to enforce
 * the same auth/scope/permission gates without re-implementing the rules.
 */
export type AnyServiceConfig = {
  /** Public mount prefix. */
  mount: `/${string}`;
  /** Whether auth is required for this service. */
  auth?: boolean;
  /** Scopes required before dispatch. */
  scopes?: string[];
  /** Permissions required before dispatch. */
  permissions?: string[];
};

/**
 * Apply the gateway's authorization rules for a service mount:
 *   - `auth: true` requires `context.auth.authenticated`
 *   - default and service `scopes` require the request to hold all required scopes (with `*`/`prefix:*` wildcards)
 *   - default and service `permissions` require the request to hold all required permissions
 *
 * Throws an `ApiError` with the framework's standard codes
 * (`UNAUTHORIZED` / `INSUFFICIENT_SCOPE` / `INSUFFICIENT_PERMISSION`) on
 * failure; returns void on success.
 */
export function authorizeForService(
  context: GatewayRequestContext<unknown>,
  service: AnyServiceConfig,
  defaults: ResolvedGatewayDefaults,
): void {
  const authRequired = service.auth ?? defaults.auth;
  if (authRequired && !context.auth.authenticated) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      status: 401,
    });
  }
  if (!authRequired) return;

  const requiredScopes = Array.from(
    new Set([...defaults.scopes, ...(service.scopes ?? [])]),
  );
  if (
    requiredScopes.length > 0 &&
    !matchesAllScopes(requiredScopes, context.auth.scopes)
  ) {
    throw new ApiError({
      code: "INSUFFICIENT_SCOPE",
      message: "Insufficient scope",
      status: 403,
      details: { required: requiredScopes },
    });
  }

  const requiredPerms = Array.from(
    new Set([...defaults.permissions, ...(service.permissions ?? [])]),
  );
  if (
    requiredPerms.length > 0 &&
    !matchesAllScopes(requiredPerms, context.auth.permissions)
  ) {
    throw new ApiError({
      code: "INSUFFICIENT_PERMISSION",
      message: "Insufficient permission",
      status: 403,
      details: { required: requiredPerms },
    });
  }
}
