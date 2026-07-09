import { createService, z } from "@gmode/service";

type Env = Record<string, never>;

/** API routes served by this web app under `/app/api`. */
export const api = createService<Env>({
  name: "Dashboard API",
  version: "1.0.0",
});

const Todo = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

api.get("/todos", {
  operationId: "dashboardListTodos",
  summary: "List dashboard todos",
  tags: ["Dashboard"],
  responses: {
    200: z.object({ data: z.array(Todo) }),
  },
  handler: async () => ({
    data: [
      { id: "t_1", title: "Ship the gateway", done: true },
      { id: "t_2", title: "Add a web app", done: true },
      { id: "t_3", title: "Aggregate its API into Swagger", done: false },
    ],
  }),
});
