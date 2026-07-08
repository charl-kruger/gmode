import type { OpenApiDocument } from "@gmode/core";
import { toShieldCompatibleSpec } from "@gmode/core";
import type { CliEnv } from "./types";

export type LoadedSpec = {
  spec: OpenApiDocument;
  source: string;
  shieldWarningCount: number;
};

export async function loadShieldSpec(input: {
  cli: CliEnv;
  from: string;
}): Promise<LoadedSpec> {
  const { cli, from } = input;
  const isUrl = /^https?:\/\//i.test(from);

  let raw: string;
  if (isUrl) {
    const url = new URL(from);
    if (!url.searchParams.has("profile")) {
      url.searchParams.set("profile", "shield");
    }
    const res = await cli.fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `Failed to fetch spec from ${url.toString()}: HTTP ${res.status}`,
      );
    }
    raw = await res.text();
  } else {
    raw = await cli.readFile(
      from.startsWith("/") ? from : `${cli.cwd}/${from}`,
    );
  }

  let parsed: OpenApiDocument;
  try {
    parsed = JSON.parse(raw) as OpenApiDocument;
  } catch (err) {
    throw new Error(
      `Failed to parse spec as JSON from ${from}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (parsed.openapi?.startsWith("3.0")) {
    return {
      spec: parsed,
      source: from,
      shieldWarningCount: 0,
    };
  }

  const { spec, warnings } = toShieldCompatibleSpec(parsed);
  return {
    spec,
    source: from,
    shieldWarningCount: warnings.length,
  };
}
