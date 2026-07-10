# @gmode/core

## 1.0.0

### Minor Changes

- 9943a0f: Unify on Zod v4 across all packages; @gmode/service now emits JSON Schema via zod v4 natively.

### Patch Changes

- 01f38b5: `serializeError` now honors `ApiError.expose: false` — internal errors no longer leak their message or details to clients (code becomes `INTERNAL_ERROR`; real message/stack only with `includeStack`).
- 14c7765: Add MIT license and npm metadata (keywords, homepage, engines, sideEffects) to every package.
- 708ef50: Rewrite package READMEs for npm.

## 0.1.1

### Patch Changes

- 0a23898: Add public npm package metadata and the GitHub release pipeline.
