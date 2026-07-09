# create-gmode

Create a [GMode](https://github.com/charl-kruger/gmode) app platform on Cloudflare Workers:

```bash
pnpm create gmode my-app
cd my-app
pnpm install
pnpm exec gmode new service users
pnpm dev
```

You get a gateway Worker, a `gmode.jsonc` manifest, orchestrated local dev with
a dashboard, aggregated Swagger docs, and signed service-to-service context —
out of the box.
