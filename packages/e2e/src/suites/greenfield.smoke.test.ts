import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGmode } from "../harness/cli";
import { createTempWorkspace } from "../harness/workspace";

describe("greenfield workspace smoke", () => {
  let workspace = createTempWorkspace();

  afterEach(() => {
    workspace.cleanup();
    workspace = createTempWorkspace();
  });

  it("gmode init scaffolds a workspace with gateway and secret", async () => {
    const result = await runGmode(workspace.dir, ["init", ".", "--name", "acme"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Created GMode workspace "acme"');

    expect(existsSync(join(workspace.dir, "gmode.jsonc"))).toBe(true);
    expect(existsSync(join(workspace.dir, "gateway/wrangler.jsonc"))).toBe(true);
    expect(
      existsSync(join(workspace.dir, "gateway/src/gmode.generated.ts")),
    ).toBe(true);

    const devVars = readFileSync(
      join(workspace.dir, "gateway/.dev.vars"),
      "utf8",
    );
    expect(devVars).toMatch(/^GMODE_CONTEXT_SECRET=[0-9a-f]{64}$/m);
  });

  it("gmode new service registers bindings and generated code", async () => {
    expect((await runGmode(workspace.dir, ["init", ".", "--name", "acme"])).code).toBe(
      0,
    );
    const result = await runGmode(workspace.dir, [
      "new",
      "service",
      "users",
      "--mount",
      "/users",
    ]);
    expect(result.code).toBe(0);

    const manifest = readFileSync(join(workspace.dir, "gmode.jsonc"), "utf8");
    expect(manifest).toContain('"users"');
    expect(manifest).toContain('"/users"');
    expect(existsSync(join(workspace.dir, "services/users/src/index.ts"))).toBe(
      true,
    );

    const generated = readFileSync(
      join(workspace.dir, "gateway/src/gmode.generated.ts"),
      "utf8",
    );
    expect(generated).toContain('gateway.service("users"');
    expect(generated).toContain("USERS_API: FetcherLike");

    const wrangler = readFileSync(
      join(workspace.dir, "gateway/wrangler.jsonc"),
      "utf8",
    );
    expect(wrangler).toContain('"USERS_API"');
    expect(wrangler).toContain('"acme-users"');
  });

  it("gmode new web scaffolds vite app and gateway.web registration", async () => {
    expect((await runGmode(workspace.dir, ["init", ".", "--name", "acme"])).code).toBe(
      0,
    );
    const result = await runGmode(workspace.dir, [
      "new",
      "web",
      "dashboard",
      "--framework",
      "vite-react",
      "--mount",
      "/app",
    ]);
    expect(result.code).toBe(0);

    expect(existsSync(join(workspace.dir, "apps/dashboard/src/server.ts"))).toBe(
      true,
    );
    const server = readFileSync(
      join(workspace.dir, "apps/dashboard/src/server.ts"),
      "utf8",
    );
    expect(server).toContain('basePath: "/app"');

    const generated = readFileSync(
      join(workspace.dir, "gateway/src/gmode.generated.ts"),
      "utf8",
    );
    expect(generated).toContain('gateway.web("dashboard"');
    expect(generated).toContain("DASHBOARD_APP: FetcherLike");
  });

  it("doctor passes on a fully scaffolded workspace", async () => {
    expect((await runGmode(workspace.dir, ["init", ".", "--name", "acme"])).code).toBe(
      0,
    );
    expect(
      (await runGmode(workspace.dir, ["new", "service", "users"])).code,
    ).toBe(0);

    const doctor = await runGmode(workspace.dir, ["doctor"]);
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain("All checks passed");
  });
});
