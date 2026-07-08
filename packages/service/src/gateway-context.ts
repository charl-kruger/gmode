import {
  ApiError,
  GMODE_HEADERS,
  decodeGatewayContext,
  type GatewayContext,
} from "@gmode/core";
import type { ServiceOptions } from "./types";

export type GatewayState = {
  authenticated: boolean;
  context?: GatewayContext;
};

export function verifyServiceGatewayContext<Env>(input: {
  request: Request;
  options: ServiceOptions<Env>["trustGateway"] | undefined;
}): GatewayState {
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

  const context = decodeGatewayContext(token, {
    audience: input.options.audience,
  });

  return { authenticated: true, context };
}
