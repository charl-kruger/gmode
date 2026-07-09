import { createService, z } from "@gmode/service";

type Env = Record<string, never>;

const service = createService<Env>({
  name: "Users API",
  version: "1.0.0",
  trustGateway: {
    audience: "users",
  },
});

const User = z.object({
  id: z.string(),
  email: z.string().email(),
});

service.get("/:id", {
  operationId: "getUser",
  summary: "Get user",
  tags: ["Users"],
  params: z.object({ id: z.string() }),
  responses: {
    200: User,
    404: service.errors.schema,
  },
  handler: async ({ params }) => {
    if (params.id === "missing") {
      throw service.error.notFound("USER_NOT_FOUND", "User not found");
    }
    return { id: params.id, email: `${params.id}@example.com` };
  },
});

service.get("/", {
  operationId: "listUsers",
  summary: "List users",
  tags: ["Users"],
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
  responses: {
    200: z.object({ data: z.array(User) }),
  },
  handler: async ({ query }) => {
    const limit = query["limit"] as number;
    return {
      data: Array.from({ length: limit }, (_, i) => ({
        id: `user_${i + 1}`,
        email: `user${i + 1}@example.com`,
      })),
    };
  },
});

export default service;
