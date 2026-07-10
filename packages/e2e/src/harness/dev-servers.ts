import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  GATEWAY_BASIC,
  GATEWAY_BASIC_GATEWAY,
  gmodeBin,
  repoBin,
  WEB_APP_TANSTACK,
} from "./paths";
import { waitForHealth } from "./http";
import { getFreePort } from "./ports";
import {
  type ManagedProcess,
  spawnManaged,
  stopAll,
} from "./process";

/**
 * Provision `.dev.vars` from `.dev.vars.example` for every Worker in an
 * example. `.dev.vars` is gitignored, so CI checkouts don't have it — the
 * smoke assertions (JWT auth, signed gateway context) rely on the example
 * secrets, and wrangler needs the files to exist at startup.
 */
function ensureDevVars(exampleDir: string): void {
  for (const entry of readdirSync(exampleDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const example = join(exampleDir, entry.name, ".dev.vars.example");
    const target = join(dirname(example), ".dev.vars");
    if (existsSync(example) && !existsSync(target)) {
      copyFileSync(example, target);
    }
  }
}

export type DevServers = {
  gatewayBasicUrl: string;
  webAppGatewayUrl: string;
  dashboardUrl: string;
  stop: () => Promise<void>;
};

/** Start shared dev servers for the full E2E run (called from globalSetup). */
export async function startDevServers(): Promise<DevServers> {
  const processes: ManagedProcess[] = [];

  ensureDevVars(GATEWAY_BASIC);

  const basicPort = await getFreePort();
  const gatewayBasicUrl = `http://127.0.0.1:${basicPort}`;
  processes.push(
    spawnManaged({
      name: "gateway-basic",
      cwd: GATEWAY_BASIC_GATEWAY,
      command: repoBin("wrangler"),
      args: [
        "dev",
        "-c",
        "wrangler.jsonc",
        "-c",
        "../users-api/wrangler.jsonc",
        "-c",
        "../billing-api/wrangler.jsonc",
        "--ip",
        "127.0.0.1",
        "--port",
        String(basicPort),
      ],
    }),
  );

  const webPort = await getFreePort();
  const dashboardPort = await getFreePort();
  const webAppGatewayUrl = `http://127.0.0.1:${webPort}`;
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  processes.push(
    spawnManaged({
      name: "gmode-dev",
      cwd: WEB_APP_TANSTACK,
      command: process.execPath,
      args: [
        gmodeBin(),
        "dev",
        "--port",
        String(webPort),
        "--dashboard-port",
        String(dashboardPort),
      ],
    }),
  );

  // CI runners cold-start wrangler/workerd and build two Vite apps, which is
  // slower than a warm dev machine. Allow a longer default on CI and an
  // explicit override.
  const healthTimeoutMs = Number(
    process.env["E2E_HEALTH_TIMEOUT_MS"] ??
      (process.env["CI"] ? 240_000 : 120_000),
  );

  try {
    await Promise.all([
      waitForHealth(gatewayBasicUrl, { timeoutMs: healthTimeoutMs }),
      waitForHealth(webAppGatewayUrl, { timeoutMs: healthTimeoutMs }),
    ]);
  } catch (err) {
    // Surface the spawned processes' output so a health timeout is debuggable
    // instead of an opaque "fetch failed".
    for (const p of processes) {
      process.stderr.write(`\n----- ${p.name} output -----\n`);
      process.stderr.write(p.logs.join("") || "(no output captured)\n");
      process.stderr.write(`\n----- end ${p.name} -----\n`);
    }
    await stopAll(processes);
    throw err;
  }

  const dashboardDeadline = Date.now() + 30_000;
  while (Date.now() < dashboardDeadline) {
    try {
      const res = await fetch(`${dashboardUrl}/api/state`);
      if (res.ok) break;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    gatewayBasicUrl,
    webAppGatewayUrl,
    dashboardUrl,
    stop: () => stopAll(processes),
  };
}
