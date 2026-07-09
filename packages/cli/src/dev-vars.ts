import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedEntry, ResolvedManifest } from "./manifest";

const SECRET_KEY = "GMODE_CONTEXT_SECRET";

function readSecretFromDevVars(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const match = readFileSync(path, "utf8").match(
    new RegExp(`^${SECRET_KEY}=(.+)$`, "m"),
  );
  const value = match?.[1]?.trim();
  return value || undefined;
}

function upsertDevVar(path: string, key: string, value: string): boolean {
  const line = `${key}=${value}`;
  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`, "utf8");
    return true;
  }
  const text = readFileSync(path, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) {
    const next = text.replace(pattern, line);
    if (next === text) return false;
    writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return true;
  }
  const next = text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`;
  writeFileSync(path, next, "utf8");
  return true;
}

/**
 * Copy the gateway's `GMODE_CONTEXT_SECRET` into every private service
 * Worker's `.dev.vars` so signed gateway context verifies in local dev.
 */
export function propagateContextSecret(resolved: ResolvedManifest): string[] {
  const gatewayDevVars = join(resolved.gatewayDir, ".dev.vars");
  const secret = readSecretFromDevVars(gatewayDevVars);
  if (!secret) return [];

  const updated: string[] = [];
  for (const entry of resolved.entries) {
    if (entry.kind !== "service") continue;
    const devVarsPath = join(entry.dir, ".dev.vars");
    if (upsertDevVar(devVarsPath, SECRET_KEY, secret)) {
      updated.push(entry.name);
    }
  }
  return updated;
}

/** Whether a worker directory has the expected context secret. */
export function hasContextSecret(dir: string, expected: string): boolean {
  return readSecretFromDevVars(join(dir, ".dev.vars")) === expected;
}

/** Service entries that trust the gateway and need the shared secret. */
export function serviceEntriesNeedingSecret(
  entries: ResolvedEntry[],
): ResolvedEntry[] {
  return entries.filter((e) => e.kind === "service");
}
