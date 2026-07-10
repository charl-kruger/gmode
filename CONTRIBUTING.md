# Contributing

Thanks for contributing to GMode. This repo is a pnpm monorepo using Turbo, Biome, and Changesets.

## Development setup

Use Node 24. pnpm 11 requires a modern Node runtime, and CI runs on Node 24.

```bash
corepack enable
pnpm install
```

Run commands from the repository root.

## Gates

The full gate must pass before a change is considered ready:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:smoke
pnpm build
```

## Changesets

Any change to package contents or consumer behavior requires a changeset:

```bash
pnpm changeset
```

Repo-level docs, tests, and CI-only changes do not require a changeset.

## Pull requests

- Use conventional commits.
- Keep the gate green.
- Add a changeset when package contents or consumer behavior changes.
- Update docs when behavior, commands, or public APIs change.

## Package layout

- `@gmode/cli` (`packages/cli`): GMode CLI: scaffold, run, and deploy Cloudflare Workers app platforms (gateway + services + web apps) with one command.
- `@gmode/client` (`packages/client`): Typed fetch client runtime for GMode gateways - pairs with `gmode generate client`.
- `@gmode/core` (`packages/core`): Shared GMode primitives for Cloudflare Workers gateway and service packages.
- `create-gmode` (`packages/create-gmode`): Create a GMode app platform on Cloudflare Workers with one command: `pnpm create gmode my-app`.
- `@gmode/dashboard` (`packages/dashboard`): Prebuilt local dev dashboard UI served by `gmode dev`.
- `@gmode/e2e` (`packages/e2e`): End-to-end smoke tests for the GMode platform (live wrangler / gmode dev).
- `@gmode/gateway` (`packages/gateway`): Focused API gateway runtime for GMode on Cloudflare Workers.
- `@gmode/mcp` (`packages/mcp`): MCP catalog and operation tools for GMode gateways.
- `@gmode/rpc` (`packages/rpc`): Typed WorkerEntrypoint RPC helpers for GMode services.
- `@gmode/service` (`packages/service`): Private service Worker runtime for GMode.
- `@gmode/testing` (`packages/testing`): Test clients and Cloudflare binding mocks for GMode.
- `@gmode/web` (`packages/web`): Run full web apps (TanStack Start, Vite SPAs) as GMode gateway services with typed, documented APIs.
