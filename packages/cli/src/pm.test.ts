import { describe, expect, it } from "vitest";
import { detectPackageManager } from "./pm";

describe("detectPackageManager", () => {
  it.each([
    [
      "npm/10.0.0 node/v24.0.0 darwin x64",
      "npm",
      ["npm", "install"],
      ["npm", "run", "dev", "--", "--port", "5173"],
      ["npx", "wrangler", "types"],
    ],
    [
      "pnpm/11.7.0 npm/? node/v24.0.0 darwin x64",
      "pnpm",
      ["pnpm", "install"],
      ["pnpm", "dev", "--port", "5173"],
      ["pnpm", "exec", "wrangler", "types"],
    ],
    [
      "yarn/1.22.22 npm/? node/v24.0.0 darwin x64",
      "yarn",
      ["yarn", "install"],
      ["yarn", "dev", "--port", "5173"],
      ["yarn", "wrangler", "types"],
    ],
    [
      "bun/1.2.0 npm/? node/v24.0.0 darwin x64",
      "bun",
      ["bun", "install"],
      ["bun", "run", "dev", "--port", "5173"],
      ["bunx", "wrangler", "types"],
    ],
  ] as const)("detects %s", (userAgent, name, installCmd, runCmd, execCmd) => {
    const pm = detectPackageManager({ npm_config_user_agent: userAgent });

    expect(pm.name).toBe(name);
    expect(pm.installCmd()).toEqual(installCmd);
    expect(pm.runCmd("dev", ["--port", "5173"])).toEqual(runCmd);
    expect(pm.execCmd("wrangler", ["types"])).toEqual(execCmd);
  });

  it("falls back to npm", () => {
    const pm = detectPackageManager({});

    expect(pm.name).toBe("npm");
    expect(pm.runCmd("dev", ["--port", "5173"])).toEqual([
      "npm",
      "run",
      "dev",
      "--",
      "--port",
      "5173",
    ]);
    expect(pm.execCmd("wrangler", ["types"])).toEqual([
      "npx",
      "wrangler",
      "types",
    ]);
  });
});
