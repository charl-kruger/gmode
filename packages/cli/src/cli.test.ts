import { defineSequences } from "@gmode/core";
import { describe, expect, it } from "vitest";
import { buildDashboardImport } from "./commands/sync-sequences";
import { run } from "./run";
import type { CliEnv } from "./types";

type RecordedFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

type Harness = {
  cli: CliEnv;
  stdout: string[];
  stderr: string[];
  exits: number[];
  fetchCalls: FetchCall[];
};

function harness(input?: {
  fetchImpl?: RecordedFetch;
  env?: Record<string, string>;
  files?: Record<string, string>;
}): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exits: number[] = [];
  const files = new Map<string, string>(Object.entries(input?.files ?? {}));
  const fetchCalls: FetchCall[] = [];
  const fetchImpl: RecordedFetch =
    input?.fetchImpl ??
    (async () => new Response("not configured", { status: 500 }));
  const env: Record<string, string> = {
    CLOUDFLARE_API_TOKEN: "test-token",
    CLOUDFLARE_ZONE_ID: "zone-abc",
    ...(input?.env ?? {}),
  };

  return {
    cli: {
      cwd: "/work",
      env,
      fetch: (url, init) => {
        const requestUrl = url instanceof URL ? url.toString() : String(url);
        fetchCalls.push({ url: requestUrl, init });
        return fetchImpl(url, init);
      },
      stdout: (line) => {
        stdout.push(line);
      },
      stderr: (line) => {
        stderr.push(line);
      },
      exit: (code) => {
        exits.push(code);
        throw new Error(`exit-${code}`);
      },
      readFile: async (path) => {
        const contents = files.get(path);
        if (contents === undefined) {
          throw new Error(`ENOENT: ${path}`);
        }
        return contents;
      },
      writeFile: async () => {},
      mkdir: async () => {},
    },
    stdout,
    stderr,
    exits,
    fetchCalls,
  };
}

describe("CLI entrypoint", () => {
  it("prints help when no command is given", async () => {
    const h = harness();

    const code = await run([], h.cli);

    expect(code).toBe(0);
    expect(h.stdout.join("\n")).toMatch(
      /gmode — Cloudflare API platform helper/,
    );
    expect(h.stdout.join("\n")).toContain("shield:push-schema");
  });

  it("errors on unknown commands", async () => {
    const h = harness();

    const code = await run(["service:generate"], h.cli);

    expect(code).toBe(2);
    expect(h.stderr.join("")).toMatch(/Unknown command: service:generate/);
  });
});

describe("shield:push-schema", () => {
  it("uploads a local OpenAPI document to Cloudflare API Shield", async () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Demo", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const h = harness({
      files: {
        "/work/openapi.json": JSON.stringify(spec),
      },
      fetchImpl: async () =>
        Response.json({
          success: true,
          errors: [],
          messages: [],
          result: { id: "schema-123", name: "manual" },
        }),
    });

    const code = await run(
      ["shield:push-schema", "--from", "openapi.json", "--name", "manual"],
      h.cli,
    );

    expect(code).toBe(0);
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone-abc/api_gateway/user_schemas",
    );
    expect(h.fetchCalls[0]!.init?.method).toBe("POST");
    expect(h.stdout.join("\n")).toContain(
      'Uploaded schema "manual" (id: schema-123)',
    );
  });
});

describe("sync sequences", () => {
  it("builds dashboard import JSON from defineSequences output", () => {
    const policy = defineSequences([
      {
        name: "checkout",
        description: "Checkout flow",
        pattern: [
          {
            operationId: "startCheckout",
            method: "POST",
            endpoint: "/checkout",
          },
          {
            operationId: "payInvoice",
            method: "POST",
            endpoint: "/payments",
          },
        ],
        action: "block",
        withinSeconds: 120,
      },
    ]);

    const dashboardImport = buildDashboardImport(policy);

    expect(dashboardImport).toEqual({
      sequences: [
        {
          name: "checkout",
          description: "Checkout flow",
          operations: [
            {
              operationId: "startCheckout",
              method: "POST",
              endpoint: "/checkout",
            },
            {
              operationId: "payInvoice",
              method: "POST",
              endpoint: "/payments",
            },
          ],
          action: "block",
          withinSeconds: 120,
        },
      ],
    });
  });
});
