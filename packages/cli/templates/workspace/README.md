# __APP_NAME__

A [GMode](https://github.com/charl-kruger/gmode) API platform on Cloudflare Workers.

## Develop

```bash
pnpm install
pnpm dev        # runs the gateway, every service, web apps, and the dev dashboard
```

- Gateway: http://localhost:8787
- API docs: http://localhost:8787/docs
- Dev dashboard: http://localhost:9100

## Add a service or web app

```bash
pnpm exec gmode new service payments
pnpm exec gmode new web dashboard --framework tanstack-start
```

`gmode.jsonc` is the single source of truth for the service graph. `gmode sync`
(run automatically by `dev` and `deploy`) keeps wrangler service bindings and
the gateway's typed `gmode.generated.ts` in lockstep.

## Deploy

```bash
pnpm deploy     # services first, gateway last
```
