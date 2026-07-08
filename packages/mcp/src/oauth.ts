import {
  ApiError,
  matchesAllScopes,
  type AuthContext,
  type GModeUser,
  type MaybePromise,
} from "@gmode/core";
import type {
  McpAuthMergeInput,
  McpOAuthContext,
  McpOAuthProvider,
} from "./types";

/** Options for `bearerTokenOAuthProvider()`. */
export type BearerTokenOAuthProviderOptions<Env = unknown> = {
  /** Scopes required before MCP JSON-RPC handling starts. Supports `foo:*`. */
  requiredScopes?: string[];
  /**
   * Verify an OAuth bearer token and return the MCP identity.
   *
   * Return `null` to reject the token with `401 INVALID_AUTH_TOKEN`.
   */
  verifyToken(input: {
    token: string;
    request: Request;
    env: Env;
  }): MaybePromise<McpOAuthContext | null>;
};

function parseBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: "Missing OAuth bearer token",
      status: 401,
    });
  }

  const [scheme, token, extra] = authorization.split(/\s+/);
  if (scheme !== "Bearer" || !token || extra !== undefined) {
    throw new ApiError({
      code: "INVALID_AUTH_TOKEN",
      message: "Invalid OAuth bearer token",
      status: 401,
    });
  }
  return token;
}

function defaultUser(subject: string): GModeUser {
  return { id: subject };
}

/**
 * Merge a verified MCP OAuth identity into the gateway auth context.
 *
 * Existing gateway scopes and permissions are preserved and de-duplicated.
 */
export function mergeMcpOAuthAuth(input: McpAuthMergeInput): AuthContext {
  const oauthPermissions = input.oauth.permissions ?? [];
  const user = input.oauth.user ?? defaultUser(input.oauth.subject);
  const auth: AuthContext = {
    authenticated: true,
    user,
    scopes: [...new Set([...input.existing.scopes, ...input.oauth.scopes])],
    permissions: [
      ...new Set([...input.existing.permissions, ...oauthPermissions]),
    ],
    raw: input.oauth.raw ?? input.existing.raw,
  };
  const tenant = input.oauth.tenant ?? input.existing.tenant;
  if (tenant) {
    auth.tenant = tenant;
  }
  return auth;
}

/**
 * Create an MCP OAuth provider that reads `Authorization: Bearer <token>`.
 *
 * The provider verifies the token with `verifyToken`, enforces
 * `requiredScopes`, then lets `mountMcp()` merge the returned identity into
 * the gateway auth context before tool dispatch.
 */
export function bearerTokenOAuthProvider<Env = unknown>(
  options: BearerTokenOAuthProviderOptions<Env>,
): McpOAuthProvider<Env> {
  return {
    async verify(input) {
      const token = parseBearerToken(input.request);
      const oauth = await options.verifyToken({
        token,
        request: input.request,
        env: input.env,
      });
      if (!oauth) {
        throw new ApiError({
          code: "INVALID_AUTH_TOKEN",
          message: "Invalid OAuth bearer token",
          status: 401,
        });
      }

      const requiredScopes = options.requiredScopes ?? [];
      if (
        requiredScopes.length > 0 &&
        !matchesAllScopes(requiredScopes, oauth.scopes)
      ) {
        throw new ApiError({
          code: "INSUFFICIENT_SCOPE",
          message: "Insufficient OAuth scope",
          status: 403,
          details: { required: requiredScopes },
        });
      }

      return oauth;
    },
  };
}
