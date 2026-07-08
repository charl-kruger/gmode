export { createGateway } from "./create-gateway";
export type {
  Gateway,
  GatewayApiVersion,
  GatewayApiVersionDeprecation,
  GatewayCacheMethod,
  GatewayCacheOptions,
  GatewayCacheResolver,
  GatewayDownstreamCachePolicy,
  GatewayOptions,
  GatewayServiceConfig,
  GatewayVersion,
  GatewayMiddleware,
  GatewayRequestContext,
  RegisteredGatewayServiceConfig,
} from "./types";

export { jwtAuth, apiKeyAuth } from "./middleware/auth";
export type { JwtAuthOptions, ApiKeyAuthOptions } from "./middleware/auth";
export { cors } from "./middleware/cors";
export type { CorsOptions } from "./middleware/cors";
export { requestId } from "./middleware/request-id";
export { jsonErrors } from "./middleware/json-errors";
export { cloudflareRateLimit } from "./middleware/cloudflare-rate-limit";
export type { CloudflareRateLimitOptions } from "./middleware/cloudflare-rate-limit";
export { memoryRateLimit } from "./middleware/memory-rate-limit";
export {
  DurableObjectRateLimiter,
  durableObjectRateLimit,
} from "./middleware/durable-object-rate-limit";
export type {
  DurableObjectRateLimitInput,
  DurableObjectRateLimitResult,
  DurableObjectRateLimiterNamespace,
  DurableObjectRateLimiterStub,
  DurableObjectRateLimitOptions,
  DurableObjectRateLimitState,
  DurableObjectRateLimitStorage,
} from "./middleware/durable-object-rate-limit";
export { idempotency } from "./middleware/idempotency";
export type { IdempotencyOptions } from "./middleware/idempotency";
export { requestLogger } from "./middleware/logger";
export type { RequestLoggerOptions } from "./middleware/logger";
export {
  analyticsEngine,
  gatewayTelemetry,
} from "./middleware/telemetry";
export type {
  AnalyticsEngineDataPoint,
  AnalyticsEngineDataset,
  GatewayTelemetryExporter,
  GatewayTelemetryOptions,
  AnalyticsEngineTelemetryOptions,
  GatewayTelemetrySpan,
} from "./middleware/telemetry";
export {
  featureFlags,
  FLAGS_BINDING_MISSING_STATE_KEY,
  FLAGS_GATE_BEHAVIOR_STATE_KEY,
  FLAGS_GATES_STATE_KEY,
} from "./middleware/feature-flags";
export type { FeatureFlagsOptions } from "./middleware/feature-flags";
export { mtls } from "./middleware/mtls";
export type { MtlsOptions, MtlsCertInfo } from "./middleware/mtls";
export {
  sessionHeader,
  SHIELD_SESSION_HEADER,
} from "./middleware/session-header";
export type { SessionHeaderOptions } from "./middleware/session-header";

// Lower-level surface for framework integrators (e.g. `@gmode/mcp`) that
// need to walk the gateway's services list or apply its scope/permission
// rules from a custom middleware.
export {
  authorizeForService,
  getGatewayInternals,
  GATEWAY_INTERNALS_STATE_KEY,
} from "./authorize";
export type {
  AnyServiceConfig,
  GatewayInternalsHandle,
} from "./authorize";
export { forwardToService } from "./forward";
export type { ForwardInput } from "./forward";
export { aggregateOpenApi } from "./openapi-aggregate";
export type { GatewayServiceEntry } from "./types";
