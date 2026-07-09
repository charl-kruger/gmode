import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Monorepo root (`/gmode`). */
export const REPO_ROOT = join(here, "../../../..");

export const EXAMPLES = join(REPO_ROOT, "examples");

export const WEB_APP_TANSTACK = join(EXAMPLES, "web-app-tanstack");

export const GATEWAY_BASIC = join(EXAMPLES, "gateway-basic");

export const GATEWAY_BASIC_GATEWAY = join(GATEWAY_BASIC, "gateway");

export const E2E_FIXTURES = join(REPO_ROOT, "packages/e2e/fixtures");

/** Binary from the repo root `node_modules/.bin`. */
export function repoBin(name: string): string {
  return join(REPO_ROOT, "node_modules/.bin", name);
}

/** Built `create-gmode` CLI entry. */
export function createGmodeBin(): string {
  const bin = join(REPO_ROOT, "packages/create-gmode/dist/bin.js");
  if (!existsSync(bin)) {
    throw new Error(
      `create-gmode not built at ${bin}. Run: pnpm --filter create-gmode build`,
    );
  }
  return bin;
}

/** Built `gmode` CLI entry (requires `pnpm --filter @gmode/cli build`). */
export function gmodeBin(): string {
  const bin = join(REPO_ROOT, "packages/cli/dist/bin.js");
  if (!existsSync(bin)) {
    throw new Error(
      `gmode CLI not built at ${bin}. Run: pnpm --filter @gmode/cli build`,
    );
  }
  return bin;
}
