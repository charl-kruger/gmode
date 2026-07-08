import type { SequencePolicy, SequenceRule } from "@gmode/core";
import { createCloudflareClient } from "../cloudflare";
import { loadConfig } from "../config";
import type { CommandRunner } from "../types";

type SyncSequencesArgs = {
  file?: string | undefined;
  dryRun?: boolean | undefined;
  out?: string | undefined;
  configPath?: string | undefined;
};

function parseArgs(argv: string[]): SyncSequencesArgs {
  const result: SyncSequencesArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--file") result.file = argv[++i];
    else if (a === "--out") result.out = argv[++i];
    else if (a === "--config") result.configPath = argv[++i];
    else if (a === "--dry-run") result.dryRun = true;
  }
  return result;
}

function isSequencePolicy(value: unknown): value is SequencePolicy {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as SequencePolicy).rules)
  );
}

export function buildDashboardImport(policy: SequencePolicy): {
  sequences: Array<{
    name: string;
    description: string;
    operations: Array<{ operationId: string; method?: string; endpoint?: string }>;
    action: string;
    withinSeconds?: number;
  }>;
} {
  return {
    sequences: policy.rules.map((rule: SequenceRule) => ({
      name: rule.name,
      description: rule.description ?? "",
      operations: rule.pattern,
      action: rule.action ?? "log",
      ...(rule.withinSeconds !== undefined
        ? { withinSeconds: rule.withinSeconds }
        : {}),
    })),
  };
}

export const syncSequences: CommandRunner = async (argv, cli) => {
  const args = parseArgs(argv);
  const opts: { configPath?: string } = {};
  if (args.configPath) opts.configPath = args.configPath;
  const config = await loadConfig(cli, opts);

  const file = args.file ?? config.shield?.sequences;
  if (!file) {
    cli.stderr(
      "Provide a sequences file with --file <path> or shield.sequences in gmode.config.json. File must be JSON with shape { rules: [...] }.",
    );
    return 2;
  }

  let raw: string;
  try {
    raw = await cli.readFile(
      file.startsWith("/") ? file : `${cli.cwd}/${file}`,
    );
  } catch {
    cli.stderr(`Could not read sequences file: ${file}`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cli.stderr(`Sequences file is not valid JSON: ${file}`);
    return 2;
  }

  if (!isSequencePolicy(parsed)) {
    cli.stderr(
      "Sequences file must export an object with a 'rules' array. Use defineSequences() from @gmode/core, then JSON.stringify the result.",
    );
    return 2;
  }

  const policy = parsed;
  const dashboardJson = buildDashboardImport(policy);

  if (args.out) {
    const outPath = args.out.startsWith("/")
      ? args.out
      : `${cli.cwd}/${args.out}`;
    cli.stdout(
      `Writing dashboard-import JSON to ${outPath} (${policy.rules.length} rules)`,
    );
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outPath, JSON.stringify(dashboardJson, null, 2));
    return 0;
  }

  if (args.dryRun) {
    cli.stdout(JSON.stringify(dashboardJson, null, 2));
    return 0;
  }

  const client = createCloudflareClient({
    apiToken: config.cloudflare.apiToken,
    zoneId: config.cloudflare.zoneId,
    fetchImpl: cli.fetch,
  });

  let synced = 0;
  let failed = 0;
  for (const rule of policy.rules) {
    try {
      await client.putSequenceRule({
        name: rule.name,
        rule: {
          name: rule.name,
          description: rule.description ?? "",
          operations: rule.pattern,
          action: rule.action ?? "log",
        },
      });
      synced++;
      cli.stdout(`Synced rule "${rule.name}"`);
    } catch (err) {
      failed++;
      cli.stderr(
        `Failed to sync "${rule.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  cli.stdout(`Done. Synced: ${synced}, failed: ${failed}.`);
  if (failed > 0) {
    cli.stderr(
      "Cloudflare's sequence rules API surface is still maturing. If the endpoint 404s, run with --out to export a JSON file for manual dashboard import instead.",
    );
  }
  return failed > 0 ? 1 : 0;
};
