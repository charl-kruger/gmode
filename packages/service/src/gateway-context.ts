import {
  ApiError,
  GMODE_HEADERS,
  readContextSecret,
  verifyGatewayContext,
  type GatewayContext,
} from "@gmode/core";
import type { ServiceOptions } from "./types";

export type GatewayState = {
  authenticated: boolean;
  context?: GatewayContext;
};

export async function verifyServiceGatewayContext<Env>(input: {
  request: Request;
  env: Env;
  options: ServiceOptions<Env>["trustGateway"] | undefined;
}): Promise<GatewayState> {
  if (!input.options) {
    return { authenticated: false };
  }

  const token = input.request.headers.get(GMODE_HEADERS.gatewayContext);
  if (!token) {
    if (input.options.required === false) {
      return { authenticated: false };
    }
    throw new ApiError({
      code: "MISSING_GATEWAY_CONTEXT",
      message: "Missing gateway context",
      status: 401,
    });
  }

  const secret = input.options.secret
    ? input.options.secret(input.env)
    : readContextSecret(input.env);

  const context = await verifyGatewayContext(token, {
    audience: input.options.audience,
    ...(secret ? { secret } : {}),
    ...(input.options.allowUnsigned !== undefined
      ? { allowUnsigned: input.options.allowUnsigned }
      : {}),
  });

  return { authenticated: true, context };
}
