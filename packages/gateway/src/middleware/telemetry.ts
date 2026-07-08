import type { MaybePromise } from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

/** Data point shape accepted by Cloudflare Analytics Engine bindings. */
export type AnalyticsEngineDataPoint = {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
};

/** Minimal Analytics Engine binding shape used by GMode telemetry. */
export type AnalyticsEngineDataset = {
  writeDataPoint(point: AnalyticsEngineDataPoint): void;
};

/** Normalized request span exported by `gatewayTelemetry()`. */
export type GatewayTelemetrySpan = {
  name: "gmode.gateway.request";
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  service?: string;
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
};

/** Custom telemetry exporter hook. */
export type GatewayTelemetryExporter = {
  export(span: GatewayTelemetrySpan): MaybePromise<void>;
};

/** Analytics Engine sink configuration for gateway telemetry. */
export type AnalyticsEngineTelemetryOptions<
  Env,
  Binding extends keyof Env & string,
> = {
  /** Analytics Engine binding name in the gateway Worker env. */
  binding: Binding;
  /** Build the Analytics Engine index value. Defaults to request path. */
  index?: (span: GatewayTelemetrySpan) => string;
};

/** Options for exporting gateway request telemetry. */
export type GatewayTelemetryOptions<
  Env,
  Binding extends keyof Env & string,
> = {
  /** Optional Cloudflare Analytics Engine sink. */
  analytics?: AnalyticsEngineTelemetryOptions<Env, Binding>;
  /** Additional custom exporters, for example traces or logs. */
  exporters?: GatewayTelemetryExporter[];
  /** Sampling rate from `0` to `1`. Defaults to `1`. */
  sample?: number;
};

/**
 * Capture request duration/status and export a gateway telemetry span.
 *
 * Use `analyticsEngine()` for the common Analytics Engine-only case.
 */
export function gatewayTelemetry<
  Env,
  Binding extends keyof Env & string,
>(
  options: GatewayTelemetryOptions<Env, Binding>,
): GatewayMiddleware<Env> {
  const sample = options.sample ?? 1;
  if (sample < 0 || sample > 1) {
    throw new Error("Telemetry sample must be between 0 and 1");
  }

  return async (context, next) => {
    const start = Date.now();
    let response: Response;
    try {
      response = await next();
    } catch (err) {
      const span = buildSpan(context, 500, Date.now() - start);
      if (Math.random() <= sample) {
        await writeTelemetry(context, options, span);
      }
      throw err;
    }

    const span = buildSpan(context, response.status, Date.now() - start);
    if (Math.random() <= sample) {
      await writeTelemetry(context, options, span);
    }
    return response;
  };
}

/**
 * Convenience middleware for writing gateway request spans to Analytics Engine.
 */
export function analyticsEngine<
  Env,
  Binding extends keyof Env & string,
>(
  options: AnalyticsEngineTelemetryOptions<Env, Binding> & { sample?: number },
): GatewayMiddleware<Env> {
  return gatewayTelemetry({
    analytics: {
      binding: options.binding,
      ...(options.index ? { index: options.index } : {}),
    },
    ...(options.sample !== undefined ? { sample: options.sample } : {}),
  });
}

function buildSpan<Env>(
  context: GatewayRequestContext<Env>,
  status: number,
  durationMs: number,
): GatewayTelemetrySpan {
  const span: GatewayTelemetrySpan = {
    name: "gmode.gateway.request",
    requestId: context.requestId,
    method: context.request.method,
    path: context.url.pathname,
    status,
    durationMs,
    authenticated: context.auth.authenticated,
  };
  if (context.matchedService?.name) span.service = context.matchedService.name;
  if (context.auth.user?.id) span.userId = context.auth.user.id;
  if (context.auth.tenant?.id) span.tenantId = context.auth.tenant.id;
  return span;
}

async function writeTelemetry<
  Env,
  Binding extends keyof Env & string,
>(
  context: GatewayRequestContext<Env>,
  options: GatewayTelemetryOptions<Env, Binding>,
  span: GatewayTelemetrySpan,
): Promise<void> {
  if (options.analytics) {
    const dataset = context.env[options.analytics.binding];
    if (!isAnalyticsEngineDataset(dataset)) {
      throw new Error(
        `Analytics Engine binding "${options.analytics.binding}" is not configured`,
      );
    }
    dataset.writeDataPoint(toAnalyticsDataPoint(span, options.analytics));
  }

  for (const exporter of options.exporters ?? []) {
    await exporter.export(span);
  }
}

function toAnalyticsDataPoint<Env, Binding extends keyof Env & string>(
  span: GatewayTelemetrySpan,
  analytics: AnalyticsEngineTelemetryOptions<Env, Binding>,
): AnalyticsEngineDataPoint {
  return {
    indexes: [analytics.index ? analytics.index(span) : span.path],
    blobs: [
      span.requestId,
      span.method,
      span.path,
      span.service ?? "",
      span.userId ?? "",
      span.tenantId ?? "",
    ],
    doubles: [
      span.status,
      span.durationMs,
      span.authenticated ? 1 : 0,
    ],
  };
}

function isAnalyticsEngineDataset(
  value: unknown,
): value is AnalyticsEngineDataset {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["writeDataPoint"] === "function";
}
