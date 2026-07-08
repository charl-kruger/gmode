import {
  ApiError,
  buildFlagshipContext,
  createFlagsClient,
  logStructured,
  type FlagshipBinding,
  type FlagshipEvaluationContext,
} from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

export const FORWARDED_FLAGS_STATE_KEY = "gmode.forwardedFlags";
export const FLAGS_BINDING_NAME_STATE_KEY = "gmode.flagsBindingName";
export const FLAGS_GATES_STATE_KEY = "gmode.flagsGates";
export const FLAGS_GATE_BEHAVIOR_STATE_KEY = "gmode.flagsGateBehavior";
export const FLAGS_BINDING_MISSING_STATE_KEY = "gmode.flagsBindingMissing";

/** Options for gateway integration with Cloudflare Flagship. */
export type FeatureFlagsOptions<Env, Binding extends keyof Env & string> = {
  /** Name of the Flagship binding in the gateway Worker env. */
  binding: Binding;
  /** Override the default evaluation context built from auth and request id. */
  contextBuilder?: (
    ctx: GatewayRequestContext<Env>,
  ) => FlagshipEvaluationContext;
  /**
   * Flag keys whose values should be forwarded to downstream services.
   *
   * Forwarded values are encoded in the private gateway context rather than
   * sent as user-controlled public headers.
   */
  forward?: string[] | ((ctx: GatewayRequestContext<Env>) => string[]);
  /** Map gateway mount prefixes to boolean flag keys that enable those mounts. */
  gates?: Record<string, string>;
  /** Response behavior when a gate flag is off. Defaults to `404`. */
  gateBehavior?: "404" | "503";
  /**
   * When the Flagship binding is missing at runtime (common in `wrangler dev`
   * with older Wrangler versions that don't parse `"flagship": [...]`), log a
   * structured warning and skip flag evaluation instead of throwing. Defaults
   * to `false` so production catches misconfiguration loudly.
   */
  failOpen?: boolean;
};

function gateError(behavior: "404" | "503"): ApiError {
  if (behavior === "503") {
    return new ApiError({
      code: "SERVICE_DISABLED",
      message: "Service temporarily disabled",
      status: 503,
    });
  }
  return new ApiError({
    code: "NOT_FOUND",
    message: "Not found",
    status: 404,
  });
}

function pathMatchesMount(pathname: string, mount: string): boolean {
  if (mount === "/" || mount === "") return true;
  const normalized = mount.endsWith("/") ? mount.slice(0, -1) : mount;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}

/**
 * Attach a Flagship client to the gateway request and optionally gate mounts.
 *
 * Downstream services can read forwarded flag values from `context.gateway.flags`
 * after the gateway forwards the private context.
 */
export function featureFlags<Env, Binding extends keyof Env & string>(
  options: FeatureFlagsOptions<Env, Binding>,
): GatewayMiddleware<Env> {
  const gateBehavior = options.gateBehavior ?? "404";
  const failOpen = options.failOpen ?? false;

  return async (context, next) => {
    const binding = (context.env as Record<string, unknown>)[
      options.binding
    ] as FlagshipBinding | undefined;

    if (!binding || typeof binding.getBooleanValue !== "function") {
      if (failOpen) {
        logStructured({
          level: "warn",
          type: "gmode.flags.missing_binding",
          binding: options.binding,
          requestId: context.requestId,
        });
        context.state.set(
          FLAGS_BINDING_NAME_STATE_KEY,
          options.binding,
        );
        context.state.set(FLAGS_BINDING_MISSING_STATE_KEY, true);
        if (options.gates) {
          context.state.set(FLAGS_GATES_STATE_KEY, { ...options.gates });
          context.state.set(FLAGS_GATE_BEHAVIOR_STATE_KEY, gateBehavior);
        }
        return next();
      }
      throw new Error(
        `Flagship binding "${options.binding}" is not configured. ` +
          `Declare it in wrangler.jsonc under "flagship" (requires wrangler >= 4.92), ` +
          `or pass failOpen: true to featureFlags() for local-dev resilience.`,
      );
    }

    const evaluationContext = options.contextBuilder
      ? options.contextBuilder(context)
      : buildFlagshipContext({
          auth: context.auth,
          requestId: context.requestId,
        });

    const client = createFlagsClient(binding, evaluationContext);
    context.flags = client;
    context.state.set(FLAGS_BINDING_NAME_STATE_KEY, options.binding);
    if (options.gates) {
      context.state.set(FLAGS_GATES_STATE_KEY, { ...options.gates });
      context.state.set(FLAGS_GATE_BEHAVIOR_STATE_KEY, gateBehavior);
    }

    if (options.gates) {
      for (const [mount, flagKey] of Object.entries(options.gates)) {
        if (pathMatchesMount(context.url.pathname, mount)) {
          const enabled = await client.getBooleanValue(flagKey, false);
          if (!enabled) {
            logStructured({
              level: "info",
              type: "gmode.flags.gate_closed",
              requestId: context.requestId,
              mount,
              flag: flagKey,
            });
            throw gateError(gateBehavior);
          }
        }
      }
    }

    const keys =
      typeof options.forward === "function"
        ? options.forward(context)
        : options.forward ?? [];

    if (keys.length > 0) {
      const entries = await Promise.all(
        keys.map(async (key) => {
          // Flagship's `get()` (no defaultValue) throws when a flag is
          // missing from the app, despite the docs' "never throws" wording.
          // Swallow per-flag failures here so a misconfigured flag never
          // 500s the request — log a structured warning so it's visible.
          try {
            const value = await client.get(key);
            return [key, value] as const;
          } catch (err) {
            logStructured({
              level: "warn",
              type: "gmode.flags.forward_failed",
              flag: key,
              requestId: context.requestId,
              message: err instanceof Error ? err.message : String(err),
            });
            return [key, undefined] as const;
          }
        }),
      );
      const forwarded: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        if (v !== undefined) forwarded[k] = v;
      }
      context.state.set(FORWARDED_FLAGS_STATE_KEY, forwarded);
    }

    return next();
  };
}
