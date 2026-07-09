# @gmode/cli

The GMode workspace CLI and Cloudflare API Shield tooling.

Binary: **`gmode`**

## Install

In a scaffolded workspace:

```bash
pnpm add -D @gmode/cli
pnpm exec gmode --help
```

Or scaffold a new app (includes the CLI):

```bash
pnpm create gmode my-app
```

## Workspace Commands

| Command | Description |
|---|---|
| `gmode init [dir]` | Create manifest + gateway + pnpm workspace |
| `gmode new service <name>` | Scaffold a private API Worker |
| `gmode new web <name>` | Scaffold TanStack Start or Vite React app |
| `gmode sync` | Manifest → wrangler bindings + `gmode.generated.ts` |
| `gmode doctor` | Validate manifest, drift, secrets, ports |
| `gmode dev` | Run gateway, services, web apps, dev dashboard |
| `gmode deploy` | Deploy services/web first, gateway last |
| `gmode generate client` | Typed client from OpenAPI URL or file |
| `gmode generate types` | `wrangler types` for every worker |

Full guide: [docs/workspace-cli.md](../../docs/workspace-cli.md)

## Shield Commands

| Command | Credentials required |
|---|---|
| `gmode shield:push-schema` | Yes |
| `gmode shield:bootstrap` | Yes (reads discovery API) |
| `gmode shield:diff-discovered` | Yes |
| `gmode shield:sync-schema-actions` | Yes |
| `gmode shield:sync-sequences` | Only for live sync; `--dry-run` / `--out` are offline |

Configure via `gmode.config.json` or `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ZONE_ID`. See [docs/api-shield.md](../../docs/api-shield.md).

## Programmatic API

```ts
import { run, type CliEnv } from "@gmode/cli";

const code = await run(["doctor"], cliEnv);
```

Used by `create-gmode` and the E2E test harness.
