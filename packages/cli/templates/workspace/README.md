# __APP_NAME__

A [GMode](https://github.com/charl-kruger/gmode) API platform on Cloudflare Workers.

## Develop

```bash
__PM_INSTALL__
__PM_RUN__ dev        # gateway, services, web apps, and the dev dashboard
```

| URL | What |
|---|---|
| http://localhost:8787 | Public gateway |
| http://localhost:8787/docs | Aggregated Swagger UI |
| http://localhost:9100 | GMode dev dashboard |

## Add workers

```bash
__PM_EXEC__ gmode new service payments
__PM_EXEC__ gmode new web admin --framework tanstack-start
__PM_EXEC__ gmode new web marketing --framework vite-react
```

`gmode.jsonc` is the single source of truth. `gmode sync` (run automatically by
`dev` and `deploy`) keeps wrangler service bindings and
`gateway/src/gmode.generated.ts` in lockstep.

## Validate and codegen

```bash
__PM_EXEC__ gmode doctor
__PM_EXEC__ gmode generate client --url http://localhost:8787/openapi.json --out ./generated
__PM_EXEC__ gmode generate types
```

## Deploy

```bash
__PM_RUN__ deploy              # services + web apps first, gateway last
__PM_RUN__ deploy --dry-run    # preview without deploying
```

Set production secrets on every Worker:

```bash
wrangler secret put GMODE_CONTEXT_SECRET
```

See [GMode workspace CLI docs](https://github.com/charl-kruger/gmode/blob/main/docs/workspace-cli.md).
