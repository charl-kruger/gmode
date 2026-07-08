import type {
  GModeTenant,
  GModeUser,
  EnvResolver,
  FlagshipBinding,
  FlagshipEvaluationContext,
  FlagsClient,
  GatewayContext,
  MaybePromise,
} from "@gmode/core";
import type { error as errorFactory } from "@gmode/core";
import type { z } from "zod";

export type RpcEnvelope<In> = {
  input: In;
  context?: string;
};

export type RpcErrorPayload = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RpcErrorPayload };

export type ServiceRpcFlagsOptions<Env> = {
  binding: EnvResolver<Env, FlagshipBinding>;
  contextBuilder?: (input: {
    gateway: GatewayContext;
    env: Env;
  }) => FlagshipEvaluationContext;
};

export type RpcServiceOptions<Env> = {
  name: string;
  trustGateway?: {
    signingSecret: EnvResolver<Env, string>;
    audience: string;
    required?: boolean;
  };
  flags?: ServiceRpcFlagsOptions<Env>;
};

export type RpcFeatureFlagGate =
  | string
  | {
      key: string;
      default?: boolean;
    };

export type RpcMethodConfig<Env, In, Out> = {
  description?: string;
  scopes?: string[];
  permissions?: string[];
  featureFlag?: RpcFeatureFlagGate;
  input: z.ZodType<In>;
  output?: z.ZodType<Out>;
  handler: (context: RpcHandlerContext<Env, In>) => MaybePromise<Out>;
};

export type RpcHandlerContext<Env, In> = {
  env: Env;
  executionContext: ExecutionContext;
  input: In;
  gateway: GatewayContext;
  user?: GModeUser;
  tenant?: GModeTenant;
  scopes: string[];
  permissions: string[];
  requestId: string;
  flags?: FlagsClient;
  error: typeof errorFactory;
};

export type RpcMethodSpec = {
  input: unknown;
  output: unknown;
};

export type RpcClientMethods<Methods extends Record<string, RpcMethodSpec>> = {
  [K in keyof Methods]: (
    envelope: RpcEnvelope<Methods[K]["input"]>,
  ) => Promise<RpcResult<Methods[K]["output"]>>;
};

export type RpcServiceClient<
  Methods extends Record<string, RpcMethodSpec>,
> = RpcClientMethods<Methods>;
