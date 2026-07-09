import { createService, z } from "@gmode/service";

type Env = { ASSETS: Fetcher };

/** API routes served by this web app under `__MOUNT__/api`. */
export const api = createService<Env>({
  name: "__NAME__ API",
  version: "0.1.0",
});

api.get("/hello", {
  operationId: "__CAMEL_NAME__Hello",
  summary: "Hello from the __NAME__ app",
  tags: ["__PASCAL_NAME__"],
  responses: {
    200: z.object({ message: z.string() }),
  },
  handler: async () => ({ message: "Hello from __NAME__" }),
});
