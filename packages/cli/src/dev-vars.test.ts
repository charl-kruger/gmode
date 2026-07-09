import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { propagateContextSecret } from "./dev-vars";
import { loadManifest } from "./manifest";

function writeWorkspace(dir: string, withSecret: boolean): void {
  writeFileSync(
    join(dir, "gmode.jsonc"),
    `{
      "name": "demo",
      "gateway": { "path": "./gateway" },
      "services": [
        { "name": "users", "path": "./services/users", "mount": "/users" }
      ]
    }`,
    "utf8",
  );
  mkdirSync(join(dir, "gateway"), { recursive: true });
  mkdirSync(join(dir, "services", "users"), { recursive: true });
  writeFileSync(join(dir, "gateway", "wrangler.jsonc"), "{}", "utf8");
  writeFileSync(join(dir, "services", "users", "wrangler.jsonc"), "{}", "utf8");
  if (withSecret) {
    writeFileSync(
      join(dir, "gateway", ".dev.vars"),
      "GMODE_CONTEXT_SECRET=abc123\n",
      "utf8",
    );
  }
}

describe("propagateContextSecret", () => {
  it("copies the gateway secret into service .dev.vars", () => {
    const dir = mkdtempSync(join(tmpdir(), "gmode-secret-"));
    try {
      writeWorkspace(dir, true);
      const resolved = loadManifest(join(dir, "gmode.jsonc"));
      const updated = propagateContextSecret(resolved);
      expect(updated).toEqual(["users"]);
      expect(readFileSync(join(dir, "services", "users", ".dev.vars"), "utf8")).toBe(
        "GMODE_CONTEXT_SECRET=abc123\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-ops when the gateway has no secret", () => {
    const dir = mkdtempSync(join(tmpdir(), "gmode-secret-"));
    try {
      writeWorkspace(dir, false);
      const resolved = loadManifest(join(dir, "gmode.jsonc"));
      expect(propagateContextSecret(resolved)).toEqual([]);
      expect(existsSync(join(dir, "services", "users", ".dev.vars"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
