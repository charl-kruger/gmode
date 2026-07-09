# Release Process

GMode packages are published under the public `@gmode` npm scope from the
GitHub `Release` workflow.

## Versioning Model

Changesets owns package versions. Public packages are configured as a fixed
group while GMode is pre-1.0, so a release PR bumps the `@gmode/*` packages and
`create-gmode` as a coherent set.

Fixed group (from `.changeset/config.json`):

`@gmode/core`, `@gmode/service`, `@gmode/gateway`, `@gmode/rpc`, `@gmode/cli`,
`@gmode/mcp`, `@gmode/testing`, `@gmode/web`, `@gmode/client`,
`@gmode/dashboard`, `create-gmode`

Pre-1.0 compatibility policy:

- Patch version: fixes, docs, tests, and additive internals.
- Minor version: additive public APIs, new packages, or deliberate behavior
  changes behind explicit options.
- Major version before `1.0.0`: breaking changes may still happen in minor
  bumps, but the changeset summary must call them out directly.

## Contributor Flow

Create a changeset for any public package change:

```bash
pnpm changeset
```

Select the affected packages and choose the semver bump. If the change is only
docs, examples, tests, or internal CI wiring, do not create a changeset unless
the package contents or consumer behavior changed.

Run the local gate before opening a PR:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:smoke
pnpm build
git diff --check
```

## GitHub Flow

The repository has two workflows:

- **CI** — on pushes to `main` and pull requests:
  - `verify`: typecheck, unit tests, build
  - `e2e-smoke`: `pnpm test:e2e:smoke` (15 min timeout)
- **Release** — on pushes to `main`: verifies the repo, then either opens a
  Changesets version PR or publishes packages when the version PR is merged.

When a feature PR with changesets lands on `main`, the release workflow opens
or updates a version PR. Review the generated package versions and changelog
entries, then merge that version PR to publish.

## npm Setup

Required repository secret:

- `NPM_TOKEN` — npm automation token with publish access to the `@gmode` scope.

The workflow uses `actions/setup-node` with the npm registry and passes
`NODE_AUTH_TOKEN` to `pnpm publish`. Do not commit a project-level `.npmrc`
with token placeholders.

Published package metadata must keep:

- `publishConfig.access: "public"` for every scoped package.
- `repository.url: "git+https://github.com/charl-kruger/gmode.git"`.
- `repository.directory` pointing at the package directory.

The publish command is:

```bash
pnpm publish-packages
```

That runs recursive `pnpm publish` for unpublished `@gmode/*` versions with
public access, provenance, and no git checks. Pnpm resolves workspace protocol
dependencies during packing.

## Package Review

Inspect tarballs before the first public release or after any packaging change:

```bash
for package in core service gateway rpc cli mcp testing web client dashboard; do
  pnpm --filter "@gmode/$package" pack --pack-destination /tmp/gmode-packs
done
pnpm --filter create-gmode pack --pack-destination /tmp/gmode-packs
```

Each tarball should contain `dist`, package metadata, a package `README.md`,
and no local test fixtures, generated temp output, secrets, or source-only
workspace paths.

Scaffold templates ship inside `@gmode/cli` and pin `^0.1.0` (or the current
published version) for consumer `package.json` dependencies.

## Post-Publish

Verify npm metadata:

```bash
npm view @gmode/core version
npm view @gmode/gateway version
npm view @gmode/cli version
npm view @gmode/web version
npm view @gmode/client version
npm view create-gmode version
```

If any publish step fails, fix the package or npm configuration and rerun the
workflow. Do not manually continue a partial release from a different commit.
