import { ApiError } from "@gmode/core";
import type {
  RpcEnvelope,
  RpcMethodSpec,
  RpcResult,
} from "./types";

export type RpcClientCallable<Methods extends Record<string, RpcMethodSpec>> = {
  [K in keyof Methods]: (
    input: Methods[K]["input"],
  ) => Promise<Methods[K]["output"]>;
};

type RpcBindingShape<Methods extends Record<string, RpcMethodSpec>> = {
  [K in keyof Methods]: (
    envelope: RpcEnvelope<Methods[K]["input"]>,
  ) => Promise<RpcResult<Methods[K]["output"]>>;
};

export type CreateRpcClientInput<Methods extends Record<string, RpcMethodSpec>> = {
  binding: RpcBindingShape<Methods>;
  context?: string | (() => string | undefined);
};

function resolveToken(
  context: CreateRpcClientInput<Record<string, RpcMethodSpec>>["context"],
): string | undefined {
  if (typeof context === "function") return context();
  return context;
}

function rehydrateError(payload: {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}): ApiError {
  return new ApiError({
    code: payload.code,
    message: payload.message,
    status: payload.status,
    ...(payload.details !== undefined ? { details: payload.details } : {}),
  });
}

export function createRpcClient<
  Methods extends Record<string, RpcMethodSpec>,
>(
  input: CreateRpcClientInput<Methods>,
): RpcClientCallable<Methods> {
  return new Proxy({} as RpcClientCallable<Methods>, {
    get(_target, methodName) {
      if (typeof methodName !== "string") return undefined;
      return async (callInput: unknown) => {
        const token = resolveToken(input.context);
        const envelope: RpcEnvelope<unknown> = { input: callInput };
        if (token !== undefined) envelope.context = token;
        const bindingFn = (
          input.binding as unknown as Record<
            string,
            (envelope: RpcEnvelope<unknown>) => Promise<RpcResult<unknown>>
          >
        )[methodName];
        if (typeof bindingFn !== "function") {
          throw new ApiError({
            code: "METHOD_NOT_FOUND",
            message: `RPC method "${methodName}" is not on the binding`,
            status: 500,
          });
        }
        const result = await bindingFn.call(input.binding, envelope);
        if (result.ok) return result.data;
        throw rehydrateError(result.error);
      };
    },
  });
}
