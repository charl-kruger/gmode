import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("create-gmode package", () => {
  it("exposes a bin entry that delegates to @gmode/cli init", () => {
    const pkg = JSON.parse(
      readFileSync(join(here, "../package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    expect(pkg.bin?.["create-gmode"]).toMatch(/dist\/bin\.js$/);
    expect(existsSync(join(here, "../dist/bin.js"))).toBe(true);
  });

  it("bin imports the shared CLI runner", () => {
    const source = readFileSync(join(here, "bin.ts"), "utf8");
    expect(source).toContain("@gmode/cli");
    expect(source).toContain('run(["init"');
  });
});
