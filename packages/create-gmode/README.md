# create-gmode

Scaffold a [GMode](https://github.com/charl-kruger/gmode) app platform on
Cloudflare Workers.

```bash
pnpm create gmode my-app
# or
npm create gmode@latest my-app
```

## What you get

- `gmode.jsonc` manifest (single source of truth)
- Gateway Worker with generated `gmode.generated.ts`
- `GMODE_CONTEXT_SECRET` in `gateway/.dev.vars` for local HMAC signing
- pnpm workspace with `@gmode/cli` as a dev dependency
- Templates for adding services and web apps

## Next steps

```bash
cd my-app
pnpm install
pnpm exec gmode new service users
pnpm exec gmode new web dashboard --framework tanstack-start
pnpm dev
```

| URL | What |
|---|---|
| http://localhost:8787 | Public gateway |
| http://localhost:8787/docs | Aggregated Swagger UI |
| http://localhost:9100 | GMode dev dashboard |

## How it works

`create-gmode` is a thin wrapper over `gmode init` from `@gmode/cli`. All
scaffolding, templates, and the sync engine live in one place.

See [Workspace CLI](../../docs/workspace-cli.md) for the full command reference.
