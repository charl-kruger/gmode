import {
  createGateway,
  requestId,
  jsonErrors,
  cors,
  jwtAuth,
  cloudflareRateLimit,
  requestLogger,
  featureFlags,
} from "@gmode/gateway";
import { mountMcp } from "@gmode/mcp";
import type {
  CloudflareRateLimitBinding,
  FetcherLike,
  FlagshipBinding,
} from "@gmode/core";

type Env = {
  USERS_API: FetcherLike;
  BILLING_API: FetcherLike;
  API_RATE_LIMITER: CloudflareRateLimitBinding;
  FLAGS: FlagshipBinding;
  JWT_SECRET: string;
  INTERNAL_SIGNING_SECRET: string;
};

const gateway = createGateway<Env>({
  name: "Example API",
  version: "1.0.0",
  internal: {
    signingSecret: (env) => env.INTERNAL_SIGNING_SECRET,
  },
  cache: {
    enabled: true,
    default: {
      cacheControl: "public, max-age=60, stale-while-revalidate=300",
    },
  },
});

gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(requestLogger());
gateway.use(cors());
gateway.use(
  jwtAuth({
    secret: (env) => env.JWT_SECRET,
    required: false,
  }),
);
gateway.use(
  cloudflareRateLimit({
    binding: "API_RATE_LIMITER",
    key: (ctx) => ctx.auth.user?.id ?? ctx.auth.tenant?.id ?? "anonymous",
    // Local-dev safety: `wrangler dev` may not inject the rate-limit binding
    // depending on version. failOpen logs a structured warning and lets the
    // request through instead of 500ing. Flip to `false` in production if
    // you'd rather fail closed on missing/erroring bindings.
    failOpen: true,
  }),
);
gateway.use(
  featureFlags<Env, "FLAGS">({
    binding: "FLAGS",
    gates: { "/billing": "billing-enabled" },
    forward: ["new-checkout"],
    // Local-dev safety: older Wrangler versions silently ignore the
    // "flagship" block in wrangler.jsonc, leaving env.FLAGS undefined.
    // failOpen lets the gateway start serving anyway; flip to `false` in
    // production if you want the misconfiguration to surface as a 500.
    failOpen: true,
  }),
);
gateway.use(
  mountMcp<Env>({
    path: "/mcp",
    // Default mode is "catalog" — agents get two tools (`discover` + `invoke`)
    // and introspect the API on demand. For small/medium APIs you can opt
    // into mode: "tools" to expose one MCP tool per OpenAPI operation.
    serverInfo: { name: "Example API MCP", version: "1.0.0" },
  }),
);

gateway.service("users", {
  mount: "/users",
  binding: "USERS_API",
  audience: "users",
  auth: false,
  openapi: true,
});

gateway.service("billing", {
  mount: "/billing",
  binding: "BILLING_API",
  audience: "billing",
  auth: true,
  scopes: ["billing:*"],
  cache: false,
  openapi: true,
});

export default gateway;
