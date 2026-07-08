import { describe, expect, it } from "vitest";
import { type FetcherLike } from "@gmode/core";
import { createGateway } from "./create-gateway";
import {
  analyticsEngine,
  gatewayTelemetry,
  type AnalyticsEngineDataPoint,
  type AnalyticsEngineDataset,
  type GatewayTelemetrySpan,
} from "./middleware/telemetry";

const SIGNING = "internal-signing-secret";

function execCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function mockFetcher(): FetcherLike {
  return {
    async fetch() {
      return Response.json({ ok: true });
    },
  };
}

function createAnalytics(): AnalyticsEngineDataset & {
  points: AnalyticsEngineDataPoint[];
} {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    points,
    writeDataPoint(point) {
      points.push(point);
    },
  };
}

describe("gatewayTelemetry", () => {
  it("writes Analytics Engine request events without request bodies", async () => {
    type Env = {
      USERS_API: FetcherLike;
      ANALYTICS: AnalyticsEngineDataset;
      INTERNAL_SIGNING_SECRET: string;
    };
    const analytics = createAnalytics();
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(
      analyticsEngine<Env, "ANALYTICS">({
        binding: "ANALYTICS",
        index: (span) => `${span.method}:${span.path}`,
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users", {
        method: "POST",
        body: JSON.stringify({ secret: "not exported" }),
      }),
      {
        USERS_API: mockFetcher(),
        ANALYTICS: analytics,
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    expect(analytics.points).toHaveLength(1);
    expect(analytics.points[0]).toMatchObject({
      indexes: ["POST:/users"],
      blobs: [expect.any(String), "POST", "/users", "users", "", ""],
      doubles: [200, expect.any(Number), 0],
    });
    expect(JSON.stringify(analytics.points[0])).not.toContain("not exported");
  });

  it("exports OTEL-compatible spans through explicit exporters", async () => {
    type Env = {
      USERS_API: FetcherLike;
      INTERNAL_SIGNING_SECRET: string;
    };
    const spans: GatewayTelemetrySpan[] = [];
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(
      gatewayTelemetry<Env, never>({
        exporters: [
          {
            async export(span) {
              spans.push(span);
            },
          },
        ],
      }),
    );
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users"),
      {
        USERS_API: mockFetcher(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(200);
    expect(spans).toEqual([
      expect.objectContaining({
        name: "gmode.gateway.request",
        method: "GET",
        path: "/users",
        service: "users",
        status: 200,
      }),
    ]);
  });

  it("fails loudly when the Analytics Engine binding is missing", async () => {
    type Env = {
      USERS_API: FetcherLike;
      ANALYTICS?: AnalyticsEngineDataset;
      INTERNAL_SIGNING_SECRET: string;
    };
    const gateway = createGateway<Env>({
      name: "T",
      version: "1.0.0",
      internal: { signingSecret: (e) => e.INTERNAL_SIGNING_SECRET },
    });
    gateway.use(analyticsEngine<Env, "ANALYTICS">({ binding: "ANALYTICS" }));
    gateway.service("users", { mount: "/users", binding: "USERS_API" });

    const res = await gateway.fetch(
      new Request("https://api.test/users"),
      {
        USERS_API: mockFetcher(),
        INTERNAL_SIGNING_SECRET: SIGNING,
      },
      execCtx(),
    );

    expect(res.status).toBe(500);
  });
});
