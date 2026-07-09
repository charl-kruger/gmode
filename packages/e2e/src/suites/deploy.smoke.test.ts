import { describe, expect, it } from "vitest";
import { runGmode } from "../harness/cli";
import { WEB_APP_TANSTACK } from "../harness/paths";

describe("gmode deploy smoke", () => {
  it("deploy --dry-run prints workers then gateway", async () => {
    const result = await runGmode(WEB_APP_TANSTACK, ["deploy", "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[dry-run] would deploy users");
    expect(result.stdout).toContain("[dry-run] would deploy dashboard");
    expect(result.stdout).toContain("[dry-run] would deploy gateway");
    expect(result.stdout).toContain("Dry run complete");
  });
});
