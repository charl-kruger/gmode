import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { runGmode } from "../harness/cli";
import { readE2EState } from "../harness/state";
import { WEB_APP_TANSTACK } from "../harness/paths";

describe("generated client live calls", () => {
  const { webAppGatewayUrl } = readE2EState();
  const outDir = join(WEB_APP_TANSTACK, "generated-e2e-live");
  const clientFile = join(outDir, "gmode-client.ts");

  beforeAll(async () => {
    const result = await runGmode(WEB_APP_TANSTACK, [
      "generate",
      "client",
      "--url",
      `${webAppGatewayUrl}/openapi.json`,
      "--out",
      outDir,
    ]);
    expect(result.code).toBe(0);
  });

  it("createClient().getUser() hits the live gateway", async () => {
    expect(existsSync(clientFile)).toBe(true);
    const mod = await import(pathToFileURL(clientFile).href);
    const client = mod.createClient({ baseUrl: webAppGatewayUrl });
    const user = await client.getUser({ params: { id: "u_1" } });
    expect(user.id).toBe("u_1");
    expect(typeof user.email).toBe("string");
  });

  it("createClient() throws ApiClientError on 404", async () => {
    const mod = await import(pathToFileURL(clientFile).href);
    const client = mod.createClient({ baseUrl: webAppGatewayUrl });
    await expect(
      client.getUser({ params: { id: "missing" } }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 404,
    });
  });
});
