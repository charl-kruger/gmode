import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../harness/cli";
import { createGmodeBin } from "../harness/paths";
import { createTempWorkspace } from "../harness/workspace";

describe("create-gmode smoke", () => {
  it("scaffolds a workspace via the create-gmode wrapper", async () => {
    const workspace = createTempWorkspace("create-gmode-");
    const result = await runCommand(
      process.execPath,
      [createGmodeBin(), "acme-app"],
      workspace.dir,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Created GMode workspace");

    const appDir = join(workspace.dir, "acme-app");
    expect(existsSync(join(appDir, "gmode.jsonc"))).toBe(true);
    expect(existsSync(join(appDir, "gateway/src/gmode.generated.ts"))).toBe(
      true,
    );

    const devVars = readFileSync(join(appDir, "gateway/.dev.vars"), "utf8");
    expect(devVars).toMatch(/^GMODE_CONTEXT_SECRET=[0-9a-f]{64}$/m);

    workspace.cleanup();
  });
});
