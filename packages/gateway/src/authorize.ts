import { ApiError, matchesAllScopes, type EnvResolver } from "@gmode/core";
import type {
  GatewayRequestContext,
  GatewayServiceEntry,
  ResolvedGatewayDefaults,
} from "./types";

/**
 * State key on `GatewayRequestContext.state` carrying a read-only handle to
 * the gateway's services list, resolved defaults, and internal signing
 * secret resolver. The gateway sets this at the start of every request so
 * internal middleware (like `@gmode/mcp`) can index operations, apply the
 * same authorization rules as the normal route dispatcher, and dispatch
 * through `forwardToService` with the same signed context.
 *
 * Treat the returned data as read-only. Mutating it does not propagate.
 */
export const GATEWAY_INTERNALS_STATE_KEY = "gmode.gateway.internals";

export type GatewayInternalsHandle<Env = unknown> = {
  services: ReadonlyArray<GatewayServiceEntry<Env>>;
  defaults: ResolvedGatewayDefaults;
  signingSecret: EnvResolver<Env, string>;
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
  mount: `/${string}`;
  auth?: boolean;
  scopes?: string[];
  permissions?: string[];
};

/**
 * Apply the gateway's authorization rules for a service mount:
 *   - `auth: true` requires `context.auth.authenticated`
 *   - `scopes` requires the request to hold all required scopes (with `*`/`prefix:*` wildcards)
 *   - `permissions` requires the request to hold all required permissions
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

  const requiredScopes = service.scopes ?? [];
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

  const requiredPerms = service.permissions ?? [];
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
