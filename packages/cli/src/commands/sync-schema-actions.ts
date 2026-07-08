import {
  listOpenApiOperations,
  openApiOperationKey,
  type OpenApiOperationKey,
  type OpenApiOperationSummary,
  type ShieldSchemaAction,
} from "@gmode/core";
import { createCloudflareClient } from "../cloudflare";
import { loadConfig } from "../config";
import { loadShieldSpec } from "../spec-loader";
import type {
  CliEnv,
  CliShieldSchemaActionRule,
  CommandRunner,
} from "../types";

type SyncSchemaActionsArgs = {
  from?: string;
  file?: string;
  dryRun: boolean;
  json: boolean;
  configPath?: string;
};

type ResolvedAction = {
  target: string;
  action: ShieldSchemaAction;
  operation: OpenApiOperationSummary;
  cloudflareOperationId: string;
};

type SyncSchemaActionsResult = {
  source: string;
  dryRun: boolean;
  actions: Array<{
    target: string;
    action: ShieldSchemaAction;
    operationKey: OpenApiOperationKey;
    operationId?: string;
    cloudflareOperationId: string;
    applied: boolean;
  }>;
};

function parseArgs(argv: string[]): SyncSchemaActionsArgs {
  const result: SyncSchemaActionsArgs = {
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--from") result.from = requireNext(argv, ++i, arg);
    else if (arg === "--file") result.file = requireNext(argv, ++i, arg);
    else if (arg === "--config") result.configPath = requireNext(argv, ++i, arg);
    else if (arg === "--dry-run") result.dryRun = true;
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

export const syncSchemaActions: CommandRunner = async (argv, cli) => {
  let args: SyncSchemaActionsArgs;
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
    const actionInput: {
      cli: CliEnv;
      file?: string;
      configActions?: CliShieldSchemaActionRule[];
      spec: { paths?: Record<string, Record<string, unknown>> };
    } = {
      cli,
      spec: loaded.spec,
    };
    if (args.file) actionInput.file = args.file;
    if (config.shield?.schemaActions) {
      actionInput.configActions = config.shield.schemaActions;
    }
    const actions = await loadActionRules(actionInput);
    if (actions.length === 0) {
      cli.stderr(
        "No schema actions configured. Provide --file <actions.json>, shield.schemaActions, or x-gmode-shield-action extensions.",
      );
      return 2;
    }

    const operations = listOpenApiOperations(loaded.spec);
    const discovered = await createCloudflareClient({
      apiToken: config.cloudflare.apiToken,
      zoneId: config.cloudflare.zoneId,
      fetchImpl: cli.fetch,
    }).listDiscoveredOperations();

    const resolved = resolveActions({
      actions,
      operations,
      discovered,
    });

    const client = createCloudflareClient({
      apiToken: config.cloudflare.apiToken,
      zoneId: config.cloudflare.zoneId,
      fetchImpl: cli.fetch,
    });

    const result: SyncSchemaActionsResult = {
      source: loaded.source,
      dryRun: args.dryRun,
      actions: [],
    };

    for (const action of resolved) {
      if (!args.dryRun) {
        await client.setOperationSchemaValidation({
          operationId: action.cloudflareOperationId,
          action: action.action,
        });
      }
      result.actions.push({
        target: action.target,
        action: action.action,
        operationKey: action.operation.key,
        ...(action.operation.operationId
          ? { operationId: action.operation.operationId }
          : {}),
        cloudflareOperationId: action.cloudflareOperationId,
        applied: !args.dryRun,
      });
    }

    if (args.json) {
      cli.stdout(JSON.stringify(result, null, 2));
    } else {
      writeHumanReport(cli, result);
    }
    return 0;
  } catch (err) {
    cli.stderr(
      `Failed to sync schema actions: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
};

async function loadActionRules(input: {
  cli: CliEnv;
  file?: string;
  configActions?: CliShieldSchemaActionRule[];
  spec: { paths?: Record<string, Record<string, unknown>> };
}): Promise<CliShieldSchemaActionRule[]> {
  if (input.file) {
    const raw = await input.cli.readFile(resolvePath(input.cli, input.file));
    const parsed = JSON.parse(raw) as unknown;
    return parseActionFile(parsed);
  }
  if (input.configActions) {
    return input.configActions.map(validateActionRule);
  }
  return actionsFromOpenApi(input.spec);
}

function parseActionFile(value: unknown): CliShieldSchemaActionRule[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Schema action file must be an object with an actions array");
  }
  const actions = (value as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) {
    throw new Error("Schema action file must contain an actions array");
  }
  return actions.map(validateActionRule);
}

function validateActionRule(value: unknown): CliShieldSchemaActionRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Schema action must be an object");
  }
  const record = value as Record<string, unknown>;
  const target = record["target"];
  const action = record["action"];
  if (typeof target !== "string" || target.length === 0) {
    throw new Error("Schema action target must be a non-empty string");
  }
  if (!isShieldSchemaAction(action)) {
    throw new Error("Schema action must be one of: none, log, block");
  }
  return { target, action };
}

function isShieldSchemaAction(value: unknown): value is ShieldSchemaAction {
  return value === "none" || value === "log" || value === "block";
}

function actionsFromOpenApi(input: {
  paths?: Record<string, Record<string, unknown>>;
}): CliShieldSchemaActionRule[] {
  const actions: CliShieldSchemaActionRule[] = [];
  for (const [path, pathItem] of Object.entries(input.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        continue;
      }
      const action = (operation as Record<string, unknown>)[
        "x-gmode-shield-action"
      ];
      if (action === undefined) continue;
      if (!isShieldSchemaAction(action)) {
        throw new Error(
          `Invalid x-gmode-shield-action on ${openApiOperationKey(method, path)}`,
        );
      }
      actions.push({
        target: openApiOperationKey(method, path),
        action,
      });
    }
  }
  return actions;
}

function resolveActions(input: {
  actions: CliShieldSchemaActionRule[];
  operations: OpenApiOperationSummary[];
  discovered: Array<{
    operation_id: string;
    method: string;
    endpoint: string;
  }>;
}): ResolvedAction[] {
  const byKey = new Map<OpenApiOperationKey, OpenApiOperationSummary>();
  const byOperationId = new Map<string, OpenApiOperationSummary>();
  for (const operation of input.operations) {
    byKey.set(operation.key, operation);
    if (operation.operationId) {
      byOperationId.set(operation.operationId, operation);
    }
  }

  const discoveredByKey = new Map<OpenApiOperationKey, string>();
  for (const operation of input.discovered) {
    discoveredByKey.set(
      openApiOperationKey(operation.method, operation.endpoint),
      operation.operation_id,
    );
  }

  return input.actions.map((action) => {
    const operation =
      byKey.get(action.target as OpenApiOperationKey) ??
      byOperationId.get(action.target);
    if (!operation) {
      throw new Error(
        `Schema action target "${action.target}" is not present in the public OpenAPI document`,
      );
    }
    const cloudflareOperationId = discoveredByKey.get(operation.key);
    if (!cloudflareOperationId) {
      throw new Error(
        `Schema action target "${action.target}" has not been discovered by Cloudflare API Shield yet`,
      );
    }
    return {
      target: action.target,
      action: action.action,
      operation,
      cloudflareOperationId,
    };
  });
}

function resolvePath(cli: CliEnv, path: string): string {
  return path.startsWith("/") ? path : `${cli.cwd}/${path}`;
}

function writeHumanReport(
  cli: CliEnv,
  result: SyncSchemaActionsResult,
): void {
  cli.stdout(`Source: ${result.source}`);
  cli.stdout(`Mode: ${result.dryRun ? "dry-run" : "apply"}`);
  cli.stdout(`Actions: ${result.actions.length}`);
  for (const action of result.actions) {
    cli.stdout(
      `  - ${action.operationKey} -> ${action.action} (${action.cloudflareOperationId})`,
    );
  }
}

function usage(): string {
  return "Usage: gmode shield:sync-schema-actions --from <url-or-path> [--file <actions.json>] [--dry-run] [--json]";
}
