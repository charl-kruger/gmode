import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export type PackageManager = {
  name: PackageManagerName;
  runCmd(script: string, args?: string[]): string[];
  execCmd(bin: string, args: string[]): string[];
  installCmd(): string[];
};

function makePackageManager(name: PackageManagerName): PackageManager {
  return {
    name,
    runCmd(script, args = []) {
      if (name === "npm") {
        return args.length > 0
          ? ["npm", "run", script, "--", ...args]
          : ["npm", "run", script];
      }
      if (name === "bun") return ["bun", "run", script, ...args];
      return [name, script, ...args];
    },
    execCmd(bin, args) {
      if (name === "npm") return ["npx", bin, ...args];
      if (name === "pnpm") return ["pnpm", "exec", bin, ...args];
      if (name === "bun") return ["bunx", bin, ...args];
      return ["yarn", bin, ...args];
    },
    installCmd() {
      return [name, "install"];
    },
  };
}

export function detectPackageManager(
  env: Record<string, string | undefined> = process.env,
): PackageManager {
  const userAgent = env.npm_config_user_agent ?? "";
  for (const name of ["npm", "pnpm", "yarn", "bun"] as const) {
    if (userAgent.startsWith(`${name}/`)) return makePackageManager(name);
  }
  return makePackageManager("npm");
}

export function packageManagerByName(name: PackageManagerName): PackageManager {
  return makePackageManager(name);
}

export function formatCommand(parts: string[]): string {
  return parts.join(" ");
}

export function runCommandPrefix(pm: PackageManager): string {
  if (pm.name === "npm") return "npm run";
  if (pm.name === "bun") return "bun run";
  return pm.name;
}

export function execCommandPrefix(pm: PackageManager): string {
  if (pm.name === "npm") return "npx";
  if (pm.name === "pnpm") return "pnpm exec";
  if (pm.name === "bun") return "bunx";
  return "yarn";
}

export function resolveWorkspaceBin(startDir: string, name: string): string {
  let dir = resolve(startDir);
  const executableNames =
    process.platform === "win32" ? [`${name}.cmd`, name] : [name];
  for (;;) {
    for (const executableName of executableNames) {
      const candidate = join(dir, "node_modules", ".bin", executableName);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${name} in node_modules/.bin from ${startDir}`,
      );
    }
    dir = parent;
  }
}
