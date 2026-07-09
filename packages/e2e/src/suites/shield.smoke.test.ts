import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGmode } from "../harness/cli";
import { E2E_FIXTURES, REPO_ROOT } from "../harness/paths";
import { readE2EState } from "../harness/state";

const shieldEnv = {
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "e2e-offline",
  CLOUDFLARE_ZONE_ID: process.env.CLOUDFLARE_ZONE_ID ?? "e2e-offline",
};

const hasCloudflareCreds = Boolean(
  process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID,
);

describe("shield CLI smoke (offline)", () => {
  it("shield:sync-sequences --dry-run exports dashboard JSON", async () => {
    const sequences = join(E2E_FIXTURES, "sequences.json");
    const result = await runGmode(REPO_ROOT, [
      "shield:sync-sequences",
      "--file",
      sequences,
      "--dry-run",
    ]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      sequences: { name: string }[];
    };
    expect(parsed.sequences[0]?.name).toBe("e2e-login-then-profile");
  });

  it("shield:sync-sequences --out writes import file", async () => {
    const sequences = join(E2E_FIXTURES, "sequences.json");
    const out = join(E2E_FIXTURES, ".sequences-out.json");
    const result = await runGmode(REPO_ROOT, [
      "shield:sync-sequences",
      "--file",
      sequences,
      "--out",
      out,
    ]);
    expect(result.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const written = JSON.parse(readFileSync(out, "utf8")) as {
      sequences: unknown[];
    };
    expect(written.sequences.length).toBe(1);
  });
});

describe.skipIf(!hasCloudflareCreds)(
  "shield CLI smoke (live zone — requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID)",
  () => {
    const { gatewayBasicUrl } = readE2EState();
    const specFixture = join(E2E_FIXTURES, "openapi-shield.json");

    it("shield:diff-discovered --from local spec --json", async () => {
      const result = await runGmode(
        REPO_ROOT,
        ["shield:diff-discovered", "--from", specFixture, "--json"],
        shieldEnv,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        declaredCount: number;
        discoveredCount: number;
      };
      expect(parsed.declaredCount).toBeGreaterThan(0);
      expect(typeof parsed.discoveredCount).toBe("number");
    });

    it("shield:sync-schema-actions --from local spec --dry-run --json", async () => {
      const result = await runGmode(
        REPO_ROOT,
        [
          "shield:sync-schema-actions",
          "--from",
          specFixture,
          "--dry-run",
          "--json",
        ],
        shieldEnv,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        dryRun: boolean;
        actions: unknown[];
      };
      expect(parsed.dryRun).toBe(true);
      expect(parsed.actions.length).toBeGreaterThan(0);
    });

    it("shield:bootstrap --from live gateway OpenAPI --out (no upload)", async () => {
      const out = join(E2E_FIXTURES, ".bootstrap-out.json");
      const result = await runGmode(
        REPO_ROOT,
        [
          "shield:bootstrap",
          "--from",
          `${gatewayBasicUrl}/openapi.json?profile=shield`,
          "--out",
          out,
          "--json",
        ],
        shieldEnv,
      );
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as { includedCount: number };
      expect(parsed.includedCount).toBeGreaterThan(0);
      expect(existsSync(out)).toBe(true);
    });
  },
);

describe("shield spec from live gateway (no Cloudflare API)", () => {
  const { gatewayBasicUrl, webAppGatewayUrl } = readE2EState();

  it("gateway-basic OpenAPI shield profile is valid JSON", async () => {
    const res = await fetch(`${gatewayBasicUrl}/openapi.json?profile=shield`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: object };
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });

  it("web-app OpenAPI shield profile is valid JSON", async () => {
    const res = await fetch(`${webAppGatewayUrl}/openapi.json?profile=shield`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: object };
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });
});
