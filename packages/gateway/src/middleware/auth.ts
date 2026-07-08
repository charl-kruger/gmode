import {
  ApiError,
  base64urlDecodeToString,
  hmacVerify,
  resolveEnvValue,
  type AuthContext,
  type GModeTenant,
  type GModeUser,
  type EnvResolver,
  type MaybePromise,
} from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

type JwtPayload = Record<string, unknown> & {
  exp?: number;
  nbf?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  name?: string;
  scope?: string;
  scopes?: string[];
  permissions?: string[];
};

/** Options for `jwtAuth()`, the gateway's built-in HS256 bearer-token middleware. */
export type JwtAuthOptions<Env> = {
  /**
   * JWT HMAC secret or resolver from Worker env.
   *
   * Use a resolver for Cloudflare secrets: `secret: (env) => env.JWT_SECRET`.
   */
  secret: EnvResolver<Env, string>;
  /** Optional issuer (`iss`) claim that every verified token must match. */
  issuer?: string;
  /** Optional audience (`aud`) claim that every verified token must include. */
  audience?: string;
  /** Whether a missing bearer token fails the request. Defaults to `true`. */
  required?: boolean;
  /**
   * Skip signature/expiry verification because an upstream layer
   * (e.g. Cloudflare API Shield) has already validated the JWT.
   * The payload is still decoded and mapped into AuthContext.
   *
   * Only enable after confirming Shield-level JWT validation is
   * configured for the route in the Cloudflare dashboard.
   */
  assumeShieldVerified?: boolean;
  /** Map the decoded JWT payload into the GMode user object. Defaults to `sub`, `email`, and `name`. */
  mapUser?: (payload: Record<string, unknown>) => GModeUser;
  /** Map the decoded JWT payload into an optional tenant. */
  mapTenant?: (payload: Record<string, unknown>) => GModeTenant | undefined;
  /** Map the decoded JWT payload into scopes. Defaults to `scope` or `scopes`. */
  mapScopes?: (payload: Record<string, unknown>) => string[];
  /** Map the decoded JWT payload into permissions. Defaults to `permissions`. */
  mapPermissions?: (payload: Record<string, unknown>) => string[];
};

function defaultMapUser(payload: Record<string, unknown>): GModeUser {
  const sub = payload["sub"];
  if (typeof sub !== "string") {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "JWT missing 'sub' claim",
      status: 401,
    });
  }
  const user: GModeUser = { id: sub };
  if (typeof payload["email"] === "string") user.email = payload["email"];
  if (typeof payload["name"] === "string") user.name = payload["name"];
  return user;
}

function defaultMapScopes(payload: Record<string, unknown>): string[] {
  const scope = payload["scope"];
  if (typeof scope === "string") {
    return scope.split(/\s+/).filter(Boolean);
  }
  const scopes = payload["scopes"];
  if (Array.isArray(scopes)) {
    return scopes.filter((s): s is string => typeof s === "string");
  }
  return [];
}

function defaultMapPermissions(payload: Record<string, unknown>): string[] {
  const perms = payload["permissions"];
  if (Array.isArray(perms)) {
    return perms.filter((p): p is string => typeof p === "string");
  }
  return [];
}

function decodeJwtPayloadUnverified(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Malformed JWT",
      status: 401,
    });
  }
  const payloadPart = parts[1] as string;
  try {
    return JSON.parse(base64urlDecodeToString(payloadPart)) as JwtPayload;
  } catch {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Malformed JWT payload",
      status: 401,
    });
  }
}

async function verifyHs256(
  token: string,
  secret: string,
): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Malformed JWT",
      status: 401,
    });
  }
  const [headerPart, payloadPart, signature] = parts as [
    string,
    string,
    string,
  ];

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlDecodeToString(headerPart));
  } catch {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Malformed JWT header",
      status: 401,
    });
  }

  if (header["alg"] !== "HS256") {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Unsupported JWT algorithm",
      status: 401,
    });
  }

  const ok = await hmacVerify(
    secret,
    `${headerPart}.${payloadPart}`,
    signature,
  );
  if (!ok) {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Invalid JWT signature",
      status: 401,
    });
  }

  try {
    return JSON.parse(base64urlDecodeToString(payloadPart)) as JwtPayload;
  } catch {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Malformed JWT payload",
      status: 401,
    });
  }
}

/**
 * Authenticate gateway requests with an `Authorization: Bearer <jwt>` header.
 *
 * The middleware verifies HS256 tokens unless `assumeShieldVerified` is set,
 * then populates `context.auth` for service auth, scope checks, MCP calls,
 * telemetry, and downstream gateway context.
 */
export function jwtAuth<Env>(
  options: JwtAuthOptions<Env>,
): GatewayMiddleware<Env> {
  const required = options.required ?? true;
  const mapUser = options.mapUser ?? defaultMapUser;
  const mapTenant = options.mapTenant ?? (() => undefined);
  const mapScopes = options.mapScopes ?? defaultMapScopes;
  const mapPermissions = options.mapPermissions ?? defaultMapPermissions;

  return async (context, next) => {
    const authHeader = context.request.headers.get("authorization");
    const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

    if (!token) {
      if (required) {
        throw new ApiError({
          code: "MISSING_AUTH_TOKEN",
          message: "Missing bearer token",
          status: 401,
        });
      }
      return next();
    }

    let payload: JwtPayload;
    if (options.assumeShieldVerified) {
      payload = decodeJwtPayloadUnverified(token);
    } else {
      const secret = resolveEnvValue(options.secret, context.env);
      payload = await verifyHs256(token, secret);
    }

    const now = Math.floor(Date.now() / 1000);
    if (
      !options.assumeShieldVerified &&
      typeof payload.exp === "number" &&
      payload.exp < now
    ) {
      throw new ApiError({
        code: "AUTH_TOKEN_EXPIRED",
        message: "JWT expired",
        status: 401,
      });
    }
    if (
      !options.assumeShieldVerified &&
      typeof payload.nbf === "number" &&
      payload.nbf > now + 30
    ) {
      throw new ApiError({
        code: "INVALID_AUTH_TOKEN",
        message: "JWT not yet valid",
        status: 401,
      });
    }
    if (typeof payload.iat === "number" && payload.iat > now + 30) {
      throw new ApiError({
        code: "INVALID_AUTH_TOKEN",
        message: "JWT issued in the future",
        status: 401,
      });
    }

    if (options.issuer && payload.iss !== options.issuer) {
      throw new ApiError({
        code: "INVALID_AUTH_TOKEN",
        message: "JWT issuer mismatch",
        status: 401,
      });
    }
    if (options.audience) {
      const aud = payload.aud;
      const matches =
        aud === options.audience ||
        (Array.isArray(aud) && aud.includes(options.audience));
      if (!matches) {
        throw new ApiError({
          code: "INVALID_AUTH_TOKEN",
          message: "JWT audience mismatch",
          status: 401,
        });
      }
    }

    const auth: AuthContext = {
      authenticated: true,
      user: mapUser(payload),
      scopes: mapScopes(payload),
      permissions: mapPermissions(payload),
      raw: payload,
    };
    const tenant = mapTenant(payload);
    if (tenant) auth.tenant = tenant;
    context.auth = auth;

    return next();
  };
}

/** Options for `apiKeyAuth()`, a bring-your-own API key verifier. */
export type ApiKeyAuthOptions<Env> = {
  /** Header name containing the API key. Defaults to `x-api-key`. */
  header?: string;
  /** Optional query parameter name to read when the header is absent. */
  query?: string;
  /** Whether a missing API key fails the request. Defaults to `true`. */
  required?: boolean;
  /**
   * Verify the supplied key and return an auth context.
   *
   * Return `null` to reject the key with `401 INVALID_API_KEY`.
   */
  verify: (
    key: string,
    context: GatewayRequestContext<Env>,
  ) => MaybePromise<AuthContext | null>;
};

/**
 * Authenticate gateway requests with an API key from a header or query string.
 *
 * The returned `AuthContext` becomes `context.auth` and is used by gateway
 * service auth, scope checks, telemetry, and downstream private context.
 */
export function apiKeyAuth<Env>(
  options: ApiKeyAuthOptions<Env>,
): GatewayMiddleware<Env> {
  const headerName = options.header ?? "x-api-key";
  const queryName = options.query;
  const required = options.required ?? true;

  return async (context, next) => {
    let key = context.request.headers.get(headerName);
    if (!key && queryName) {
      key = context.url.searchParams.get(queryName);
    }
    if (!key) {
      if (required) {
        throw new ApiError({
          code: "MISSING_API_KEY",
          message: "Missing API key",
          status: 401,
        });
      }
      return next();
    }

    const result = await options.verify(key, context);
    if (!result) {
      throw new ApiError({
        code: "INVALID_API_KEY",
        message: "Invalid API key",
        status: 401,
      });
    }
    context.auth = result;
    return next();
  };
}
