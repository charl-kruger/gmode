import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import {
  findManifestPath,
  type ResolvedEntry,
  type ResolvedManifest,
} from "../manifest";
import { runSync } from "./sync";
import {
  startCollector,
  type Collector,
  type DashboardResource,
} from "../dev/collector";
import type { CliEnv, CommandRunner } from "../types";

const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m", "\x1b[91m"];
const RESET = "\x1b[0m";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

type ManagedProcess = {
  name: string;
  child: ChildProcess;
};

function wranglerConfigPath(dir: string): string {
  for (const file of ["wrangler.jsonc", "wrangler.json"]) {
    const path = join(dir, file);
    if (existsSync(path)) return path;
  }
  throw new Error(`No wrangler.jsonc found in ${dir}`);
}

function pipeOutput(input: {
  child: ChildProcess;
  name: string;
  color: string;
  cli: CliEnv;
  collector: Collector | null;
}): void {
  const { child, name, color, cli, collector } = input;
  const forward = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const out = `${color}[${name}]${RESET} ${line}`;
      if (stream === "stdout") cli.stdout(out);
      else cli.stderr(out);
      collector?.pushLog({ ts: Date.now(), resource: name, stream, line });
    }
  };
  child.stdout?.on("data", forward("stdout"));
  child.stderr?.on("data", forward("stderr"));
}

function buildWranglerArgs(input: {
  resolved: ResolvedManifest;
  gatewayPort: number;
  inspectorUrl: string | null;
}): string[] {
  const { resolved } = input;
  const args = ["dev", "-c", wranglerConfigPath(resolved.gatewayDir)];
  for (const entry of resolved.entries) {
    if (entry.kind !== "service") continue;
    args.push("-c", wranglerConfigPath(entry.dir));
  }
  args.push("--ip", "127.0.0.1", "--port", String(input.gatewayPort));
  // Web-app Vite dev servers (Cloudflare plugin) claim the default inspector
  // port 9229; ask wrangler for a random free port to avoid a fatal collision.
  args.push("--inspector-port", "0");

  if (input.inspectorUrl) {
    args.push("--var", `GMODE_DEV_INSPECTOR_URL:${input.inspectorUrl}`);
  }
  return args;
}

async function pollHealth(input: {
  gatewayUrl: string;
  cli: CliEnv;
  collector: Collector | null;
  timeoutMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${input.gatewayUrl}/__gmode/health`);
      const body = (await res.json()) as unknown;
      input.collector?.setHealth(body);
      if (res.ok) return true;
    } catch {
      // Gateway not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * `gmode dev` — one command runs the whole app:
 *
 * - syncs gmode.jsonc into wrangler bindings and generated code
 * - starts one `wrangler dev` session for the gateway + every service Worker
 * - starts a Vite dev server per web app (service bindings connect to them for HMR)
 * - starts the local dev dashboard with logs, health, and a request inspector
 */
export const dev: CommandRunner = async (args, cli: CliEnv) => {
  const manifestPath = findManifestPath(cli.cwd);
  if (!manifestPath) {
    cli.stderr("No gmode.jsonc found. Run `gmode init` first.");
    return 1;
  }

  let resolved: ResolvedManifest;
  try {
    const syncResult = runSync(cli.cwd);
    resolved = syncResult.resolved;
    if (syncResult.updatedServiceSecrets.length > 0) {
      cli.stdout(
        `Synced service secrets: ${syncResult.updatedServiceSecrets.join(", ")}`,
      );
    }
  } catch (err) {
    cli.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const gatewayPort = Number(
    parseFlag(args, "--port") ?? resolved.manifest.gateway.port ?? 8787,
  );
  const dashboardPort = Number(parseFlag(args, "--dashboard-port") ?? 9100);
  const noDashboard = args.includes("--no-dashboard");
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  // Assign web app dev ports.
  const webEntries = resolved.entries.filter((e) => e.kind === "web");
  const webPorts = new Map<string, number>();
  let nextPort = 5173;
  for (const entry of webEntries) {
    const port = entry.webApp?.devPort ?? nextPort++;
    webPorts.set(entry.name, port);
  }

  // Start the dashboard collector first so the gateway can stream to it.
  let collector: Collector | null = null;
  if (!noDashboard) {
    const resources: DashboardResource[] = [
      {
        kind: "gateway",
        name: "gateway",
        url: gatewayUrl,
        workerName: resolved.manifest.name,
      },
      ...resolved.entries.map((entry: ResolvedEntry): DashboardResource => {
        const resource: DashboardResource = {
          kind: entry.kind,
          name: entry.name,
          mount: entry.mount,
          binding: entry.binding,
          workerName: entry.workerName,
          url: `${gatewayUrl}${entry.mount}`,
        };
        const port = webPorts.get(entry.name);
        if (port !== undefined) resource.devUrl = `http://127.0.0.1:${port}`;
        return resource;
      }),
    ];
    try {
      collector = await startCollector({
        port: dashboardPort,
        appName: resolved.manifest.name,
        gatewayUrl,
        resources,
      });
    } catch (err) {
      cli.stderr(
        `Dashboard failed to start on port ${dashboardPort}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const processes: ManagedProcess[] = [];
  let colorIndex = 0;
  const nextColor = () => COLORS[colorIndex++ % COLORS.length]!;

  const spawnManaged = (
    name: string,
    command: string,
    commandArgs: string[],
    cwd: string,
  ): ChildProcess => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipeOutput({ child, name, color: nextColor(), cli, collector });
    processes.push({ name, child });
    return child;
  };

  // 1. Vite dev server per web app.
  for (const entry of webEntries) {
    const port = webPorts.get(entry.name)!;
    spawnManaged(
      entry.name,
      "pnpm",
      ["run", "dev", "--", "--port", String(port), "--strictPort"],
      entry.dir,
    );
  }

  // 2. One wrangler session for the gateway + all services.
  let wranglerChild: ChildProcess | null = null;
  let restartingWrangler = false;
  let onWranglerExit: ((code: number) => void) | null = null;
  const startWrangler = () => {
    const wranglerArgs = buildWranglerArgs({
      resolved,
      gatewayPort,
      inspectorUrl: collector ? collector.eventsUrl : null,
    });
    const child = spawnManaged(
      "workers",
      "pnpm",
      ["exec", "wrangler", ...wranglerArgs],
      resolved.rootDir,
    );
    child.on("exit", (code) => {
      if (restartingWrangler) {
        restartingWrangler = false;
        return;
      }
      onWranglerExit?.(code ?? 1);
    });
    wranglerChild = child;
  };
  startWrangler();

  // 3. Watch the manifest; re-sync and restart the wrangler session on change.
  const watcher = watch(manifestPath, () => {
    try {
      const next = runSync(cli.cwd);
      resolved = next.resolved;
      if (next.wroteWrangler || next.wroteGenerated) {
        cli.stdout("gmode.jsonc changed — resynced bindings.");
      }
      if (next.wroteWrangler && wranglerChild) {
        cli.stdout("Restarting workers to pick up new bindings...");
        restartingWrangler = true;
        wranglerChild.kill("SIGINT");
        setTimeout(startWrangler, 1000);
      }
    } catch (err) {
      cli.stderr(
        `Manifest sync failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

  // 4. Health check + ready summary.
  const healthy = await pollHealth({
    gatewayUrl,
    cli,
    collector,
    timeoutMs: 60_000,
  });
  cli.stdout("");
  cli.stdout(healthy ? "── ready ──" : "── started (some services unhealthy) ──");
  cli.stdout(`  Gateway     ${gatewayUrl}`);
  cli.stdout(`  API docs    ${gatewayUrl}/docs`);
  cli.stdout(`  OpenAPI     ${gatewayUrl}/openapi.json`);
  if (collector) {
    cli.stdout(`  Dashboard   ${collector.url}`);
  }
  for (const entry of resolved.entries) {
    cli.stdout(`  ${entry.name.padEnd(11)} ${gatewayUrl}${entry.mount}`);
  }
  cli.stdout("");

  // Keep polling health in the background for the dashboard.
  const healthTimer = setInterval(async () => {
    try {
      const res = await fetch(`${gatewayUrl}/__gmode/health`);
      collector?.setHealth(await res.json());
    } catch {
      collector?.setHealth({ ok: false, error: "gateway unreachable" });
    }
  }, 5000);

  // 5. Run until interrupted or the wrangler session dies.
  return new Promise<number>((resolvePromise) => {
    const shutdown = (code: number) => {
      clearInterval(healthTimer);
      watcher.close();
      collector?.close();
      for (const proc of processes) {
        proc.child.kill("SIGINT");
      }
      resolvePromise(code);
    };
    process.on("SIGINT", () => shutdown(0));
    process.on("SIGTERM", () => shutdown(0));
    onWranglerExit = (code) => {
      cli.stderr(`wrangler dev exited with code ${code}`);
      shutdown(code);
    };
  });
};
