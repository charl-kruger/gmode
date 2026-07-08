import {
  ApiError,
  buildFlagshipContext,
  createFlagsClient,
  decodeGatewayContext,
  error as errorFactory,
  matchesAllScopes,
  resolveEnvValue,
  serializeError,
  type FlagsClient,
  type FlagshipBinding,
  type GatewayContext,
} from "@gmode/core";
import type {
  RpcEnvelope,
  RpcFeatureFlagGate,
  RpcHandlerContext,
  RpcMethodConfig,
  RpcMethodSpec,
  RpcResult,
  RpcServiceClient,
  RpcServiceOptions,
} from "./types";

type AnyRpcMethodConfig<Env> = RpcMethodConfig<Env, unknown, unknown>;

function anonymousGatewayContext(audience: string): GatewayContext {
  return {
    iss: "gmode-gateway",
    aud: audience,
    requestId: "anonymous",
    authenticated: false,
    scopes: [],
    permissions: [],
    issuedAt: 0,
    expiresAt: 0,
  };
}

function normalizeFlagGate(
  gate: RpcFeatureFlagGate,
): { key: string; default: boolean } {
  if (typeof gate === "string") return { key: gate, default: false };
  return { key: gate.key, default: gate.default ?? false };
}

function toRpcFailure(err: unknown): RpcResult<never> {
  const { body } = serializeError({ err });
  return {
    ok: false,
    error: {
      code: body.error.code,
      message: body.error.message,
      status: body.error.status,
      ...(body.error.details !== undefined
        ? { details: body.error.details }
        : {}),
    },
  };
}

/** Runtime RPC service built with `createRpcService()`. */
export interface RpcService<
  Env,
  Methods extends Record<string, RpcMethodSpec> = Record<string, never>,
> {
  /** Service name used in diagnostics and anonymous gateway context. */
  readonly name: string;
  /** Registered RPC method names. */
  readonly methodNames: readonly string[];
  /**
   * Phantom typed client surface.
   *
   * Use `export type MyRpc = typeof rpc.client` in the service Worker, then
   * type the caller's service binding as `MyRpc`.
   */
  readonly client: RpcServiceClient<Methods>;

  /** Register an RPC method and refine the service's typed client surface. */
  method<Name extends string, In, Out>(
    name: Name,
    config: RpcMethodConfig<Env, In, Out>,
  ): RpcService<Env, Methods & { [K in Name]: { input: In; output: Out } }>;

  /** Invoke a registered method from the generated WorkerEntrypoint class. */
  invoke(
    name: string,
    envelope: RpcEnvelope<unknown>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<RpcResult<unknown>>;
}

class RpcServiceImpl<Env> {
  readonly name: string;
  private readonly options: RpcServiceOptions<Env>;
  private readonly methods = new Map<string, AnyRpcMethodConfig<Env>>();

  constructor(options: RpcServiceOptions<Env>) {
    this.name = options.name;
    this.options = options;
  }

  get methodNames(): readonly string[] {
    return Array.from(this.methods.keys());
  }

  get client(): never {
    throw new Error(
      "RpcService.client is a phantom type used only at compile time",
    );
  }

  method(
    name: string,
    config: AnyRpcMethodConfig<Env>,
  ): this {
    if (this.methods.has(name)) {
      throw new Error(`RPC method "${name}" is already registered`);
    }
    this.methods.set(name, config);
    return this;
  }

  async invoke(
    name: string,
    envelope: RpcEnvelope<unknown>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<RpcResult<unknown>> {
    const config = this.methods.get(name);
    if (!config) {
      return toRpcFailure(
        new ApiError({
          code: "METHOD_NOT_FOUND",
          message: `RPC method "${name}" not found`,
          status: 404,
        }),
      );
    }

    try {
      const gatewayContext = this.resolveGatewayContext(envelope.context);

      this.assertScopes(config, gatewayContext);

      const flagsClient = this.resolveFlagsClient(env, gatewayContext);
      await this.assertFeatureFlag(config, flagsClient, gatewayContext);

      const parsedInput = config.input.parse(envelope.input);

      const handlerContext: RpcHandlerContext<Env, unknown> = {
        env,
        executionContext: ctx,
        input: parsedInput,
        gateway: gatewayContext,
        scopes: gatewayContext.scopes,
        permissions: gatewayContext.permissions,
        requestId: gatewayContext.requestId,
        error: errorFactory,
      };
      if (gatewayContext.user) handlerContext.user = gatewayContext.user;
      if (gatewayContext.tenant) handlerContext.tenant = gatewayContext.tenant;
      if (flagsClient) handlerContext.flags = flagsClient;

      const result = await config.handler(handlerContext);

      const validated = config.output
        ? config.output.parse(result)
        : result;

      return { ok: true, data: validated };
    } catch (err) {
      return toRpcFailure(err);
    }
  }

  private resolveGatewayContext(
    token: string | undefined,
  ): GatewayContext {
    const trust = this.options.trustGateway;
    if (!trust) {
      return anonymousGatewayContext(this.name);
    }
    if (!token) {
      if (trust.required === false) {
        return anonymousGatewayContext(trust.audience);
      }
      throw new ApiError({
        code: "MISSING_GATEWAY_CONTEXT",
        message: "Missing gateway context",
        status: 401,
      });
    }
    return decodeGatewayContext(token, {
      audience: trust.audience,
    });
  }

  private assertScopes(
    config: AnyRpcMethodConfig<Env>,
    gatewayContext: GatewayContext,
  ): void {
    if (
      config.scopes &&
      config.scopes.length > 0 &&
      !matchesAllScopes(config.scopes, gatewayContext.scopes)
    ) {
      throw new ApiError({
        code: "INSUFFICIENT_SCOPE",
        message: "Insufficient scope",
        status: 403,
        details: { required: config.scopes },
      });
    }
    if (
      config.permissions &&
      config.permissions.length > 0 &&
      !matchesAllScopes(config.permissions, gatewayContext.permissions)
    ) {
      throw new ApiError({
        code: "INSUFFICIENT_PERMISSION",
        message: "Insufficient permission",
        status: 403,
        details: { required: config.permissions },
      });
    }
  }

  private resolveFlagsClient(
    env: Env,
    gatewayContext: GatewayContext,
  ): FlagsClient | undefined {
    if (!this.options.flags) return undefined;
    const binding = resolveEnvValue(
      this.options.flags.binding,
      env,
    ) as FlagshipBinding;
    const evalContext = this.options.flags.contextBuilder
      ? this.options.flags.contextBuilder({ gateway: gatewayContext, env })
      : buildFlagshipContext({
          auth: {
            authenticated: gatewayContext.authenticated,
            ...(gatewayContext.user ? { user: gatewayContext.user } : {}),
            ...(gatewayContext.tenant
              ? { tenant: gatewayContext.tenant }
              : {}),
            scopes: gatewayContext.scopes,
            permissions: gatewayContext.permissions,
          },
          requestId: gatewayContext.requestId,
        });
    return createFlagsClient(binding, evalContext);
  }

  private async assertFeatureFlag(
    config: AnyRpcMethodConfig<Env>,
    flagsClient: FlagsClient | undefined,
    gatewayContext: GatewayContext,
  ): Promise<void> {
    if (!config.featureFlag) return;
    const gate = normalizeFlagGate(config.featureFlag);
    let enabled = gate.default;
    if (flagsClient) {
      enabled = await flagsClient.getBooleanValue(gate.key, gate.default);
    } else if (
      gatewayContext.flags &&
      gate.key in gatewayContext.flags &&
      typeof gatewayContext.flags[gate.key] === "boolean"
    ) {
      enabled = gatewayContext.flags[gate.key] as boolean;
    }
    if (!enabled) {
      throw new ApiError({
        code: "FEATURE_NOT_AVAILABLE",
        message: "Feature not available",
        status: 404,
      });
    }
  }
}

/**
 * Create a typed RPC service for Cloudflare Worker service bindings.
 *
 * Chain `.method(...)` calls, export `typeof rpc.client` for callers, and pass
 * the service to `defineEntrypoint()` to expose RPC methods on the Worker class.
 */
export function createRpcService<Env = unknown>(
  options: RpcServiceOptions<Env>,
): RpcService<Env, Record<string, never>> {
  return new RpcServiceImpl<Env>(options) as unknown as RpcService<
    Env,
    Record<string, never>
  >;
}
