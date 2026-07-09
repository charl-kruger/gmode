#!/usr/bin/env node
/**
 * `pnpm create gmode my-app` / `npm create gmode@latest my-app`
 *
 * Thin wrapper over `gmode init` so the workspace scaffold, templates, and
 * sync engine live in exactly one place (@gmode/cli).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { run, type CliEnv } from "@gmode/cli";

const args = process.argv.slice(2);
const initArgs = args.length === 0 ? ["my-gmode-app"] : args;

const cli: CliEnv = {
  cwd: process.cwd(),
  env: process.env as Record<string, string | undefined>,
  fetch,
  stdout: (line: string) => process.stdout.write(`${line}\n`),
  stderr: (line: string) => process.stderr.write(`${line}\n`),
  exit: (code: number) => process.exit(code),
  readFile: (path: string) => readFile(path, "utf8"),
  writeFile: (path: string, contents: string) =>
    writeFile(path, contents, "utf8"),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => {}),
};

run(["init", ...initArgs], cli)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
