import { bootstrapShield } from "./commands/bootstrap-shield";
import { diffDiscovered } from "./commands/diff-discovered";
import { pushSchema } from "./commands/push-schema";
import { syncSchemaActions } from "./commands/sync-schema-actions";
import { syncSequences } from "./commands/sync-sequences";
import type { CliEnv, CommandRunner } from "./types";

const COMMANDS: Record<string, CommandRunner> = {
  "shield:push-schema": pushSchema,
  "shield:bootstrap": bootstrapShield,
  "shield:diff-discovered": diffDiscovered,
  "shield:sync-schema-actions": syncSchemaActions,
  "shield:sync-sequences": syncSequences,
};

const HELP = `gmode — Cloudflare API platform helper

Usage: gmode <command> [options]

Commands:
  shield:push-schema       Upload /openapi.json?profile=shield to Cloudflare Schema Validation
  shield:bootstrap         Prune a Shield schema from discovered public traffic and optionally upload it
  shield:diff-discovered   Diff your spec against Shield's traffic-discovered endpoints
  shield:sync-schema-actions Apply per-endpoint API Shield schema validation actions
  shield:sync-sequences    Sync a defineSequences() policy to Cloudflare (or export to JSON)

Common options:
  --config <path>          Path to gmode.config.json (default: ./gmode.config.json)

Env vars:
  CLOUDFLARE_API_TOKEN     Required
  CLOUDFLARE_ZONE_ID       Required

See docs/README.md for the full reference.`;

export async function run(argv: string[], cli: CliEnv): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    cli.stdout(HELP);
    return 0;
  }
  const runner = COMMANDS[cmd];
  if (!runner) {
    cli.stderr(`Unknown command: ${cmd}\n`);
    cli.stdout(HELP);
    return 2;
  }
  return runner(rest, cli);
}
