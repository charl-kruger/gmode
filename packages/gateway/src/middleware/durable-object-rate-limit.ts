import { ApiError } from "@gmode/core";
import type { GatewayMiddleware, GatewayRequestContext } from "../types";

export type DurableObjectRateLimitInput = {
  key: string;
  limit: number;
  periodSeconds: number;
  now?: number;
};

export type DurableObjectRateLimitResult = {
  success: boolean;
  key: string;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
};

export type DurableObjectRateLimiterStub = {
  limit(input: DurableObjectRateLimitInput): Promise<DurableObjectRateLimitResult>;
};

export type DurableObjectRateLimiterNamespace = {
  getByName(name: string): DurableObjectRateLimiterStub;
};

export type DurableObjectRateLimitOptions<Env, Binding extends keyof Env & string> = {
  binding: Binding;
  key: (context: GatewayRequestContext<Env>) => string;
  limit: number;
  periodSeconds: number;
  namespace?: string;
};

export type DurableObjectRateLimitStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
};

export type DurableObjectRateLimitState = {
  storage: DurableObjectRateLimitStorage;
};

type StoredWindow = {
  windowStart: number;
  count: number;
};

const STORAGE_KEY = "state";

export class DurableObjectRateLimiter {
  private readonly state: DurableObjectRateLimitState;

  constructor(state: DurableObjectRateLimitState) {
    this.state = state;
  }

  async limit(
    input: DurableObjectRateLimitInput,
  ): Promise<DurableObjectRateLimitResult> {
    assertPositiveInteger(input.limit, "limit");
    assertPositiveInteger(input.periodSeconds, "periodSeconds");

    const now = input.now ?? Math.floor(Date.now() / 1000);
    const existing = await this.state.storage.get<StoredWindow>(STORAGE_KEY);
    const current = existing && now < existing.windowStart + input.periodSeconds
      ? existing
      : { windowStart: now, count: 0 };

    const success = current.count < input.limit;
    const nextCount = success ? current.count + 1 : current.count;
    const reset = current.windowStart + input.periodSeconds;
    const retryAfter = Math.max(0, reset - now);

    await this.state.storage.put<StoredWindow>(STORAGE_KEY, {
      windowStart: current.windowStart,
      count: nextCount,
    });

    return {
      success,
      key: input.key,
      limit: input.limit,
      remaining: Math.max(0, input.limit - nextCount),
      reset,
      retryAfter,
    };
  }
}

export function durableObjectRateLimit<
  Env,
  Binding extends keyof Env & string,
>(
  options: DurableObjectRateLimitOptions<Env, Binding>,
): GatewayMiddleware<Env> {
  assertPositiveInteger(options.limit, "limit");
  assertPositiveInteger(options.periodSeconds, "periodSeconds");

  return async (context, next) => {
    const namespace = context.env[options.binding];
    if (!isDurableObjectRateLimiterNamespace(namespace)) {
      throw new Error(
        `Durable Object rate-limit binding "${options.binding}" is not configured`,
      );
    }

    const key = options.key(context);
    const objectName = options.namespace
      ? `${options.namespace}:${key}`
      : key;
    const result = await namespace.getByName(objectName).limit({
      key,
      limit: options.limit,
      periodSeconds: options.periodSeconds,
    });

    if (!result.success) {
      throw new ApiError({
        code: "RATE_LIMITED",
        message: "Rate limit exceeded",
        status: 429,
        details: {
          key: result.key,
          limit: result.limit,
          reset: result.reset,
          retryAfter: result.retryAfter,
        },
      });
    }

    const response = await next();
    const headers = new Headers(response.headers);
    headers.set("x-rate-limit-policy", "durable-object");
    headers.set("x-rate-limit-limit", String(result.limit));
    headers.set("x-rate-limit-remaining", String(result.remaining));
    headers.set("x-rate-limit-reset", String(result.reset));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function isDurableObjectRateLimiterNamespace(
  value: unknown,
): value is DurableObjectRateLimiterNamespace {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["getByName"] === "function";
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Durable Object rate-limit ${name} must be a positive integer`);
  }
}
