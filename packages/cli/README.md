# @gmode/cli
Command-line workspace engine for scaffolding, syncing, running, deploying, generating, and Shield-managing GMode apps.

## Install

```bash
npm i -D @gmode/cli
```

Requires Node 22+. Installs `@gmode/core` and `@gmode/dashboard`; Cloudflare deploy commands expect Wrangler in the generated workspace.

## Quick example

```ts
import { run, type CliEnv } from "@gmode/cli";

const cli: CliEnv = {
  cwd: process.cwd(),
  env: process.env as Record<string, string | undefined>,
  fetch,
  stdout: console.log,
  stderr: console.error,
  exit: process.exit,
  readFile: (path) => import("node:fs/promises").then((fs) => fs.readFile(path, "utf8")),
  writeFile: (path, body) => import("node:fs/promises").then((fs) => fs.writeFile(path, body)),
  mkdir: (path) => import("node:fs/promises").then((fs) => fs.mkdir(path, { recursive: true }).then(() => {})),
};

const code = await run(["init", "my-app", "--name", "my-app"], cli);
if (code !== 0) process.exit(code);
```

Command reference from `src/run.ts`:

| Command | Purpose |
|---|---|
| `init [dir] [--name app]` | Create a GMode workspace manifest and gateway. |
| `new service <name>` | Scaffold a private API service and register it. |
| `new web <name>` | Scaffold a TanStack Start or Vite React web app. |
| `sync` | Sync `gmode.jsonc` into Wrangler bindings and generated code. |
| `doctor` | Validate manifest, bindings, secrets, and drift. |
| `dev` | Run gateway, services, web apps, and dashboard. |
| `deploy` | Deploy services first, gateway last. |
| `generate client` | Generate a typed TypeScript client from OpenAPI. |
| `generate types` | Run Wrangler types for every worker and re-sync. |
| `shield:push-schema` | Upload Shield-compatible OpenAPI to Schema Validation. |
| `shield:bootstrap` | Prune a Shield schema from discovered traffic. |
| `shield:diff-discovered` | Diff spec operations against discovered endpoints. |
| `shield:sync-schema-actions` | Apply per-endpoint schema validation actions. |
| `shield:sync-sequences` | Sync a `defineSequences()` policy to Cloudflare. |

## API

| Export | Purpose |
|---|---|
| `run` | Dispatch CLI argv against a `CliEnv`. |
| `CliEnv`, `CommandRunner`, `CliConfig` | Injectable CLI environment and command types. |
| `loadConfig` | Load Shield command config. |
| `findManifestPath`, `loadManifest`, `MANIFEST_FILENAME` | Locate and read `gmode.jsonc`. |
| `toBindingName`, `toDevUrlVar`, `toWorkerName` | Manifest naming helpers. |
| `runSync`, `renderGeneratedModule`, `renderWranglerServices` | Sync engine and generated code renderers. |
| `scaffoldTemplate`, `templatesDir` | Workspace template utilities. |
| `parseJsonc`, `stripJsonComments`, `upsertTopLevelProperty`, `appendToTopLevelArray` | JSONC editing helpers. |
| `generateClientSource` | OpenAPI client code generator. |
| `createCloudflareClient`, `CloudflareError`, `loadShieldSpec`, `buildDashboardImport` | Cloudflare API, Shield spec, and dashboard helpers. |

## Works with

[`create-gmode`](../create-gmode) · [`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/dashboard`](../dashboard) · [`@gmode/client`](../client) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
