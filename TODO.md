- automatically create rpc from normal api route, the developer shouldnt need to define the rpc methods like the below. our sdk should handle this in the background, and then like we have a swagger with all api routes, you have a catalog of all the rpc services.

service.get("/:id", {
operationId: "getUser",
summary: "Get user",
tags: ["Users"],
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

const rpc = createRpcService<Env>({
name: "Users API",
trustGateway: {
audience: "users",
},
}).method("getUserById", {
description: "Look up a user by ID over service-to-service RPC",
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
