import {
  listOpenApiOperations,
  openApiOperationKey,
  pruneOpenApiDocument,
  type OpenApiOperationKey,
} from "@gmode/core";
import { createCloudflareClient } from "../cloudflare";
import { loadConfig } from "../config";
import { loadShieldSpec } from "../spec-loader";
import type { CliEnv, CommandRunner } from "../types";

type BootstrapShieldArgs = {
  from?: string;
  out?: string;
  name?: string;
  upload: boolean;
  json: boolean;
  configPath?: string;
};

type BootstrapResult = {
  source: string;
  schemaName: string;
  discoveredCount: number;
  declaredCount: number;
  includedCount: number;
  onlyInSpec: OpenApiOperationKey[];
  onlyInDiscovery: OpenApiOperationKey[];
  included: OpenApiOperationKey[];
  outputPath?: string;
  uploadedSchema?: {
    id: string;
    name: string;
  };
  shieldWarningCount: number;
};

function parseArgs(argv: string[]): BootstrapShieldArgs {
  const result: BootstrapShieldArgs = {
    upload: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--from") result.from = requireNext(argv, ++i, arg);
    else if (arg === "--out") result.out = requireNext(argv, ++i, arg);
    else if (arg === "--name") result.name = requireNext(argv, ++i, arg);
    else if (arg === "--config") result.configPath = requireNext(argv, ++i, arg);
    else if (arg === "--upload") result.upload = true;
    else if (arg === "--json") result.json = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return result;
}

function requireNext(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}. ${usage()}`);
  }
  return value;
}

export const bootstrapShield: CommandRunner = async (argv, cli) => {
  let args: BootstrapShieldArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    cli.stderr(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const configOptions: { configPath?: string } = {};
  if (args.configPath) configOptions.configPath = args.configPath;
  const config = await loadConfig(cli, configOptions);

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

  try {
    const loaded = await loadShieldSpec({ cli, from });
    const client = createCloudflareClient({
      apiToken: config.cloudflare.apiToken,
      zoneId: config.cloudflare.zoneId,
      fetchImpl: cli.fetch,
    });
    const discoveredRaw = await client.listDiscoveredOperations();
    const discovered = new Set(
      discoveredRaw.map((operation) =>
        openApiOperationKey(operation.method, operation.endpoint),
      ),
    );
    const declared = new Set(
      listOpenApiOperations(loaded.spec).map((operation) => operation.key),
    );
    const pruned = pruneOpenApiDocument({
      spec: loaded.spec,
      operationKeys: discovered,
    });
    const schemaName =
      args.name ??
      (loaded.spec.info.title
        ? `gmode:${loaded.spec.info.title}:discovered`
        : "gmode-discovered-schema");

    const result: BootstrapResult = {
      source: loaded.source,
      schemaName,
      discoveredCount: discovered.size,
      declaredCount: declared.size,
      includedCount: pruned.included.length,
      onlyInSpec: difference([...declared], discovered).sort(),
      onlyInDiscovery: difference([...discovered], declared).sort(),
      included: pruned.included.map((operation) => operation.key).sort(),
      shieldWarningCount: loaded.shieldWarningCount,
    };

    if (args.out) {
      const outputPath = resolvePath(cli, args.out);
      await cli.writeFile(outputPath, JSON.stringify(pruned.spec, null, 2));
      result.outputPath = outputPath;
    }

    if (args.upload) {
      const upload = await client.uploadUserSchema({
        name: schemaName,
        kind: "openapi_v3",
        enabled: true,
        body: JSON.stringify(pruned.spec),
      });
      result.uploadedSchema = upload;
    }

    if (args.json) {
      cli.stdout(JSON.stringify(result, null, 2));
    } else {
      writeHumanReport(cli, result);
    }

    return result.onlyInDiscovery.length > 0 ? 3 : 0;
  } catch (err) {
    cli.stderr(
      `Failed to bootstrap Shield schema: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
};

function difference<T>(left: T[], right: Set<T>): T[] {
  return left.filter((item) => !right.has(item));
}

function resolvePath(cli: CliEnv, path: string): string {
  return path.startsWith("/") ? path : `${cli.cwd}/${path}`;
}

function writeHumanReport(cli: CliEnv, result: BootstrapResult): void {
  cli.stdout(`Source: ${result.source}`);
  cli.stdout(`Schema name: ${result.schemaName}`);
  cli.stdout(`Declared in spec: ${result.declaredCount}`);
  cli.stdout(`Discovered by Shield: ${result.discoveredCount}`);
  cli.stdout(`Included in pruned schema: ${result.includedCount}`);
  if (result.shieldWarningCount > 0) {
    cli.stdout(
      `Shield compatibility adjustments: ${result.shieldWarningCount}`,
    );
  }
  if (result.outputPath) {
    cli.stdout(`Wrote pruned schema: ${result.outputPath}`);
  }
  if (result.uploadedSchema) {
    cli.stdout(
      `Uploaded schema "${result.uploadedSchema.name}" (id: ${result.uploadedSchema.id})`,
    );
  }
  if (result.onlyInSpec.length > 0) {
    cli.stdout("");
    cli.stdout("Only in spec (Shield has not seen traffic yet):");
    for (const key of result.onlyInSpec) cli.stdout(`  - ${key}`);
  }
  if (result.onlyInDiscovery.length > 0) {
    cli.stdout("");
    cli.stdout("Only in discovery (missing from your GMode spec):");
    for (const key of result.onlyInDiscovery) cli.stdout(`  - ${key}`);
  }
}

function usage(): string {
  return "Usage: gmode shield:bootstrap --from <url-or-path> [--out <file>] [--upload] [--name <schema-name>] [--json]";
}
