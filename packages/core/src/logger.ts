/** Structured log severity. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured JSON log entry emitted by GMode helpers. */
export type LogEntry = {
  level: LogLevel;
  type?: string;
  message?: string;
  [key: string]: unknown;
};

/** Write a structured JSON log entry to the matching console method. */
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

/** Copy request headers into an object while redacting selected names. */
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
