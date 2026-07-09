# GMode Examples

Both examples live inside the GMode monorepo and depend on local workspace
packages (`workspace:*` in their `package.json` files). They are **not**
standalone npm projects you can copy elsewhere without also publishing or
vendoring `@gmode/*`.

## Install (required on every machine)

Run these from the **repository root**, not from inside `examples/*`:

```bash
corepack enable          # once per machine — enables the pnpm version from package.json
pnpm install             # links workspace packages into every example
pnpm build               # compiles @gmode/* into dist/ (gateway, service, web, …)
```

`pnpm install` inside `examples/web-app-tanstack` alone is not enough. pnpm
must see the root `pnpm-workspace.yaml` so `@gmode/gateway`, `@gmode/web`, and
the rest resolve to `packages/*` instead of missing or stale tarballs.

After the root build, you can run an example:

```bash
# Full manifest workspace (gateway + service + TanStack web app)
cd examples/web-app-tanstack
cp gateway/.dev.vars.example gateway/.dev.vars
pnpm dev

# Smaller gateway-only demo (users + billing + MCP)
cd examples/gateway-basic
cp gateway/.dev.vars.example gateway/.dev.vars
cp users-api/.dev.vars.example users-api/.dev.vars
cp billing-api/.dev.vars.example billing-api/.dev.vars
cd gateway && pnpm dev
```

Each Worker’s `wrangler.jsonc` runs `pnpm build:deps` before bundling so
changes to `packages/*/src` are picked up during `wrangler dev`. The **first**
run still needs the root `pnpm build` so `dist/` exists at all.

## Troubleshooting

### `gateway.web is not a function` (or similar missing API on `createGateway`)

The gateway Worker is loading an old or empty `@gmode/gateway` build that does
not include the `web()` helper used by `gmode sync` in `gmode.generated.ts`.

Fix:

```bash
# from repo root
pnpm install
pnpm build
```

Then restart dev (`pnpm dev` in the example, or `gmode dev` for web-app-tanstack).

Verify the built package exports `web`:

```bash
grep -n 'web(' packages/gateway/dist/index.js | head
```

If that grep returns nothing, `pnpm build` failed or was skipped.

### `Cannot find module '@gmode/…'`

You installed only inside an example directory. Go back to the repo root and run
`pnpm install` there.

### Service binding / worker name errors

Run `pnpm exec gmode sync` from the example workspace root (web-app-tanstack) so
`wrangler.jsonc` bindings and `gmode.generated.ts` match `gmode.jsonc`.

## Examples

| Example | README |
|---|---|
| [gateway-basic](./gateway-basic/README.md) | JWT, MCP, RPC, Shield OpenAPI |
| [web-app-tanstack](./web-app-tanstack/README.md) | Manifest, `gmode dev`, TanStack Start, codegen |

More detail: [TESTING.md](../TESTING.md).
