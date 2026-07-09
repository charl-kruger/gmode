/**
 * Minimal JSONC support for gmode.jsonc and wrangler.jsonc files.
 *
 * Handles line/block comments and trailing commas without external
 * dependencies. Also provides a text-preserving editor for replacing a
 * top-level array property (used to sync the gateway's `services` binding
 * list) so user comments elsewhere in the file survive.
 */

/** Strip comments and trailing commas, then `JSON.parse` the result. */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripJsonComments(text)) as T;
}

/** Remove `//` and `/* *\/` comments plus trailing commas, string-aware. */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\") {
        if (next !== undefined) {
          out += next;
          i += 2;
          continue;
        }
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  // Remove trailing commas before ] or } (string-aware second pass).
  let cleaned = "";
  inString = false;
  for (let j = 0; j < out.length; j++) {
    const ch = out[j]!;
    if (inString) {
      cleaned += ch;
      if (ch === "\\") {
        cleaned += out[j + 1] ?? "";
        j++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ",") {
      let k = j + 1;
      while (k < out.length && /\s/.test(out[k]!)) k++;
      if (out[k] === "]" || out[k] === "}") {
        continue;
      }
    }
    cleaned += ch;
  }

  return cleaned;
}

type PropertyRange = {
  /** Index of the first character of the property key (the opening quote). */
  keyStart: number;
  /** Index of the value's opening bracket/brace/first char. */
  valueStart: number;
  /** Index one past the value's final character. */
  valueEnd: number;
};

/**
 * Find the character range of a top-level property's value in a JSONC
 * document. Returns `null` when the property is absent.
 */
export function findTopLevelProperty(
  text: string,
  key: string,
): PropertyRange | null {
  let i = 0;
  let inString = false;
  let stringStart = -1;
  let depth = 0;
  let lastStringValue = "";
  let lastStringStart = -1;

  const skipComment = (): boolean => {
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      return true;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      return true;
    }
    return false;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        lastStringValue = text.slice(stringStart + 1, i);
        lastStringStart = stringStart;
      }
      i++;
      continue;
    }
    if (skipComment()) continue;
    if (ch === '"') {
      inString = true;
      stringStart = i;
      i++;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      i++;
      continue;
    }
    if (ch === ":" && depth === 1 && lastStringValue === key) {
      const keyStart = lastStringStart;
      i++;
      while (i < text.length) {
        if (/\s/.test(text[i]!)) {
          i++;
          continue;
        }
        if (skipComment()) continue;
        break;
      }
      const valueStart = i;
      const valueEnd = scanValueEnd(text, valueStart);
      return { keyStart, valueStart, valueEnd };
    }
    i++;
  }

  return null;
}

function scanValueEnd(text: string, start: number): number {
  const first = text[start];
  if (first === "{" || first === "[") {
    const open = first;
    const close = first === "{" ? "}" : "]";
    let depth = 0;
    let i = start;
    let inString = false;
    while (i < text.length) {
      const ch = text[i]!;
      if (inString) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === '"') inString = false;
        i++;
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
          i++;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = true;
        i++;
        continue;
      }
      if (ch === open) depth++;
      if (ch === close) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error("Unbalanced brackets while scanning JSONC value");
  }
  if (first === '"') {
    let i = start + 1;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === '"') return i + 1;
      i++;
    }
    throw new Error("Unterminated string while scanning JSONC value");
  }
  // Primitive: scan to the next comma, closing brace/bracket, or newline.
  let i = start;
  while (i < text.length && !/[,\]}\n]/.test(text[i]!)) i++;
  return i;
}

/**
 * Append an object literal to a top-level array property in a JSONC document,
 * preserving all other text. Creates the property when missing.
 */
export function appendToTopLevelArray(
  text: string,
  key: string,
  itemJson: string,
): string {
  const range = findTopLevelProperty(text, key);
  if (!range || text[range.valueStart] !== "[") {
    return upsertTopLevelProperty(text, key, `[\n    ${itemJson}\n  ]`);
  }

  const arrayText = text.slice(range.valueStart, range.valueEnd);
  const inner = arrayText.slice(1, -1);
  const isEmpty = stripJsonComments(inner).trim() === "";

  const closeIndex = range.valueEnd - 1;
  if (isEmpty) {
    const replacement = `[\n    ${itemJson}\n  ]`;
    return (
      text.slice(0, range.valueStart) + replacement + text.slice(range.valueEnd)
    );
  }

  // Walk back from `]` over whitespace to the last meaningful character.
  let probe = closeIndex - 1;
  while (probe > range.valueStart && /\s/.test(text[probe]!)) probe--;
  const needsComma = text[probe] !== ",";
  const insertion = `${needsComma ? "," : ""}\n    ${itemJson}\n  `;
  return text.slice(0, probe + 1) + insertion + text.slice(closeIndex);
}

/**
 * Replace (or insert) a top-level property's value in a JSONC document while
 * preserving all other text, comments included.
 */
export function upsertTopLevelProperty(
  text: string,
  key: string,
  valueJson: string,
): string {
  const range = findTopLevelProperty(text, key);
  if (range) {
    return (
      text.slice(0, range.valueStart) + valueJson + text.slice(range.valueEnd)
    );
  }

  // Insert before the final closing brace of the document.
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) {
    throw new Error("Document has no top-level object to insert into");
  }
  let insertAt = lastBrace;
  // Walk back over whitespace to find the last meaningful character.
  let probe = lastBrace - 1;
  while (probe >= 0 && /\s/.test(text[probe]!)) probe--;
  const needsComma = probe >= 0 && text[probe] !== "{" && text[probe] !== ",";
  const prefix = needsComma ? "," : "";
  const insertion = `${prefix}\n  ${JSON.stringify(key)}: ${valueJson}\n`;
  return text.slice(0, insertAt) + insertion + text.slice(insertAt);
}
