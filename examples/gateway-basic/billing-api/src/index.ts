import { createService, z } from "@gmode/service";
import { createRpcClient } from "@gmode/rpc";
import { GMODE_HEADERS } from "@gmode/core";
import type { UsersApiRpc } from "../../users-api/src/index";

type Env = {
  USERS_API: UsersApiRpc;
};

const service = createService<Env>({
  name: "Billing API",
  version: "1.0.0",
  trustGateway: {
    audience: "billing",
  },
});

const Invoice = z.object({
  id: z.string(),
  total: z.number(),
  currency: z.string(),
});

const InvoiceWithUser = Invoice.extend({
  userId: z.string(),
  userEmail: z.string(),
});

service.get("/invoices/:id", {
  operationId: "getInvoice",
  summary: "Get invoice",
  tags: ["Billing"],
  scopes: ["billing:read"],
  params: z.object({
    id: z.string(),
  }),
  responses: {
    200: Invoice,
    404: service.errors.schema,
  },
  handler: async ({ params }) => {
    return {
      id: params.id,
      total: 4999,
      currency: "USD",
    };
  },
});

service.post("/invoices", {
  operationId: "createInvoice",
  summary: "Create invoice (looks up user via RPC)",
  tags: ["Billing"],
  scopes: ["billing:write"],
  body: z.object({
    total: z.number().int().positive(),
    currency: z.string().length(3),
    userId: z.string(),
  }),
  responses: {
    201: InvoiceWithUser,
    400: service.errors.schema,
  },
  handler: async ({ body, env, request, created }) => {
    const input = body as {
      total: number;
      currency: string;
      userId: string;
    };

    const users = createRpcClient<{
      getUserById: {
        input: { id: string; };
        output: { id: string; email: string; };
      };
    }>({
      binding: env.USERS_API,
      context: () =>
        request.headers.get(GMODE_HEADERS.gatewayContext) ?? undefined,
    });

    const user = await users.getUserById({ id: input.userId });

    return created({
      id: `inv_${crypto.randomUUID()}`,
      total: input.total,
      currency: input.currency,
      userId: user.id,
      userEmail: user.email,
    });
  },
});

export default service;
