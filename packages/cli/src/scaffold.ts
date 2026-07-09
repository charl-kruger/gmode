import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Token replacements applied to template file contents and names. */
export type ScaffoldTokens = {
  /** Application (workspace) name. */
  appName: string;
  /** Entry name, for example `users` or `dashboard`. */
  name: string;
  /** Cloudflare Worker name. */
  workerName: string;
  /** Public gateway mount. */
  mount: string;
};

function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal ? pascal[0]!.toLowerCase() + pascal.slice(1) : pascal;
}

function applyTokens(text: string, tokens: ScaffoldTokens): string {
  return text
    .replaceAll("__APP_NAME__", tokens.appName)
    .replaceAll("__WORKER_NAME__", tokens.workerName)
    .replaceAll("__PASCAL_NAME__", pascalCase(tokens.name))
    .replaceAll("__CAMEL_NAME__", camelCase(tokens.name))
    .replaceAll("__MOUNT__", tokens.mount === "/" ? "" : tokens.mount)
    .replaceAll("__NAME__", tokens.name);
}

/** Resolve the CLI's bundled templates directory. */
export function templatesDir(): string {
  // dist/bin.js -> ../templates ; src/scaffold.ts (tests) -> ../templates
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "templates"),
    join(here, "..", "..", "templates"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Could not locate @gmode/cli templates directory");
}

const FILE_RENAMES: Record<string, string> = {
  _gitignore: ".gitignore",
};

/**
 * Copy a template tree into `targetDir`, applying token replacement to every
 * file. Refuses to overwrite existing files unless `overwrite` is set.
 */
export function scaffoldTemplate(input: {
  template: string;
  targetDir: string;
  tokens: ScaffoldTokens;
  overwrite?: boolean;
}): string[] {
  const source = join(templatesDir(), input.template);
  if (!existsSync(source)) {
    throw new Error(`Unknown template "${input.template}"`);
  }
  const written: string[] = [];

  const walk = (fromDir: string, toDir: string) => {
    mkdirSync(toDir, { recursive: true });
    for (const entry of readdirSync(fromDir)) {
      const fromPath = join(fromDir, entry);
      const outName = FILE_RENAMES[entry] ?? entry;
      const toPath = join(toDir, applyTokens(outName, input.tokens));
      if (statSync(fromPath).isDirectory()) {
        walk(fromPath, toPath);
        continue;
      }
      if (existsSync(toPath) && !input.overwrite) {
        throw new Error(`Refusing to overwrite existing file: ${toPath}`);
      }
      const contents = applyTokens(readFileSync(fromPath, "utf8"), input.tokens);
      writeFileSync(toPath, contents, "utf8");
      written.push(toPath);
    }
  };

  walk(source, input.targetDir);
  return written;
}
