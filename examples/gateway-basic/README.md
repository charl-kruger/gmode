# GMode Example: Gateway + Users + Billing

This example shows a public Gateway Worker and two private Service Workers
(`users-api` and `billing-api`) wired together via Cloudflare Service Bindings.

## Run locally

Each Worker has its own `wrangler.jsonc`. In production they are three separate
Cloudflare Workers wired through Service Bindings. For local development, you
typically run each one in its own terminal:

```bash
# Terminal 1
cd users-api && cp .dev.vars.example .dev.vars && pnpm exec wrangler dev

# Terminal 2
cd billing-api && cp .dev.vars.example .dev.vars && pnpm exec wrangler dev

# Terminal 3
cd gateway && cp .dev.vars.example .dev.vars && pnpm exec wrangler dev
```

Then hit the gateway:

```bash
curl http://127.0.0.1:8787/users/123
curl http://127.0.0.1:8787/openapi.json
```

## Deploy

Set the secrets and deploy each Worker (services first, gateway last):

```bash
cd users-api && wrangler secret put INTERNAL_SIGNING_SECRET && wrangler deploy
cd ../billing-api && wrangler secret put INTERNAL_SIGNING_SECRET && wrangler deploy
cd ../gateway
wrangler secret put JWT_SECRET
wrangler secret put INTERNAL_SIGNING_SECRET
wrangler deploy
```

`INTERNAL_SIGNING_SECRET` MUST be identical across the gateway and all
services it forwards to.
