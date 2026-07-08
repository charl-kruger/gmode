export function matchesScope(required: string, granted: string[]): boolean {
  if (granted.includes("*")) return true;
  if (granted.includes(required)) return true;
  for (const g of granted) {
    if (g.endsWith(":*")) {
      const prefix = g.slice(0, -1);
      if (required.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function matchesAllScopes(
  required: string[],
  granted: string[],
): boolean {
  return required.every((r) => matchesScope(r, granted));
}

export function isValidRequestId(value: string): boolean {
  if (value.length < 1 || value.length > 256) return false;
  return /^[A-Za-z0-9._\-:/]+$/.test(value);
}
