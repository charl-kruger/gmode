# create-gmode
npm create entrypoint that scaffolds a GMode Cloudflare Workers app platform through `@gmode/cli`.

## Install

```bash
npm create gmode@latest my-app
```

Requires Node 22+. This package depends on `@gmode/cli` and forwards directly to `gmode init`.

## Quick example

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { run, type CliEnv } from "@gmode/cli";

const cli: CliEnv = {
  cwd: process.cwd(),
  env: process.env as Record<string, string | undefined>,
  fetch,
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  exit: process.exit,
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, contents) => writeFile(path, contents, "utf8"),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
};

await run(["init", "my-app"], cli);
```

The binary creates a workspace scaffold with a manifest, gateway Worker, service/web templates, generated binding sync, npm scripts, and the local dev dashboard wiring supplied by `@gmode/cli`.

![GMode dashboard screenshot](https://github.com/charl-kruger/gmode/raw/main/.github/assets/dashboard-light.png)

## API

| Export | Purpose |
|---|---|
| `create-gmode` binary | Runs `gmode init <dir>` with `my-gmode-app` as the default directory when no argument is passed. |
| `@gmode/cli run` | Underlying command dispatcher used by the binary. |
| `@gmode/cli templates` | Workspace, gateway, service, and web app templates installed by the CLI. |

## Works with

[`@gmode/cli`](../cli) · [`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/web`](../web) · [`@gmode/dashboard`](../dashboard) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
