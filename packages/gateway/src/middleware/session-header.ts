import {
  hmacSign,
  resolveEnvValue,
  type EnvResolver,
} from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

export const SHIELD_SESSION_HEADER = "cf-session-id";

export type SessionHeaderOptions<Env> = {
  header?: string;
  secret?: EnvResolver<Env, string>;
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
    if (sessionId && !response.headers.has(header)) {
      response.headers.set(header, sessionId);
    }
    return response;
  };
}
