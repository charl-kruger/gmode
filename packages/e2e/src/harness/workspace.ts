import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TempWorkspace = {
  dir: string;
  cleanup: () => void;
};

/** Create an isolated directory for greenfield `gmode init` tests. */
export function createTempWorkspace(prefix = "gmode-e2e-"): TempWorkspace {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    },
  };
}
