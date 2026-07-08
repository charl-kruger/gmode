import type {
  AuthContext,
  FlagshipBinding,
  FlagshipEvaluationContext,
  FlagshipEvaluationDetails,
} from "./types";

/** Bound Flagship client with a fixed evaluation context. */
export type FlagsClient = {
  /** Evaluation context sent with every flag lookup. */
  readonly context: FlagshipEvaluationContext;

  get(flagKey: string, defaultValue?: unknown): Promise<unknown>;
  getBooleanValue(flagKey: string, defaultValue: boolean): Promise<boolean>;
  getStringValue(flagKey: string, defaultValue: string): Promise<string>;
  getNumberValue(flagKey: string, defaultValue: number): Promise<number>;
  getObjectValue<T extends object>(
    flagKey: string,
    defaultValue: T,
  ): Promise<T>;

  getBooleanDetails(
    flagKey: string,
    defaultValue: boolean,
  ): Promise<FlagshipEvaluationDetails<boolean>>;
  getStringDetails(
    flagKey: string,
    defaultValue: string,
  ): Promise<FlagshipEvaluationDetails<string>>;
  getNumberDetails(
    flagKey: string,
    defaultValue: number,
  ): Promise<FlagshipEvaluationDetails<number>>;
  getObjectDetails<T extends object>(
    flagKey: string,
    defaultValue: T,
  ): Promise<FlagshipEvaluationDetails<T>>;

  withContext(extra: FlagshipEvaluationContext): FlagsClient;
};

/**
 * Create a Flagship client that automatically sends the same context with
 * every evaluation call.
 */
export function createFlagsClient(
  binding: FlagshipBinding,
  context: FlagshipEvaluationContext,
): FlagsClient {
  const ctx = { ...context };
  return {
    context: ctx,
    get: (key, def) => binding.get(key, def, ctx),
    getBooleanValue: (key, def) => binding.getBooleanValue(key, def, ctx),
    getStringValue: (key, def) => binding.getStringValue(key, def, ctx),
    getNumberValue: (key, def) => binding.getNumberValue(key, def, ctx),
    getObjectValue: <T extends object>(key: string, def: T) =>
      binding.getObjectValue<T>(key, def, ctx),
    getBooleanDetails: (key, def) =>
      binding.getBooleanDetails(key, def, ctx),
    getStringDetails: (key, def) =>
      binding.getStringDetails(key, def, ctx),
    getNumberDetails: (key, def) =>
      binding.getNumberDetails(key, def, ctx),
    getObjectDetails: <T extends object>(key: string, def: T) =>
      binding.getObjectDetails<T>(key, def, ctx),
    withContext: (extra) => createFlagsClient(binding, { ...ctx, ...extra }),
  };
}

/** Input for `buildFlagshipContext()`. */
export type BuildFlagshipContextInput = {
  /** Gateway/service auth context to flatten into Flagship primitives. */
  auth: AuthContext;
  /** Optional request id for flag targeting/audit. */
  requestId?: string;
};

/** OpenFeature-compatible evaluation context alias. */
export type OpenFeatureEvaluationContext = FlagshipEvaluationContext;

/** OpenFeature-compatible resolution details returned by the provider shim. */
export type OpenFeatureResolutionDetails<T> = {
  value: T;
  variant?: string;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
};

/** Minimal OpenFeature provider facade backed by Cloudflare Flagship. */
export type OpenFeatureProvider = {
  readonly metadata: {
    readonly name: "gmode-flagship";
  };
  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context?: OpenFeatureEvaluationContext,
  ): Promise<OpenFeatureResolutionDetails<boolean>>;
  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context?: OpenFeatureEvaluationContext,
  ): Promise<OpenFeatureResolutionDetails<string>>;
  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context?: OpenFeatureEvaluationContext,
  ): Promise<OpenFeatureResolutionDetails<number>>;
  resolveObjectEvaluation<T extends object>(
    flagKey: string,
    defaultValue: T,
    context?: OpenFeatureEvaluationContext,
  ): Promise<OpenFeatureResolutionDetails<T>>;
};

/**
 * Create a small OpenFeature-compatible provider backed by Flagship.
 *
 * Use this when code expects OpenFeature-style `resolve*Evaluation` methods
 * but you want Cloudflare Flagship as the underlying binding.
 */
export function createOpenFeatureProvider(
  binding: FlagshipBinding,
  baseContext: OpenFeatureEvaluationContext = {},
): OpenFeatureProvider {
  return {
    metadata: { name: "gmode-flagship" },
    async resolveBooleanEvaluation(flagKey, defaultValue, context) {
      return toOpenFeatureDetails(
        await binding.getBooleanDetails(
          flagKey,
          defaultValue,
          mergeContexts(baseContext, context),
        ),
      );
    },
    async resolveStringEvaluation(flagKey, defaultValue, context) {
      return toOpenFeatureDetails(
        await binding.getStringDetails(
          flagKey,
          defaultValue,
          mergeContexts(baseContext, context),
        ),
      );
    },
    async resolveNumberEvaluation(flagKey, defaultValue, context) {
      return toOpenFeatureDetails(
        await binding.getNumberDetails(
          flagKey,
          defaultValue,
          mergeContexts(baseContext, context),
        ),
      );
    },
    async resolveObjectEvaluation<T extends object>(
      flagKey: string,
      defaultValue: T,
      context?: OpenFeatureEvaluationContext,
    ) {
      return toOpenFeatureDetails(
        await binding.getObjectDetails<T>(
          flagKey,
          defaultValue,
          mergeContexts(baseContext, context),
        ),
      );
    },
  };
}

function mergeContexts(
  base: OpenFeatureEvaluationContext,
  extra: OpenFeatureEvaluationContext | undefined,
): OpenFeatureEvaluationContext {
  return extra ? { ...base, ...extra } : { ...base };
}

function toOpenFeatureDetails<T>(
  details: FlagshipEvaluationDetails<T>,
): OpenFeatureResolutionDetails<T> {
  const out: OpenFeatureResolutionDetails<T> = {
    value: details.value,
  };
  if (details.variant !== undefined) out.variant = details.variant;
  if (details.reason !== undefined) out.reason = details.reason;
  if (details.errorCode !== undefined) out.errorCode = details.errorCode;
  if (details.errorMessage !== undefined) {
    out.errorMessage = details.errorMessage;
  }
  return out;
}

/**
 * Build a {@link FlagshipEvaluationContext} from GMode auth + request state.
 *
 * Cloudflare Flagship restricts context values to `string | number | boolean`
 * (https://developers.cloudflare.com/flagship/binding/types/), so array fields
 * like `scopes` and `permissions` are space-joined into strings — matching the
 * conventional JWT `scope` claim format.
 */
export function buildFlagshipContext(
  input: BuildFlagshipContextInput,
): FlagshipEvaluationContext {
  const ctx: FlagshipEvaluationContext = {};
  if (input.auth.user?.id) ctx["userId"] = input.auth.user.id;
  if (input.auth.user?.email) ctx["email"] = input.auth.user.email;
  if (input.auth.tenant?.id) ctx["tenantId"] = input.auth.tenant.id;
  if (input.auth.scopes.length > 0) {
    ctx["scopes"] = input.auth.scopes.join(" ");
  }
  if (input.auth.permissions.length > 0) {
    ctx["permissions"] = input.auth.permissions.join(" ");
  }
  if (input.requestId) ctx["requestId"] = input.requestId;
  return ctx;
}
