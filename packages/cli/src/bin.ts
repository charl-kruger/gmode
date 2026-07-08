#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { run } from "./run";
import type { CliEnv } from "./types";

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

run(process.argv.slice(2), cli)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
