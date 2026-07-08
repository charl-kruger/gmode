export type RedactOptions = {
  placeholder?: string;
  removeKeys?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function redact<T>(
  value: T,
  paths: readonly string[],
  options: RedactOptions = {},
): T {
  if (paths.length === 0) return value;
  const placeholder = options.placeholder ?? "[REDACTED]";
  const removeKeys = options.removeKeys ?? false;

  const tokensList = paths.map((p) => p.split("."));

  function walk(node: unknown, depth: number): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, depth));
    }
    if (!isPlainObject(node)) return node;
    const next: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node)) {
      const matched = tokensList.find((tokens) => {
        if (tokens.length <= depth) return false;
        const head = tokens[depth];
        return head === key || head === "*";
      });
      if (matched && depth === matched.length - 1) {
        if (removeKeys) continue;
        next[key] = placeholder;
        continue;
      }
      next[key] = walk(val, depth + 1);
    }
    return next;
  }

  return walk(value, 0) as T;
}
