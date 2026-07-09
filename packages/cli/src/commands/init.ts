import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { toWorkerName } from "../manifest";
import { scaffoldTemplate } from "../scaffold";
import { runSync } from "./sync";
import type { CliEnv, CommandRunner } from "../types";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

/**
 * `gmode init [directory] [--name app-name]`
 *
 * Scaffolds a GMode workspace: gmode.jsonc manifest, a gateway Worker,
 * pnpm workspace config, and a generated GMODE_CONTEXT_SECRET for local dev.
 */
export const init: CommandRunner = async (args, cli: CliEnv) => {
  try {
    const positional = args.filter((a) => !a.startsWith("--"));
    const targetDir = resolve(cli.cwd, positional[0] ?? ".");
    const appName = parseFlag(args, "--name") ?? basename(targetDir);

    if (existsSync(join(targetDir, "gmode.jsonc"))) {
      cli.stderr(`gmode.jsonc already exists in ${targetDir}`);
      return 1;
    }

    const gatewayWorkerName = toWorkerName(appName, "gateway");

    scaffoldTemplate({
      template: "workspace",
      targetDir,
      tokens: {
        appName,
        name: appName,
        workerName: gatewayWorkerName,
        mount: "/",
      },
    });
    scaffoldTemplate({
      template: "gateway",
      targetDir: join(targetDir, "gateway"),
      tokens: {
        appName,
        name: "gateway",
        workerName: gatewayWorkerName,
        mount: "/",
      },
    });

    // Shared context-signing secret for local dev (gitignored via .dev.vars).
    const secret = randomBytes(32).toString("hex");
    writeFileSync(
      join(targetDir, "gateway", ".dev.vars"),
      `GMODE_CONTEXT_SECRET=${secret}\n`,
      "utf8",
    );

    runSync(targetDir);

    cli.stdout(`Created GMode workspace "${appName}" in ${targetDir}`);
    cli.stdout("");
    cli.stdout("Next steps:");
    cli.stdout("  pnpm install");
    cli.stdout("  pnpm exec gmode new service users");
    cli.stdout("  pnpm dev");
    return 0;
  } catch (err) {
    cli.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
};
