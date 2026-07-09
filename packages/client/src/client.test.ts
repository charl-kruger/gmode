import { describe, expect, it } from "vitest";
import { ApiClientError, createClient } from "./index";

type User = { id: string; email: string };

type Api = {
  getUser: { params: { id: string }; response: User };
  listUsers: {
    query: { limit?: number; tags?: string[] };
    response: { data: User[] };
  };
  createUser: { body: { email: string }; response: User };
};

function makeClient(
  handler: (url: string, init: RequestInit | undefined) => Response,
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createClient<Api>({
    baseUrl: "https://api.example.com",
    operations: {
      getUser: { method: "GET", path: "/users/{id}" },
      listUsers: { method: "GET", path: "/users" },
      createUser: { method: "POST", path: "/users" },
    },
    headers: { "x-api-key": "k" },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : String(input);
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch,
  });
  return { client, calls };
}

describe("createClient", () => {
  it("substitutes path params and returns the typed body", async () => {
    const { client, calls } = makeClient(() =>
      Response.json({ id: "u_1", email: "a@b.c" }),
    );
    const user = await client.getUser({ params: { id: "u 1" } });
    expect(user).toEqual({ id: "u_1", email: "a@b.c" });
    expect(calls[0]!.url).toBe("https://api.example.com/users/u%201");
    expect(new Headers(calls[0]!.init?.headers).get("x-api-key")).toBe("k");
  });

  it("serializes query params including arrays", async () => {
    const { client, calls } = makeClient(() => Response.json({ data: [] }));
    await client.listUsers({ query: { limit: 5, tags: ["a", "b"] } });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.getAll("tags")).toEqual(["a", "b"]);
  });

  it("sends JSON bodies with content-type", async () => {
    const { client, calls } = makeClient(() =>
      Response.json({ id: "u_2", email: "x@y.z" }),
    );
    await client.createUser({ body: { email: "x@y.z" } });
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ email: "x@y.z" }));
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("throws structured ApiClientError on gateway error bodies", async () => {
    const { client } = makeClient(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "USER_NOT_FOUND",
              message: "User not found",
              status: 404,
              requestId: "req_9",
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    );
    const err = await client
      .getUser({ params: { id: "missing" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe("USER_NOT_FOUND");
    expect(apiErr.requestId).toBe("req_9");
  });

  it("allows calls without args when nothing is required", async () => {
    const { client } = makeClient(() => Response.json({ data: [] }));
    const result = await client.listUsers();
    expect(result).toEqual({ data: [] });
  });
});
