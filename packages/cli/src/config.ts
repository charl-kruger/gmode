import type { CliConfig, CliEnv } from "./types";

const CONFIG_FILENAMES = [
  "gmode.config.json",
  ".gmode.json",
];

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T>,
): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[k] = deepMerge(
        existing as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export async function loadConfig(
  cli: CliEnv,
  override?: { configPath?: string; requireCloudflare?: boolean },
): Promise<CliConfig> {
  let fileConfig: Partial<CliConfig> = {};

  const explicit = override?.configPath;
  const candidates = explicit ? [explicit] : CONFIG_FILENAMES;

  for (const name of candidates) {
    const path = name.startsWith("/") ? name : `${cli.cwd}/${name}`;
    try {
      const contents = await cli.readFile(path);
      fileConfig = JSON.parse(contents) as Partial<CliConfig>;
      break;
    } catch {
      if (explicit) {
        cli.stderr(`Could not read config file: ${path}`);
        cli.exit(2);
      }
    }
  }

  const envConfig: Partial<CliConfig> = {
    cloudflare: {
      apiToken: cli.env["CLOUDFLARE_API_TOKEN"] ?? "",
      zoneId: cli.env["CLOUDFLARE_ZONE_ID"] ?? "",
      ...(cli.env["CLOUDFLARE_ACCOUNT_ID"]
        ? { accountId: cli.env["CLOUDFLARE_ACCOUNT_ID"] }
        : {}),
    },
  };

  const merged = deepMerge(
    fileConfig as CliConfig,
    envConfig as Partial<CliConfig>,
  );

  const requireCloudflare = override?.requireCloudflare ?? true;
  if (requireCloudflare) {
    if (!merged.cloudflare?.apiToken) {
      cli.stderr(
        "Missing Cloudflare API token. Set CLOUDFLARE_API_TOKEN or add cloudflare.apiToken to gmode.config.json.",
      );
      cli.exit(2);
    }
    if (!merged.cloudflare?.zoneId) {
      cli.stderr(
        "Missing Cloudflare zone ID. Set CLOUDFLARE_ZONE_ID or add cloudflare.zoneId to gmode.config.json.",
      );
      cli.exit(2);
    }
  }

  return merged;
}

/** Load optional gmode.config.json without requiring Cloudflare credentials. */
export async function loadOptionalConfig(
  cli: CliEnv,
  override?: { configPath?: string },
): Promise<Partial<CliConfig>> {
  return loadConfig(cli, { ...override, requireCloudflare: false });
}
