import { createCloudflareClient } from "../cloudflare";
import { loadConfig } from "../config";
import { loadShieldSpec } from "../spec-loader";
import type { CommandRunner } from "../types";

type DiffDiscoveredArgs = {
  from?: string | undefined;
  json?: boolean | undefined;
  configPath?: string | undefined;
};

function parseArgs(argv: string[]): DiffDiscoveredArgs {
  const result: DiffDiscoveredArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--from") result.from = argv[++i];
    else if (a === "--config") result.configPath = argv[++i];
    else if (a === "--json") result.json = true;
  }
  return result;
}

type EndpointKey = `${string} ${string}`;

function honoToOpenApiKey(method: string, endpoint: string): EndpointKey {
  return `${method.toUpperCase()} ${endpoint}` as EndpointKey;
}

export const diffDiscovered: CommandRunner = async (argv, cli) => {
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
      "No spec source. Use --from <url-or-path>, or set gateway.baseUrl in gmode.config.json.",
    );
    return 2;
  }

  const loaded = await loadShieldSpec({ cli, from });

  const declared = new Set<EndpointKey>();
  for (const [path, ops] of Object.entries(loaded.spec.paths ?? {})) {
    for (const method of Object.keys(ops)) {
      if (
        ["get", "post", "put", "patch", "delete", "options", "head"].includes(
          method.toLowerCase(),
        )
      ) {
        declared.add(honoToOpenApiKey(method, path));
      }
    }
  }

  const client = createCloudflareClient({
    apiToken: config.cloudflare.apiToken,
    zoneId: config.cloudflare.zoneId,
    fetchImpl: cli.fetch,
  });

  let discoveredRaw: Awaited<
    ReturnType<typeof client.listDiscoveredOperations>
  >;
  try {
    discoveredRaw = await client.listDiscoveredOperations();
  } catch (err) {
    cli.stderr(
      `Failed to list discovered operations: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }

  const discovered = new Set<EndpointKey>();
  const discoveredMap = new Map<EndpointKey, (typeof discoveredRaw)[number]>();
  for (const op of discoveredRaw) {
    const key = honoToOpenApiKey(op.method, op.endpoint);
    discovered.add(key);
    discoveredMap.set(key, op);
  }

  const onlyInSpec: EndpointKey[] = [];
  const onlyInDiscovery: EndpointKey[] = [];
  const inBoth: EndpointKey[] = [];

  for (const k of declared) {
    if (discovered.has(k)) inBoth.push(k);
    else onlyInSpec.push(k);
  }
  for (const k of discovered) {
    if (!declared.has(k)) onlyInDiscovery.push(k);
  }

  if (args.json) {
    cli.stdout(
      JSON.stringify(
        {
          inBoth: inBoth.sort(),
          onlyInSpec: onlyInSpec.sort(),
          onlyInDiscovery: onlyInDiscovery.sort(),
        },
        null,
        2,
      ),
    );
  } else {
    cli.stdout(`Declared in spec: ${declared.size}`);
    cli.stdout(`Discovered by Shield: ${discovered.size}`);
    cli.stdout(`In both: ${inBoth.length}`);
    if (onlyInSpec.length > 0) {
      cli.stdout("");
      cli.stdout("Only in spec (Shield hasn't seen traffic yet):");
      for (const k of onlyInSpec.sort()) cli.stdout(`  - ${k}`);
    }
    if (onlyInDiscovery.length > 0) {
      cli.stdout("");
      cli.stdout("Only in discovery (missing from your spec):");
      for (const k of onlyInDiscovery.sort()) cli.stdout(`  - ${k}`);
    }
  }

  return onlyInDiscovery.length > 0 ? 3 : 0;
};
