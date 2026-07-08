# Telemetry

GMode includes gateway telemetry middleware for request-level metrics. It
does not read or export request bodies.

## Analytics Engine

```ts
import { analyticsEngine } from "@gmode/gateway";

type Env = {
  ANALYTICS: AnalyticsEngineDataset;
};

gateway.use(
  analyticsEngine<Env, "ANALYTICS">({
    binding: "ANALYTICS",
    index: (span) => span.tenantId ?? span.path,
  }),
);
```

The middleware writes one Analytics Engine data point per sampled request:

- `indexes`: configured index or request path
- `blobs`: request id, method, path, matched service, user id, tenant id
- `doubles`: status, duration in milliseconds, authenticated flag

If the binding is missing or malformed, the middleware throws.

## OTEL Exporters

Use `gatewayTelemetry()` to send request spans to an explicit exporter:

```ts
import { gatewayTelemetry, type GatewayTelemetryExporter } from "@gmode/gateway";

const exporter: GatewayTelemetryExporter = {
  async export(span) {
    await sendToCollector({
      name: span.name,
      attributes: {
        "http.request.method": span.method,
        "url.path": span.path,
        "http.response.status_code": span.status,
        "gmode.request_id": span.requestId,
        "gmode.service": span.service,
      },
      durationMs: span.durationMs,
    });
  },
};

gateway.use(gatewayTelemetry({ exporters: [exporter] }));
```

`GatewayTelemetrySpan` contains:

- `name`
- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `service`
- `authenticated`
- `userId`
- `tenantId`

## Sampling

Both middleware entry points accept `sample`, a number between `0` and `1`:

```ts
gateway.use(analyticsEngine({ binding: "ANALYTICS", sample: 0.1 }));
```

Sampling only controls whether telemetry is written. It does not change request
handling, auth, forwarding, or response behavior.
