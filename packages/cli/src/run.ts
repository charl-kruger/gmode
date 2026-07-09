import { bootstrapShield } from "./commands/bootstrap-shield";
import { deploy } from "./commands/deploy";
import { dev } from "./commands/dev";
import { diffDiscovered } from "./commands/diff-discovered";
import { doctor } from "./commands/doctor";
import { generate } from "./commands/generate";
import { init } from "./commands/init";
import { newEntry } from "./commands/new";
import { pushSchema } from "./commands/push-schema";
import { sync } from "./commands/sync";
import { syncSchemaActions } from "./commands/sync-schema-actions";
import { syncSequences } from "./commands/sync-sequences";
import type { CliEnv, CommandRunner } from "./types";

const COMMANDS: Record<string, CommandRunner> = {
  init,
  new: newEntry,
  dev,
  deploy,
  sync,
  doctor,
  generate,
  "shield:push-schema": pushSchema,
  "shield:bootstrap": bootstrapShield,
  "shield:diff-discovered": diffDiscovered,
  "shield:sync-schema-actions": syncSchemaActions,
  "shield:sync-sequences": syncSequences,
};

const HELP = `gmode — the Cloudflare Workers app platform CLI

Usage: gmode <command> [options]

Workspace:
  init [dir] [--name app]  Create a new GMode workspace (manifest + gateway)
  new service <name>       Scaffold a private API service and register it
  new web <name>           Scaffold a web app (--framework tanstack-start|vite-react)
  sync                     Sync gmode.jsonc -> wrangler bindings + generated code
  doctor                   Validate manifest, bindings, secrets, and drift

Develop & ship:
  dev                      Run gateway, services, web apps, and the dev dashboard
                           (--port, --dashboard-port, --no-dashboard)
  deploy                   Deploy services first, gateway last (--env, --dry-run)
  generate client          Generate a typed TypeScript client from OpenAPI
                           (--url <openapi-url> | --spec <file>) [--out <dir>]
  generate types           Run wrangler types for every worker + re-sync

Cloudflare API Shield:
  shield:push-schema       Upload /openapi.json?profile=shield to Schema Validation
  shield:bootstrap         Prune a Shield schema from discovered public traffic
  shield:diff-discovered   Diff your spec against Shield's discovered endpoints
  shield:sync-schema-actions Apply per-endpoint schema validation actions
  shield:sync-sequences    Sync a defineSequences() policy to Cloudflare

Common options:
  --config <path>          Path to gmode.config.json (Shield commands only)

Env vars (Shield commands):
  CLOUDFLARE_API_TOKEN     Required for live Shield commands
  CLOUDFLARE_ZONE_ID       Required for live Shield commands

See docs/workspace-cli.md for the full reference.`;

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
