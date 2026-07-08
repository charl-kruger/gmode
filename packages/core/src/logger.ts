export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  type?: string;
  message?: string;
  [key: string]: unknown;
};

export function logStructured(entry: LogEntry): void {
  const out = JSON.stringify(entry);
  switch (entry.level) {
    case "error":
      console.error(out);
      return;
    case "warn":
      console.warn(out);
      return;
    case "debug":
      console.debug(out);
      return;
    default:
      console.log(out);
  }
}

export function redactHeaders(
  headers: Headers,
  names: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const lowered = names.map((n) => n.toLowerCase());
  headers.forEach((value, key) => {
    out[key] = lowered.includes(key.toLowerCase()) ? "[redacted]" : value;
  });
  return out;
}
