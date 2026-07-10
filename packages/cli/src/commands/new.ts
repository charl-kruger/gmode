import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { appendToTopLevelArray } from "../jsonc";
import {
  findManifestPath,
  loadManifest,
  toWorkerName,
  type WebFramework,
} from "../manifest";
import {
  detectPackageManager,
  formatCommand,
  packageManagerByName,
  runCommandPrefix,
} from "../pm";
import { scaffoldTemplate } from "../scaffold";
import { runSync } from "./sync";
import type { CliEnv, CommandRunner } from "../types";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

const WEB_TEMPLATES: Record<Exclude<WebFramework, "custom">, string> = {
  "tanstack-start": "web-tanstack",
  "vite-react": "web-vite",
};

function validName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * `gmode new service <name> [--mount /path]`
 * `gmode new web <name> [--framework tanstack-start|vite-react] [--mount /path]`
 *
 * Scaffolds the Worker, registers it in gmode.jsonc, and re-runs sync so the
 * gateway bindings and generated module stay consistent.
 */
export const newEntry: CommandRunner = async (args, cli: CliEnv) => {
  try {
    const [kind, name] = args.filter((a) => !a.startsWith("--"));
    if (kind !== "service" && kind !== "web") {
      cli.stderr("Usage: gmode new <service|web> <name> [--mount /path] [--framework tanstack-start|vite-react]");
      return 2;
    }
    if (!name || !validName(name)) {
      cli.stderr(
        "Provide a name in kebab-case, for example: gmode new service users",
      );
      return 2;
    }

    const manifestPath = findManifestPath(cli.cwd);
    if (!manifestPath) {
      cli.stderr("No gmode.jsonc found. Run `gmode init` first.");
      return 1;
    }
    const resolved = loadManifest(manifestPath);
    const pm = resolved.manifest.packageManager
      ? packageManagerByName(resolved.manifest.packageManager)
      : detectPackageManager(cli.env);
    if (resolved.entries.some((e) => e.name === name)) {
      cli.stderr(`An entry named "${name}" already exists in gmode.jsonc`);
      return 1;
    }

    const mount = parseFlag(args, "--mount") ?? `/${name}`;
    const appName = resolved.manifest.name;
    const workerName = toWorkerName(appName, name);

    let template: string;
    let targetDir: string;
    let framework: WebFramework | undefined;
    if (kind === "service") {
      template = "service";
      targetDir = join(resolved.rootDir, "services", name);
    } else {
      const flag = (parseFlag(args, "--framework") ?? "vite-react") as WebFramework;
      if (flag !== "tanstack-start" && flag !== "vite-react") {
        cli.stderr(
          `Unknown framework "${flag}". Use tanstack-start or vite-react.`,
        );
        return 2;
      }
      framework = flag;
      template = WEB_TEMPLATES[flag];
      targetDir = join(resolved.rootDir, "apps", name);
    }

    if (existsSync(targetDir)) {
      cli.stderr(`Directory already exists: ${targetDir}`);
      return 1;
    }

    scaffoldTemplate({
      template,
      targetDir,
      tokens: { appName, name, workerName, mount },
    });

    // Register in gmode.jsonc.
    const relPath = `./${relative(resolved.rootDir, targetDir)}`;
    const manifestText = readFileSync(manifestPath, "utf8");
    let entryJson: string;
    let arrayKey: string;
    if (kind === "service") {
      arrayKey = "services";
      entryJson = `{ "name": ${JSON.stringify(name)}, "path": ${JSON.stringify(relPath)}, "mount": ${JSON.stringify(mount)} }`;
    } else {
      arrayKey = "webApps";
      entryJson = `{ "name": ${JSON.stringify(name)}, "path": ${JSON.stringify(relPath)}, "mount": ${JSON.stringify(mount)}, "framework": ${JSON.stringify(framework)}, "api": { "mount": "/api", "openapi": true } }`;
    }
    writeFileSync(
      manifestPath,
      appendToTopLevelArray(manifestText, arrayKey, entryJson),
      "utf8",
    );

    runSync(resolved.rootDir);

    cli.stdout(`Created ${kind} "${name}"`);
    cli.stdout(`  path:    ${relPath}`);
    cli.stdout(`  mount:   ${mount}`);
    cli.stdout(`  worker:  ${workerName}`);
    cli.stdout("");
    cli.stdout(
      `Run \`${formatCommand(pm.installCmd())}\`, then \`${runCommandPrefix(pm)} dev\` to serve it through the gateway.`,
    );
    return 0;
  } catch (err) {
    cli.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
};
