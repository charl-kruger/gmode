import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGmode } from "../harness/cli";
import { WEB_APP_TANSTACK } from "../harness/paths";

const FIXTURE_SPEC = join(WEB_APP_TANSTACK, ".e2e-fixture-openapi.json");
const OUT_DIR = join(WEB_APP_TANSTACK, "generated-e2e");

function writeFixtureSpec(): void {
  writeFileSync(
    FIXTURE_SPEC,
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "E2E Fixture", version: "1.0.0" },
      paths: {
        "/users/{id}": {
          get: {
            operationId: "getUser",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }),
    "utf8",
  );
}

describe("CLI smoke (web-app-tanstack)", () => {
  it("sync updates manifest-driven gateway artifacts", async () => {
    const result = await runGmode(WEB_APP_TANSTACK, ["sync"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Synced \d+ entries/);
    expect(
      existsSync(join(WEB_APP_TANSTACK, "gateway/src/gmode.generated.ts")),
    ).toBe(true);
  });

  it("doctor passes on a synced workspace", async () => {
    const result = await runGmode(WEB_APP_TANSTACK, ["doctor"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("All checks passed");
    expect(result.stdout).toContain("GMODE_CONTEXT_SECRET");
  });

  it("generate client from --spec writes gmode-client.ts", async () => {
    writeFixtureSpec();
    mkdirSync(OUT_DIR, { recursive: true });
    const result = await runGmode(WEB_APP_TANSTACK, [
      "generate",
      "client",
      "--spec",
      FIXTURE_SPEC,
      "--out",
      OUT_DIR,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Generated typed client/);
    expect(existsSync(join(OUT_DIR, "gmode-client.ts"))).toBe(true);
  });

  it("generate types runs wrangler types for every worker", async () => {
    const result = await runGmode(WEB_APP_TANSTACK, ["generate", "types"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("✓ gateway: wrangler types");
    expect(result.stdout).toContain("✓ users: wrangler types");
    expect(result.stdout).toContain("✓ gmode sync");
  });
});
