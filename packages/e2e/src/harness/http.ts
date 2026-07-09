export type HealthBody = {
  ok: boolean;
  gateway?: { name: string; version: string };
  services?: { name: string; mount: string; ok: boolean; status?: number }[];
};

export async function waitForHealth(
  gatewayUrl: string,
  options?: { timeoutMs?: number },
): Promise<HealthBody> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${gatewayUrl}/__gmode/health`);
      if (res.ok) {
        const body = (await res.json()) as HealthBody;
        if (body.ok) return body;
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(1000);
  }

  throw new Error(
    `Gateway not healthy at ${gatewayUrl} within ${timeoutMs}ms: ${lastError}`,
  );
}

export async function waitForReadyLine(
  predicate: () => boolean,
  options?: { timeoutMs?: number; label?: string },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for ${options?.label ?? "ready"} (${timeoutMs}ms)`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
