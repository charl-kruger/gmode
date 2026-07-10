import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

  it("scaffolds an npm workspace without pnpm files or instructions", async () => {
    const workspace = createTempWorkspace("create-gmode-npm-");
    const result = await runCommand(
      process.execPath,
      [createGmodeBin(), "npm-app"],
      workspace.dir,
      {
        ...process.env,
        npm_config_user_agent: "npm/10.0.0 node/v24.0.0 darwin x64",
      },
    );
    expect(result.code).toBe(0);

    const appDir = join(workspace.dir, "npm-app");
    const rootPackage = JSON.parse(
      readFileSync(join(appDir, "package.json"), "utf8"),
    ) as { workspaces?: string[]; scripts?: Record<string, string> };
    expect(rootPackage.workspaces).toEqual(["gateway", "services/*", "apps/*"]);
    expect(existsSync(join(appDir, "pnpm-workspace.yaml"))).toBe(false);

    for (const file of packageJsonAndReadmeFiles(appDir)) {
      const contents = readFileSync(file, "utf8");
      if (file.endsWith("package.json")) {
        const pkg = JSON.parse(contents) as { scripts?: Record<string, string> };
        expect(Object.values(pkg.scripts ?? {}).join("\n")).not.toContain(
          "pnpm",
        );
      } else {
        expect(contents).not.toContain("pnpm");
      }
    }

    workspace.cleanup();
  });
});

function packageJsonAndReadmeFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...packageJsonAndReadmeFiles(path));
      continue;
    }
    if (entry === "package.json" || entry === "README.md") files.push(path);
  }
  return files;
}
