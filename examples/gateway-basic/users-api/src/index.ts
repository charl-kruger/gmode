import { createService, z } from "@gmode/service";
import { createRpcService, defineEntrypoint } from "@gmode/rpc";
import type { FlagshipBinding } from "@gmode/core";

type Env = {
  INTERNAL_SIGNING_SECRET: string;
  FLAGS: FlagshipBinding;
};

const service = createService<Env>({
  name: "Users API",
  version: "1.0.0",
  trustGateway: {
    signingSecret: (env) => env.INTERNAL_SIGNING_SECRET,
    audience: "users",
  },
  flags: { binding: (env) => env.FLAGS },
});

const User = z.object({
  id: z.string(),
  email: z.string().email(),
});

service.get("/:id", {
  operationId: "getUser",
  summary: "Get user",
  tags: ["Users"],
  scopes: ["users:read"],
  params: z.object({
    id: z.string(),
  }),
  responses: {
    200: User,
    404: service.errors.schema,
  },
  handler: async ({ params, flags }) => {
    if (params.id === "missing") {
      throw service.error.notFound("USER_NOT_FOUND", "User not found");
    }
    const showEmail =
      (await flags?.getBooleanValue("show-email", true)) ?? true;
    return {
      id: params.id,
      email: showEmail ? "demo@example.com" : "",
    };
  },
});

service.get("/v2/:id", {
  operationId: "getUserV2",
  summary: "Get user (v2)",
  tags: ["Users"],
  scopes: ["users:read"],
  featureFlag: "users-v2",
  params: z.object({
    id: z.string(),
  }),
  responses: {
    200: User,
    404: service.errors.schema,
  },
  handler: async ({ params }) => ({
    id: params.id,
    email: "v2@example.com",
  }),
});

service.get("/", {
  operationId: "listUsers",
  summary: "List users",
  tags: ["Users"],
  scopes: ["users:read"],
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
  responses: {
    200: z.object({
      data: z.array(User),
      pagination: z.object({
        hasMore: z.boolean(),
        nextCursor: z.string().optional(),
      }),
    }),
  },
  handler: async ({ query, paginated }) => {
    const limit = query["limit"] as number;
    const data = Array.from({ length: limit }, (_, i) => ({
      id: `user_${i + 1}`,
      email: `user${i + 1}@example.com`,
    }));
    return paginated(data, { hasMore: false });
  },
});

const rpc = createRpcService<Env>({
  name: "Users API",
  trustGateway: {
    signingSecret: (env) => env.INTERNAL_SIGNING_SECRET,
    audience: "users",
  },
}).method("getUserById", {
  description: "Look up a user by ID over service-to-service RPC",
  scopes: ["users:read"],
  input: z.object({ id: z.string() }),
  output: User,
  handler: async ({ input }) => {
    if (input.id === "missing") {
      throw new Error("USER_NOT_FOUND");
    }
    return { id: input.id, email: `${input.id}@example.com` };
  },
});

export type UsersApiRpc = typeof rpc.client;

export default defineEntrypoint(rpc, { http: service });
