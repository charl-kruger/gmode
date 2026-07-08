# Release Process

GMode packages are published under the `@gmode` npm scope.

## Versioning

Use synchronized package versions for the first public releases. All packages
start at `0.1.0`; bump every package together until the API surface stabilizes.

Pre-1.0 compatibility policy:

- Patch version: fixes, docs, tests, and additive internals.
- Minor version: additive public APIs, new packages, or behavior gated behind
  explicit options.
- Major version before `1.0.0`: breaking changes may still happen in minor
  bumps, but must be called out in `CHANGELOG.md`.

## Preflight

Run the full local release gate:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Confirm the working tree is clean before publishing:

```bash
git status --short
```

## Package Review

Inspect the package tarballs before publishing:

```bash
for package in core service gateway rpc cli mcp testing; do
  pnpm --filter "@gmode/$package" pack --pack-destination /tmp/gmode-packs
done
```

Check that each tarball contains `dist`, package metadata, and no local test
fixtures, generated temp output, secrets, or source-only workspace paths.

## Publish

Authenticate to npm as a user with access to the `gmode` org:

```bash
npm whoami
```

Publish packages in dependency order:

```bash
pnpm --filter @gmode/core publish --access public --no-git-checks
pnpm --filter @gmode/testing publish --access public --no-git-checks
pnpm --filter @gmode/service publish --access public --no-git-checks
pnpm --filter @gmode/rpc publish --access public --no-git-checks
pnpm --filter @gmode/gateway publish --access public --no-git-checks
pnpm --filter @gmode/cli publish --access public --no-git-checks
pnpm --filter @gmode/mcp publish --access public --no-git-checks
```

If any publish fails, stop and fix the package state. Do not continue with a
partial release unless the failed package is independent of already-published
packages and the changelog is updated accordingly.

## Post-Publish

Verify npm metadata:

```bash
npm view @gmode/core version
npm view @gmode/service version
npm view @gmode/gateway version
npm view @gmode/rpc version
npm view @gmode/cli version
npm view @gmode/mcp version
npm view @gmode/testing version
```

Create and push a git tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```
