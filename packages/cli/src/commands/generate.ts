import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findManifestPath, loadManifest } from "../manifest";
import { resolveWorkspaceBin } from "../pm";
import { generateClientSource } from "../codegen/openapi-client";
import { runSync } from "./sync";
import type { CliEnv, CommandRunner } from "../types";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function generateClient(args: string[], cli: CliEnv): Promise<number> {
  const url = parseFlag(args, "--url");
  const specPath = parseFlag(args, "--spec");
  const outDir = resolve(cli.cwd, parseFlag(args, "--out") ?? "./generated");

  let specText: string;
  if (url) {
    const res = await cli.fetch(url);
    if (!res.ok) {
      cli.stderr(`OpenAPI fetch failed: ${res.status} ${url}`);
      return 1;
    }
    specText = await res.text();
  } else if (specPath) {
    specText = readFileSync(resolve(cli.cwd, specPath), "utf8");
  } else {
    // Default: local gateway dev server.
    const fallback = "http://127.0.0.1:8787/openapi.json";
    try {
      const res = await cli.fetch(fallback);
      if (!res.ok) throw new Error(String(res.status));
      specText = await res.text();
    } catch {
      cli.stderr(
        "Provide --url <openapi-url> or --spec <file> (no gateway found at http://127.0.0.1:8787).",
      );
      return 2;
    }
  }

  let spec: unknown;
  try {
    spec = JSON.parse(specText);
  } catch (err) {
    cli.stderr(
      `OpenAPI document is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
    return 1;
  }

  const { source, operationCount, title } = generateClientSource(spec);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "gmode-client.ts");
  writeFileSync(outFile, source, "utf8");
  cli.stdout(
    `Generated typed client for "${title}" (${operationCount} operations) -> ${outFile}`,
  );
  cli.stdout("");
  cli.stdout("Usage:");
  cli.stdout('  import { createClient } from "./gmode-client";');
  cli.stdout('  const api = createClient({ baseUrl: "https://api.example.com" });');
  return 0;
}

async function generateTypes(_args: string[], cli: CliEnv): Promise<number> {
  const manifestPath = findManifestPath(cli.cwd);
  if (!manifestPath) {
    cli.stderr("No gmode.jsonc found. Run `gmode init` first.");
    return 1;
  }
  const resolved = loadManifest(manifestPath);
  const wranglerBin = resolveWorkspaceBin(resolved.rootDir, "wrangler");
  const dirs = [
    { name: "gateway", dir: resolved.gatewayDir },
    ...resolved.entries.map((e) => ({ name: e.name, dir: e.dir })),
  ];
  for (const target of dirs) {
    try {
      execFileSync(wranglerBin, ["types"], {
        cwd: target.dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...cli.env,
          WRANGLER_SEND_METRICS: "false",
        },
      });
      cli.stdout(`✓ ${target.name}: wrangler types`);
    } catch (err) {
      cli.stderr(
        `✗ ${target.name}: wrangler types failed — ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  runSync(resolved.rootDir);
  cli.stdout("✓ gmode sync");
  return 0;
}

/**
 * `gmode generate client [--url <openapi-url> | --spec <file>] [--out <dir>]`
 * `gmode generate types`
 */
export const generate: CommandRunner = async (args, cli: CliEnv) => {
  const [subcommand, ...rest] = args;
  if (subcommand === "client") return generateClient(rest, cli);
  if (subcommand === "types") return generateTypes(rest, cli);
  cli.stderr("Usage: gmode generate <client|types> [options]");
  return 2;
};
