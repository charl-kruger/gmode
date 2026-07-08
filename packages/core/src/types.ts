/** Value that may be returned synchronously or as a Promise. */
export type MaybePromise<T> = T | Promise<T>;

/** Static env-bound value or resolver function that reads from Worker `env`. */
export type EnvResolver<Env, T> = T | ((env: Env) => T);

/** HTTP methods understood by GMode routing and OpenAPI helpers. */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

/** API Shield schema action metadata emitted in generated OpenAPI. */
export type ShieldSchemaAction = "none" | "log" | "block";

/** Authenticated user shape propagated through gateway, service, RPC, and MCP. */
export type GModeUser = {
  /** Stable user id. Usually JWT `sub` or provider subject. */
  id: string;
  /** Optional user email. */
  email?: string;
  /** Optional display name. */
  name?: string;
  /** Provider-specific claims retained for handlers that need them. */
  claims?: Record<string, unknown>;
};

/** Tenant/account shape propagated through gateway, service, RPC, and MCP. */
export type GModeTenant = {
  /** Stable tenant id. */
  id: string;
  /** Optional human-readable tenant slug. */
  slug?: string;
};

/** Current gateway authentication and authorization state. */
export type AuthContext = {
  /** Whether the request has an authenticated identity. */
  authenticated: boolean;
  /** Authenticated user, when present. */
  user?: GModeUser;
  /** Tenant/account, when present. */
  tenant?: GModeTenant;
  /** Granted scopes. Supports `foo:*` checks through `matchesScope()`. */
  scopes: string[];
  /** Granted permissions. Supports `foo:*` checks through `matchesScope()`. */
  permissions: string[];
  /** Raw provider-specific auth payload. */
  raw?: unknown;
};

/**
 * Private context encoded by the gateway and decoded by downstream services.
 *
 * This is intended for private Worker-to-Worker Service Binding requests, not
 * for public client-supplied identity.
 */
export type GatewayContext = {
  /** Issuer. Always `gmode-gateway`. */
  iss: "gmode-gateway";
  /** Expected downstream audience/service. */
  aud: string;
  /** Gateway request id. */
  requestId: string;
  /** Whether the original gateway request was authenticated. */
  authenticated: boolean;
  /** Authenticated user, when present. */
  user?: GModeUser;
  /** Tenant/account, when present. */
  tenant?: GModeTenant;
  /** Scopes forwarded by the gateway. */
  scopes: string[];
  /** Permissions forwarded by the gateway. */
  permissions: string[];
  /** Unix timestamp when the context was issued. */
  issuedAt: number;
  /** Unix timestamp when the context expires. */
  expiresAt: number;
  /** Optional feature flag values forwarded by the gateway. */
  flags?: Record<string, unknown>;
};

/** Minimal shape of Cloudflare's native Rate Limiting binding. */
export type CloudflareRateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

/**
 * Cloudflare Flagship evaluation context. Per the docs
 * (https://developers.cloudflare.com/flagship/binding/types/), values are
 * restricted to primitives — string, number, or boolean. Arrays and nested
 * objects must be flattened (e.g. joined into a single string) before being
 * passed to the binding.
 */
export type FlagshipEvaluationContext = Record<
  string,
  string | number | boolean
>;

/** Error code returned by Cloudflare Flagship detail methods. */
export type FlagshipErrorCode = "TYPE_MISMATCH" | "GENERAL" | (string & {});

/**
 * Matches Cloudflare's documented `FlagshipEvaluationDetails<T>` shape:
 * https://developers.cloudflare.com/flagship/binding/types/
 */
export interface FlagshipEvaluationDetails<T> {
  flagKey: string;
  value: T;
  variant?: string;
  reason?: string;
  errorCode?: FlagshipErrorCode;
  errorMessage?: string;
}

/** @deprecated use {@link FlagshipEvaluationDetails} (matches the docs). */
export type FlagshipDetails<T> = FlagshipEvaluationDetails<T>;

/** Cloudflare Flagship binding shape used by GMode. */
export type FlagshipBinding = {
  get(
    flagKey: string,
    defaultValue?: unknown,
    context?: FlagshipEvaluationContext,
  ): Promise<unknown>;
  getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context?: FlagshipEvaluationContext,
  ): Promise<boolean>;
  getStringValue(
    flagKey: string,
    defaultValue: string,
    context?: FlagshipEvaluationContext,
  ): Promise<string>;
  getNumberValue(
    flagKey: string,
    defaultValue: number,
    context?: FlagshipEvaluationContext,
  ): Promise<number>;
  getObjectValue<T extends object>(
    flagKey: string,
    defaultValue: T,
    context?: FlagshipEvaluationContext,
  ): Promise<T>;
  getBooleanDetails(
    flagKey: string,
    defaultValue: boolean,
    context?: FlagshipEvaluationContext,
  ): Promise<FlagshipEvaluationDetails<boolean>>;
  getStringDetails(
    flagKey: string,
    defaultValue: string,
    context?: FlagshipEvaluationContext,
  ): Promise<FlagshipEvaluationDetails<string>>;
  getNumberDetails(
    flagKey: string,
    defaultValue: number,
    context?: FlagshipEvaluationContext,
  ): Promise<FlagshipEvaluationDetails<number>>;
  getObjectDetails<T extends object>(
    flagKey: string,
    defaultValue: T,
    context?: FlagshipEvaluationContext,
  ): Promise<FlagshipEvaluationDetails<T>>;
};

/** Minimal service binding shape used by gateway forwarding. */
export type FetcherLike = {
  fetch(
    input: RequestInfo | URL,
    init?: RequestInit<RequestInitCfProperties>,
  ): Promise<Response>;
};

/**
 * Resolve a static value or env resolver function.
 *
 * Used by SDK options that accept secrets or bindings as either direct values
 * or `(env) => env.NAME` functions.
 */
export function resolveEnvValue<Env, T>(
  resolver: EnvResolver<Env, T>,
  env: Env,
): T {
  return typeof resolver === "function"
    ? (resolver as (env: Env) => T)(env)
    : resolver;
}
