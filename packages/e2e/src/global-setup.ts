import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { startDevServers } from "./harness/dev-servers";
import { e2eStatePath } from "./harness/state";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const servers = await startDevServers();
  writeFileSync(
    e2eStatePath(),
    JSON.stringify({
      gatewayBasicUrl: servers.gatewayBasicUrl,
      webAppGatewayUrl: servers.webAppGatewayUrl,
      dashboardUrl: servers.dashboardUrl,
    }),
    "utf8",
  );

  return async () => {
    await servers.stop();
    if (existsSync(e2eStatePath())) {
      unlinkSync(e2eStatePath());
    }
  };
}
