export type MaybePromise<T> = T | Promise<T>;

export type EnvResolver<Env, T> = T | ((env: Env) => T);

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export type ShieldSchemaAction = "none" | "log" | "block";

export type GModeUser = {
  id: string;
  email?: string;
  name?: string;
  claims?: Record<string, unknown>;
};

export type GModeTenant = {
  id: string;
  slug?: string;
};

export type AuthContext = {
  authenticated: boolean;
  user?: GModeUser;
  tenant?: GModeTenant;
  scopes: string[];
  permissions: string[];
  raw?: unknown;
};

export type GatewayContext = {
  iss: "gmode-gateway";
  aud: string;
  requestId: string;
  authenticated: boolean;
  user?: GModeUser;
  tenant?: GModeTenant;
  scopes: string[];
  permissions: string[];
  issuedAt: number;
  expiresAt: number;
  flags?: Record<string, unknown>;
};

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

export type FetcherLike = {
  fetch(
    input: RequestInfo | URL,
    init?: RequestInit<RequestInitCfProperties>,
  ): Promise<Response>;
};

export function resolveEnvValue<Env, T>(
  resolver: EnvResolver<Env, T>,
  env: Env,
): T {
  return typeof resolver === "function"
    ? (resolver as (env: Env) => T)(env)
    : resolver;
}
