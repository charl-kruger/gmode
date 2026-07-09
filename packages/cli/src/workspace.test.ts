import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendToTopLevelArray,
  parseJsonc,
  upsertTopLevelProperty,
} from "./jsonc";
import { loadManifest, toBindingName, toWorkerName } from "./manifest";
import { generateClientSource } from "./codegen/openapi-client";
import { run } from "./run";
import type { CliEnv } from "./types";

function realCli(cwd: string): {
  cli: CliEnv;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    cli: {
      cwd,
      env: {},
      fetch,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      exit: (code) => {
        throw new Error(`exit-${code}`);
      },
      readFile: (path) => readFile(path, "utf8"),
      writeFile: (path, contents) => writeFile(path, contents, "utf8"),
      mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
    },
    stdout,
    stderr,
  };
}

describe("jsonc utilities", () => {
  it("parses JSONC with comments and trailing commas", () => {
    const text = `{
      // line comment
      "name": "x", /* block */
      "list": [1, 2, 3,],
    }`;
    expect(parseJsonc(text)).toEqual({ name: "x", list: [1, 2, 3] });
  });

  it("replaces a top-level property while preserving comments", () => {
    const text = `{
  // keep me
  "name": "gw",
  "services": [{ "binding": "OLD", "service": "old" }],
  "vars": { "A": "1" }
}`;
    const next = upsertTopLevelProperty(text, "services", "[]");
    expect(next).toContain("// keep me");
    expect(next).toContain('"vars"');
    expect(parseJsonc(next)).toMatchObject({ services: [], name: "gw" });
  });

  it("inserts a missing top-level property", () => {
    const next = upsertTopLevelProperty(`{\n  "name": "gw"\n}`, "services", "[]");
    expect(parseJsonc(next)).toEqual({ name: "gw", services: [] });
  });

  it("appends to arrays, empty and non-empty", () => {
    const empty = `{ "services": [] }`;
    const one = appendToTopLevelArray(empty, "services", `{ "a": 1 }`);
    expect(parseJsonc(one)).toEqual({ services: [{ a: 1 }] });
    const two = appendToTopLevelArray(one, "services", `{ "b": 2 }`);
    expect(parseJsonc(two)).toEqual({ services: [{ a: 1 }, { b: 2 }] });
  });

  it("does not treat nested keys as top-level", () => {
    const text = `{ "outer": { "services": [1] }, "services": [] }`;
    const next = appendToTopLevelArray(text, "services", `{ "x": 1 }`);
    expect(parseJsonc(next)).toEqual({
      outer: { services: [1] },
      services: [{ x: 1 }],
    });
  });
});

describe("naming conventions", () => {
  it("derives binding names", () => {
    expect(toBindingName("users", "service")).toBe("USERS_API");
    expect(toBindingName("billing-api", "service")).toBe("BILLING_API");
    expect(toBindingName("dashboard", "web")).toBe("DASHBOARD_APP");
    expect(toBindingName("my-cool-app", "web")).toBe("MY_COOL_APP");
  });

  it("derives worker names", () => {
    expect(toWorkerName("Acme Shop", "users")).toBe("acme-shop-users");
  });
});

describe("workspace lifecycle (init, new, sync, doctor)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gmode-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("init scaffolds a workspace with a signed-context secret", async () => {
    const { cli } = realCli(dir);
    const code = await run(["init", ".", "--name", "acme"], cli);
    expect(code).toBe(0);

    expect(existsSync(join(dir, "gmode.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "gateway", "wrangler.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "gateway", "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "gateway", "src", "gmode.generated.ts"))).toBe(
      true,
    );
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);

    const devVars = readFileSync(join(dir, "gateway", ".dev.vars"), "utf8");
    expect(devVars).toMatch(/^GMODE_CONTEXT_SECRET=[0-9a-f]{64}$/m);

    const gatewayIndex = readFileSync(
      join(dir, "gateway", "src", "index.ts"),
      "utf8",
    );
    expect(gatewayIndex).toContain('createGateway<Env>({\n  name: "acme"');
    expect(gatewayIndex).toContain("registerServices(gateway)");
  });

  it("new service scaffolds, registers, and syncs bindings", async () => {
    const { cli } = realCli(dir);
    expect(await run(["init", ".", "--name", "acme"], cli)).toBe(0);
    expect(await run(["new", "service", "users"], cli)).toBe(0);

    // Manifest updated.
    const manifest = parseJsonc<{
      services: { name: string; mount: string }[];
    }>(readFileSync(join(dir, "gmode.jsonc"), "utf8"));
    expect(manifest.services).toEqual([
      { name: "users", path: "./services/users", mount: "/users" },
    ]);

    // Service scaffolded with tokens applied.
    const serviceSource = readFileSync(
      join(dir, "services", "users", "src", "index.ts"),
      "utf8",
    );
    expect(serviceSource).toContain('name: "users"');
    expect(serviceSource).toContain('audience: "users"');
    expect(serviceSource).toContain("listUsers");

    const serviceWrangler = parseJsonc<{ name: string; workers_dev: boolean }>(
      readFileSync(join(dir, "services", "users", "wrangler.jsonc"), "utf8"),
    );
    expect(serviceWrangler.name).toBe("acme-users");
    expect(serviceWrangler.workers_dev).toBe(false);

    // Gateway wrangler bindings synced.
    const gatewayWrangler = parseJsonc<{
      services: { binding: string; service: string }[];
    }>(readFileSync(join(dir, "gateway", "wrangler.jsonc"), "utf8"));
    expect(gatewayWrangler.services).toEqual([
      { binding: "USERS_API", service: "acme-users" },
    ]);

    // Generated module registers the service.
    const generated = readFileSync(
      join(dir, "gateway", "src", "gmode.generated.ts"),
      "utf8",
    );
    expect(generated).toContain("USERS_API: FetcherLike;");
    expect(generated).toContain('gateway.service("users"');
    expect(generated).toContain('mount: "/users"');
  });

  it("new web scaffolds a web app and generates a web registration", async () => {
    const { cli } = realCli(dir);
    expect(await run(["init", ".", "--name", "acme"], cli)).toBe(0);
    expect(
      await run(
        ["new", "web", "dashboard", "--framework", "vite-react", "--mount", "/app"],
        cli,
      ),
    ).toBe(0);

    expect(
      existsSync(join(dir, "apps", "dashboard", "src", "server.ts")),
    ).toBe(true);
    const serverSource = readFileSync(
      join(dir, "apps", "dashboard", "src", "server.ts"),
      "utf8",
    );
    expect(serverSource).toContain('basePath: "/app"');

    const generated = readFileSync(
      join(dir, "gateway", "src", "gmode.generated.ts"),
      "utf8",
    );
    expect(generated).toContain('gateway.web("dashboard"');
    expect(generated).toContain("DASHBOARD_APP: FetcherLike;");
    expect(generated).not.toContain("DASHBOARD_APP_DEV_URL");

    const gatewayWrangler = parseJsonc<{
      services: { binding: string; service: string }[];
    }>(readFileSync(join(dir, "gateway", "wrangler.jsonc"), "utf8"));
    expect(gatewayWrangler.services).toEqual([
      { binding: "DASHBOARD_APP", service: "acme-dashboard" },
    ]);
  });

  it("rejects duplicate mounts", async () => {
    const { cli } = realCli(dir);
    expect(await run(["init", ".", "--name", "acme"], cli)).toBe(0);
    expect(await run(["new", "service", "users"], cli)).toBe(0);
    const { cli: cli2, stderr } = realCli(dir);
    expect(
      await run(["new", "service", "accounts", "--mount", "/users"], cli2),
    ).toBe(1);
    expect(stderr.join("\n")).toMatch(/mount "\/users" is used by both/);
  });

  it("doctor passes on a fresh workspace", async () => {
    const { cli } = realCli(dir);
    expect(await run(["init", ".", "--name", "acme"], cli)).toBe(0);
    expect(await run(["new", "service", "users"], cli)).toBe(0);

    const { cli: cli2, stdout } = realCli(dir);
    // Wrangler may not be installed in the temp workspace; allow that check to fail.
    await run(["doctor"], cli2);
    const output = stdout.join("\n");
    expect(output).toContain("✓ gmode.jsonc parses and validates");
    expect(output).toContain("✓ gateway service bindings match gmode.jsonc");
    expect(output).toContain("✓ gateway src/gmode.generated.ts up to date");
    expect(output).toContain("✓ users: private (workers_dev: false)");
    expect(output).toContain("✓ gateway .dev.vars has GMODE_CONTEXT_SECRET");
    expect(output).toContain("✓ users: GMODE_CONTEXT_SECRET matches gateway");
  });

  it("loadManifest resolves worker names from wrangler configs", async () => {
    const { cli } = realCli(dir);
    expect(await run(["init", ".", "--name", "acme"], cli)).toBe(0);
    expect(await run(["new", "service", "users"], cli)).toBe(0);
    const resolved = loadManifest(join(dir, "gmode.jsonc"));
    expect(resolved.entries).toHaveLength(1);
    expect(resolved.entries[0]).toMatchObject({
      kind: "service",
      name: "users",
      workerName: "acme-users",
      binding: "USERS_API",
      mount: "/users",
    });
  });
});

describe("generate client codegen", () => {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Acme API", version: "1.0.0" },
    paths: {
      "/users/{id}": {
        get: {
          operationId: "getUser",
          summary: "Get user",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
      "/users": {
        get: {
          operationId: "listUsers",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/User" },
                      },
                    },
                    required: ["data"],
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createUser",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { email: { type: "string" } },
                  required: ["email"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            role: { enum: ["admin", "member"] },
          },
          required: ["id", "email"],
        },
      },
    },
  };

  it("generates typed operations and schema types", () => {
    const { source, operationCount, title } = generateClientSource(spec);
    expect(title).toBe("Acme API");
    expect(operationCount).toBe(3);
    expect(source).toContain(
      'export type User = { id: string; email: string; role?: "admin" | "member" };',
    );
    expect(source).toContain("getUser(args: { params: { id: string | number }");
    expect(source).toContain("Promise<User>");
    expect(source).toContain("listUsers(args?: { query?: { limit?: number }");
    expect(source).toContain("createUser(args: { body: { email: string }");
    expect(source).toContain("class ApiClientError");
    expect(source).toContain("export function createClient");
  });
});
