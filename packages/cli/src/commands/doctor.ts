import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc } from "../jsonc";
import { findManifestPath, loadManifest } from "../manifest";
import {
  renderGeneratedModule,
  renderWranglerServices,
} from "./sync";
import { hasContextSecret } from "../dev-vars";
import type { CliEnv, CommandRunner } from "../types";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

function wranglerConfig(dir: string): { path: string; config: Record<string, unknown> } | null {
  for (const file of ["wrangler.jsonc", "wrangler.json"]) {
    const path = join(dir, file);
    if (existsSync(path)) {
      try {
        return { path, config: parseJsonc(readFileSync(path, "utf8")) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * `gmode doctor` — validates the workspace:
 * manifest health, wrangler drift, generated code freshness, private
 * services, dev secret presence, port conflicts, and wrangler availability.
 */
export const doctor: CommandRunner = async (_args, cli: CliEnv) => {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, ...(detail ? { detail } : {}) });
  };

  const manifestPath = findManifestPath(cli.cwd);
  if (!manifestPath) {
    cli.stderr("No gmode.jsonc found. Run `gmode init` first.");
    return 1;
  }

  let resolved: ReturnType<typeof loadManifest>;
  try {
    resolved = loadManifest(manifestPath);
    add("gmode.jsonc parses and validates", true);
  } catch (err) {
    add(
      "gmode.jsonc parses and validates",
      false,
      err instanceof Error ? err.message : String(err),
    );
    printChecks(checks, cli);
    return 1;
  }

  // Gateway wrangler config and services drift.
  const gateway = wranglerConfig(resolved.gatewayDir);
  if (!gateway) {
    add("gateway wrangler.jsonc exists", false, resolved.gatewayDir);
  } else {
    add("gateway wrangler.jsonc exists", true);
    const expected = JSON.parse(renderWranglerServices(resolved)) as {
      binding: string;
      service: string;
    }[];
    const actual = (gateway.config["services"] ?? []) as {
      binding?: string;
      service?: string;
    }[];
    const drift =
      expected.length !== actual.length ||
      expected.some(
        (e) =>
          !actual.some(
            (a) => a.binding === e.binding && a.service === e.service,
          ),
      );
    add(
      "gateway service bindings match gmode.jsonc",
      !drift,
      drift ? "run `gmode sync`" : undefined,
    );
  }

  // Generated module freshness.
  const generatedPath = join(resolved.gatewayDir, "src", "gmode.generated.ts");
  if (!existsSync(generatedPath)) {
    add("gateway src/gmode.generated.ts exists", false, "run `gmode sync`");
  } else {
    const fresh =
      readFileSync(generatedPath, "utf8") === renderGeneratedModule(resolved);
    add(
      "gateway src/gmode.generated.ts up to date",
      fresh,
      fresh ? undefined : "run `gmode sync`",
    );
  }

  // Per-entry checks.
  for (const entry of resolved.entries) {
    const config = wranglerConfig(entry.dir);
    if (!config) {
      add(`${entry.name}: wrangler.jsonc exists`, false, entry.dir);
      continue;
    }
    add(`${entry.name}: wrangler.jsonc exists`, true);
    if (config.config["name"] !== entry.workerName) {
      add(
        `${entry.name}: worker name matches convention`,
        true,
        `uses "${String(config.config["name"])}" (manifest expects "${entry.workerName}" only if unnamed)`,
      );
    }
    if (entry.kind === "service") {
      const isPrivate = config.config["workers_dev"] === false;
      add(
        `${entry.name}: private (workers_dev: false)`,
        isPrivate,
        isPrivate
          ? undefined
          : "service workers should not be publicly reachable",
      );
    }
  }

  // Port conflicts.
  const ports = new Map<number, string>();
  const gatewayPort = resolved.manifest.gateway.port ?? 8787;
  ports.set(gatewayPort, "gateway");
  let portsOk = true;
  for (const webApp of resolved.manifest.webApps ?? []) {
    if (webApp.devPort === undefined) continue;
    const owner = ports.get(webApp.devPort);
    if (owner) {
      portsOk = false;
      add(
        "dev ports are unique",
        false,
        `port ${webApp.devPort} used by both "${owner}" and "${webApp.name}"`,
      );
    }
    ports.set(webApp.devPort, webApp.name);
  }
  if (portsOk) add("dev ports are unique", true);

  // Local context secret.
  const devVars = join(resolved.gatewayDir, ".dev.vars");
  const gatewaySecret = existsSync(devVars)
    ? readFileSync(devVars, "utf8").match(/^GMODE_CONTEXT_SECRET=(.+)$/m)?.[1]?.trim()
    : undefined;
  add(
    "gateway .dev.vars has GMODE_CONTEXT_SECRET",
    Boolean(gatewaySecret),
    gatewaySecret ? undefined : "context tokens will be unsigned in local dev",
  );

  if (gatewaySecret) {
    for (const entry of resolved.entries) {
      if (entry.kind !== "service") continue;
      const matches = hasContextSecret(entry.dir, gatewaySecret);
      add(
        `${entry.name}: GMODE_CONTEXT_SECRET matches gateway`,
        matches,
        matches ? undefined : "run `gmode sync` to propagate the gateway secret",
      );
    }
  }

  // Wrangler availability.
  try {
    const version = execSync("pnpm exec wrangler --version", {
      cwd: resolved.rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    add("wrangler is installed", true, version);
  } catch {
    add("wrangler is installed", false, "pnpm add -D wrangler");
  }

  printChecks(checks, cli);
  return checks.every((c) => c.ok) ? 0 : 1;
};

function printChecks(checks: Check[], cli: CliEnv): void {
  for (const check of checks) {
    const mark = check.ok ? "✓" : "✗";
    cli.stdout(
      `${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
    );
  }
  const failing = checks.filter((c) => !c.ok).length;
  cli.stdout("");
  cli.stdout(
    failing === 0
      ? "All checks passed."
      : `${failing} check(s) failing.`,
  );
}
