import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findManifestPath, type ResolvedEntry } from "../manifest";
import {
  detectPackageManager,
  packageManagerByName,
  resolveWorkspaceBin,
  type PackageManager,
} from "../pm";
import { runSync } from "./sync";
import type { CliEnv, CommandRunner } from "../types";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  cli: CliEnv;
  name: string;
}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.cli.env,
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forward = (write: (line: string) => void) => (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim()) write(`[${input.name}] ${line}`);
      }
    };
    child.stdout?.on("data", forward(input.cli.stdout));
    child.stderr?.on("data", forward(input.cli.stderr));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function hasScript(dir: string, script: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts?.[script]);
  } catch {
    return false;
  }
}

async function deployEntry(input: {
  name: string;
  dir: string;
  env: string | undefined;
  dryRun: boolean;
  needsBuild: boolean;
  pm: PackageManager;
  wranglerBin: string;
  cli: CliEnv;
}): Promise<number> {
  const { cli } = input;
  if (input.dryRun) {
    cli.stdout(
      `[dry-run] would deploy ${input.name} from ${input.dir}${input.needsBuild ? " (with build)" : ""}`,
    );
    return 0;
  }
  if (input.needsBuild) {
    const buildCommand = input.pm.runCmd("build");
    const buildCode = await runCommand({
      command: buildCommand[0]!,
      args: buildCommand.slice(1),
      cwd: input.dir,
      cli,
      name: input.name,
    });
    if (buildCode !== 0) {
      cli.stderr(`Build failed for ${input.name}`);
      return buildCode;
    }
  }
  const deployArgs = ["deploy"];
  if (input.env) deployArgs.push("--env", input.env);
  return runCommand({
    command: input.wranglerBin,
    args: deployArgs,
    cwd: input.dir,
    cli,
    name: input.name,
  });
}

/**
 * `gmode deploy [--env <name>] [--dry-run]`
 *
 * Deploys in dependency order: services and web apps first (in parallel),
 * then the gateway last so its service bindings always resolve.
 */
export const deploy: CommandRunner = async (args, cli: CliEnv) => {
  const manifestPath = findManifestPath(cli.cwd);
  if (!manifestPath) {
    cli.stderr("No gmode.jsonc found. Run `gmode init` first.");
    return 1;
  }

  const dryRun = args.includes("--dry-run");
  const envName = parseFlag(args, "--env");

  let resolved: ReturnType<typeof runSync>["resolved"];
  try {
    resolved = runSync(cli.cwd).resolved;
  } catch (err) {
    cli.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const pm = resolved.manifest.packageManager
    ? packageManagerByName(resolved.manifest.packageManager)
    : detectPackageManager(cli.env);
  const wranglerBin = resolveWorkspaceBin(resolved.rootDir, "wrangler");

  cli.stdout(
    `Deploying "${resolved.manifest.name}": ${resolved.entries.length} worker(s) + gateway${envName ? ` (env: ${envName})` : ""}`,
  );

  // 1. Services and web apps in parallel.
  const results = await Promise.all(
    resolved.entries.map((entry: ResolvedEntry) =>
      deployEntry({
        name: entry.name,
        dir: entry.dir,
        env: envName,
        dryRun,
        // Web apps have a Vite build step before wrangler deploy.
        needsBuild: entry.kind === "web" && hasScript(entry.dir, "build"),
        pm,
        wranglerBin,
        cli,
      }),
    ),
  );
  const failed = resolved.entries.filter((_, i) => results[i] !== 0);
  if (failed.length > 0) {
    cli.stderr(
      `Deploy failed for: ${failed.map((e) => e.name).join(", ")}. Gateway not deployed.`,
    );
    return 1;
  }

  // 2. Gateway last.
  const gatewayCode = await deployEntry({
    name: "gateway",
    dir: resolved.gatewayDir,
    env: envName,
    dryRun,
    needsBuild: false,
    pm,
    wranglerBin,
    cli,
  });
  if (gatewayCode !== 0) {
    cli.stderr("Gateway deploy failed.");
    return gatewayCode;
  }

  cli.stdout(dryRun ? "Dry run complete." : "Deploy complete.");
  if (!dryRun) {
    cli.stdout(
      "Reminder: set the shared context secret on every worker if you have not:",
    );
    cli.stdout("  wrangler secret put GMODE_CONTEXT_SECRET");
  }
  return 0;
};
