import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type E2EState = {
  gatewayBasicUrl: string;
  webAppGatewayUrl: string;
  dashboardUrl: string;
};

const STATE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.e2e-state.json",
);

export function e2eStatePath(): string {
  return STATE_FILE;
}

export function readE2EState(): E2EState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `E2E state file missing at ${STATE_FILE}. Run via vitest globalSetup (pnpm test:e2e:smoke).`,
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;
}
