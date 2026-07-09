import type { HealthReport } from "./types";

export function healthFor(
  health: HealthReport | null,
  name: string,
): { label: string; className: string } {
  const entry = health?.services?.find((s) => s.name === name);
  if (!entry) return { label: "—", className: "" };
  return entry.ok
    ? { label: "healthy", className: "ok" }
    : { label: entry.error ?? `HTTP ${entry.status ?? "?"}`, className: "bad" };
}
