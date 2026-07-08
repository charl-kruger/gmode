import { createCloudflareClient } from "../cloudflare";
import { loadConfig } from "../config";
import { loadShieldSpec } from "../spec-loader";
import type { CommandRunner } from "../types";

type PushSchemaArgs = {
  from?: string | undefined;
  name?: string | undefined;
  disable?: boolean | undefined;
  configPath?: string | undefined;
};

function parseArgs(argv: string[]): PushSchemaArgs {
  const result: PushSchemaArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--from") result.from = argv[++i];
    else if (a === "--name") result.name = argv[++i];
    else if (a === "--config") result.configPath = argv[++i];
    else if (a === "--disable") result.disable = true;
  }
  return result;
}

export const pushSchema: CommandRunner = async (argv, cli) => {
  const args = parseArgs(argv);
  const opts: { configPath?: string } = {};
  if (args.configPath) opts.configPath = args.configPath;
  const config = await loadConfig(cli, opts);

  const from =
    args.from ??
    config.shield?.specFile ??
    (config.gateway?.baseUrl
      ? `${config.gateway.baseUrl.replace(/\/$/, "")}${
          config.gateway.specPath ?? "/openapi.json"
        }`
      : undefined);

  if (!from) {
    cli.stderr(
      "No spec source. Use --from <url-or-path>, or set gateway.baseUrl / shield.specFile in gmode.config.json.",
    );
    return 2;
  }

  const loaded = await loadShieldSpec({ cli, from });
  if (loaded.shieldWarningCount > 0) {
    cli.stdout(
      `Downgraded spec to 3.0.3 with ${loaded.shieldWarningCount} compatibility adjustment(s).`,
    );
  }

  const client = createCloudflareClient({
    apiToken: config.cloudflare.apiToken,
    zoneId: config.cloudflare.zoneId,
    fetchImpl: cli.fetch,
  });

  const name =
    args.name ??
    (loaded.spec.info.title
      ? `gmode:${loaded.spec.info.title}`
      : "gmode-schema");

  try {
    const result = await client.uploadUserSchema({
      name,
      kind: "openapi_v3",
      enabled: args.disable !== true,
      body: JSON.stringify(loaded.spec),
    });
    cli.stdout(`Uploaded schema "${result.name}" (id: ${result.id})`);
    cli.stdout(`Source: ${loaded.source}`);
    return 0;
  } catch (err) {
    cli.stderr(
      `Failed to upload schema: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
};
