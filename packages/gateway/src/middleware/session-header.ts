import {
  hmacSign,
  resolveEnvValue,
  type EnvResolver,
} from "@gmode/core";
import { withMutableHeaders } from "../headers";
import { isPassthroughResponse } from "../passthrough";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

export const SHIELD_SESSION_HEADER = "cf-session-id";

/** Options for emitting a stable session header for Cloudflare API Shield. */
export type SessionHeaderOptions<Env> = {
  /** Header name to emit. Defaults to `cf-session-id`. */
  header?: string;
  /** Optional HMAC secret or env resolver used to avoid exposing raw identities. */
  secret?: EnvResolver<Env, string>;
  /** Build the stable session key from gateway request context. */
  keyFor?: (ctx: GatewayRequestContext<Env>) => string | undefined;
};

function defaultKey<Env>(ctx: GatewayRequestContext<Env>): string | undefined {
  const auth = ctx.auth;
  if (auth.user?.id && auth.tenant?.id) {
    return `${auth.tenant.id}:${auth.user.id}`;
  }
  if (auth.user?.id) return auth.user.id;
  const raw = auth.raw as { keyId?: string; sub?: string } | undefined;
  if (raw?.keyId) return `apikey:${raw.keyId}`;
  if (raw?.sub) return `jwt:${raw.sub}`;
  return undefined;
}

/**
 * Emit a stable session identifier header for downstream API Shield sessions.
 *
 * Use `secret` in production to hash user/API-key identifiers before writing
 * them to the response header.
 */
export function sessionHeader<Env>(
  options: SessionHeaderOptions<Env> = {},
): GatewayMiddleware<Env> {
  const header = options.header ?? SHIELD_SESSION_HEADER;
  const keyFor = options.keyFor ?? defaultKey;

  return async (context, next) => {
    const rawKey = keyFor(context);
    let sessionId: string | undefined;
    if (rawKey) {
      if (options.secret) {
        const secret = resolveEnvValue(options.secret, context.env);
        const sig = await hmacSign(secret, rawKey);
        sessionId = sig.slice(0, 32);
      } else {
        sessionId = rawKey;
      }
      context.state.set("gmode.sessionId", sessionId);
    }

    const response = await next();
    if (
      sessionId &&
      !response.headers.has(header) &&
      !isPassthroughResponse(context, response)
    ) {
      return withMutableHeaders(response, { [header]: sessionId });
    }
    return response;
  };
}
