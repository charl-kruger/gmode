import { createService, z } from "@gmode/service";

type Env = Record<string, never>;

const service = createService<Env>({
  name: "__NAME__",
  version: "0.1.0",
  trustGateway: {
    audience: "__NAME__",
  },
});

const Item = z.object({
  id: z.string(),
  name: z.string(),
});

service.get("/", {
  operationId: "list__PASCAL_NAME__",
  summary: "List items",
  tags: ["__PASCAL_NAME__"],
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
  responses: {
    200: z.object({ data: z.array(Item) }),
  },
  handler: async ({ query }) => {
    const limit = query["limit"] as number;
    return {
      data: Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        id: `item_${i + 1}`,
        name: `Example item ${i + 1}`,
      })),
    };
  },
});

service.get("/:id", {
  operationId: "get__PASCAL_NAME__",
  summary: "Get an item",
  tags: ["__PASCAL_NAME__"],
  params: z.object({ id: z.string() }),
  responses: {
    200: Item,
    404: service.errors.schema,
  },
  handler: async ({ params }) => {
    if (params.id === "missing") {
      throw service.error.notFound("NOT_FOUND", "Item not found");
    }
    return { id: params.id, name: `Item ${params.id}` };
  },
});

export default service;
