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

/** Wire envelope passed over a Cloudflare Worker service binding RPC method. */
export type RpcEnvelope<In> = {
  /** Validated method input payload. */
  input: In;
  /** Private gateway context token forwarded from an HTTP request, when available. */
  context?: string;
};

/** Serialized RPC error payload returned by server-side method invocation. */
export type RpcErrorPayload = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

/** Discriminated result returned by service-bound RPC methods. */
export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RpcErrorPayload };

/** Flagship configuration for an RPC service. */
export type ServiceRpcFlagsOptions<Env> = {
  /** Flagship binding or env resolver. */
  binding: EnvResolver<Env, FlagshipBinding>;
  /** Override the default evaluation context built from gateway auth. */
  contextBuilder?: (input: {
    gateway: GatewayContext;
    env: Env;
  }) => FlagshipEvaluationContext;
};

/** Options passed to `createRpcService()`. */
export type RpcServiceOptions<Env> = {
  /** Service name used for anonymous gateway context and diagnostics. */
  name: string;
  /** Decode and optionally require gateway context forwarded by an HTTP caller. */
  trustGateway?: {
    /** Expected gateway context audience for this RPC service. */
    audience: string;
    /** Whether the context token is required. Defaults to `true`. */
    required?: boolean;
  };
  /** Optional Flagship binding for method feature gates and handlers. */
  flags?: ServiceRpcFlagsOptions<Env>;
};

/** Feature flag guard for an RPC method. */
export type RpcFeatureFlagGate =
  | string
  | {
    /** Flagship boolean flag key. */
    key: string;
    /** Default value passed to Flagship. Defaults to `false`. */
    default?: boolean;
  };

/** RPC method definition passed to `service.method(...)`. */
export type RpcMethodConfig<Env, In, Out> = {
  /** Human-readable method description for generated metadata. */
  description?: string;
  /** Scopes required from the gateway context before the handler runs. */
  scopes?: string[];
  /** Permissions required from the gateway context before the handler runs. */
  permissions?: string[];
  /** Optional Flagship guard evaluated before the handler runs. */
  featureFlag?: RpcFeatureFlagGate;
  /** Zod schema for method input. */
  input: z.ZodType<In>;
  /** Optional Zod schema for method output. */
  output?: z.ZodType<Out>;
  /** Handler called after context resolution, authz, feature flags, and input validation. */
  handler: (context: RpcHandlerContext<Env, In>) => MaybePromise<Out>;
};

/** Context object passed to each RPC method handler. */
export type RpcHandlerContext<Env, In> = {
  /** Cloudflare Worker env bindings. */
  env: Env;
  /** Cloudflare Worker execution context. */
  executionContext: ExecutionContext;
  /** Validated method input. */
  input: In;
  /** Private gateway context forwarded by the caller, or anonymous context. */
  gateway: GatewayContext;
  /** Authenticated user forwarded by the gateway, when present. */
  user?: GModeUser;
  /** Tenant forwarded by the gateway, when present. */
  tenant?: GModeTenant;
  /** Scopes forwarded by the gateway. */
  scopes: string[];
  /** Permissions forwarded by the gateway. */
  permissions: string[];
  /** Request id forwarded by the gateway. */
  requestId: string;
  /** Flagship client, when RPC flags are configured. */
  flags?: FlagsClient;
  /** Structured API error factory. */
  error: typeof errorFactory;
};

/** Type-level RPC method specification used to derive typed clients. */
export type RpcMethodSpec = {
  input: unknown;
  output: unknown;
};

/** Worker service-binding method map generated from RPC method specs. */
export type RpcClientMethods<Methods extends Record<string, RpcMethodSpec>> = {
  [K in keyof Methods]: (
    envelope: RpcEnvelope<Methods[K]["input"]>,
  ) => Promise<RpcResult<Methods[K]["output"]>>;
};

/** Phantom client type exposed by `RpcService.client` for `createRpcClient()`. */
export type RpcServiceClient<
  Methods extends Record<string, RpcMethodSpec>,
> = RpcClientMethods<Methods>;
