# @gmode/service

## 1.0.0

### Minor Changes

- 3419b38: Implement ServiceOptions.basePath route and OpenAPI prefixing.
- 9943a0f: Unify on Zod v4 across all packages; @gmode/service now emits JSON Schema via zod v4 natively.

### Patch Changes

- 01f38b5: Generate a stable `operationId` (e.g. `getUsersId`) for routes that omit one, so MCP tools and client codegen cover every route. Also corrected TSDoc defaults for `docs.internalOpenapi` and the gateway `defaults.auth` comment.
- 14c7765: Add MIT license and npm metadata (keywords, homepage, engines, sideEffects) to every package.
- 708ef50: Rewrite package READMEs for npm.
- Updated dependencies [01f38b5]
- Updated dependencies [14c7765]
- Updated dependencies [708ef50]
- Updated dependencies [9943a0f]
  - @gmode/core@1.0.0

## 0.1.1

### Patch Changes

- 0a23898: Add public npm package metadata and the GitHub release pipeline.
- Updated dependencies [0a23898]
  - @gmode/core@0.1.1
