# GMode DX Excellence Plan

**Goal:** bring GMode — the framework, the `@gmode/*` SDKs, the CLI, the docs, and the npm
presence — to the polish level of a flagship Vercel-labs project (benchmark:
[vercel-labs/native](https://github.com/vercel-labs/native)). A developer with nothing but
Node and npm installed must go from zero to a running, documented, typed API platform in
**under 60 seconds**, and every touchpoint (README, npm page, docs, error messages, CLI
output) must feel deliberate and first-class.

Each task below is written to be **outsourced to a coding agent (Codex) as an independent
work item**: it carries its own context, exact file paths, precise changes, and acceptance
criteria. Read the **Execution context** section first — it applies to every task.

---

## Execution context (read before any task)

**Repo:** `github.com/charl-kruger/gmode` — pnpm monorepo, Turbo, Biome, Changesets.

- **Node:** requires ≥ 22.13 for pnpm 11.7. Use Node 24 (`~/.nvm/versions/node/v24.14.0/bin`
  on PATH if the default node is older). CI uses Node 24.
- **Install / gate commands** (run from repo root; the full gate must pass before any task
  is considered done):
  ```bash
  pnpm install
  pnpm typecheck        # tsc across 27 projects
  pnpm lint             # biome
  pnpm test             # unit + integration, no network (turbo: test dependsOn build)
  pnpm test:e2e:smoke   # live wrangler + gmode dev, ~3 min, hermetic (no CF login)
  pnpm build
  ```
- **Packages (all publish from `packages/*`; versions are a Changesets *fixed group* —
  every release bumps all 11 together):** `@gmode/core`, `@gmode/gateway`, `@gmode/service`,
  `@gmode/rpc`, `@gmode/mcp`, `@gmode/web`, `@gmode/client`, `@gmode/cli`,
  `@gmode/dashboard`, `@gmode/testing`, `create-gmode`. `@gmode/e2e` is private.
- **Releases:** merge to `main` → GitHub `Release` workflow → `changeset publish`
  (idempotent, provenance enabled via `NPM_CONFIG_PROVENANCE=true`). **Any change to
  package contents or consumer behavior requires a changeset** (`pnpm changeset`);
  docs/tests/CI-only changes do not.
- **Style:** match surrounding code. Biome enforces lint. TSDoc comments on exported
  symbols follow the existing style in `packages/core/src/*.ts`.
- **Do not** rename packages, change the fixed-group versioning, or alter
  `.github/workflows/release.yml` publish semantics without an explicit task saying so.

**Current published state:** all 11 packages live on npm at `0.1.1`.

---

## Scoreboard — where we are vs. the bar

| Dimension | vercel-labs/native | GMode today | Gap |
|---|---|---|---|
| Install → running app | `npm i -g` + 2 commands, < 1 min | `pnpm create gmode` — **pnpm-only**, templates hard-code pnpm | **P1** |
| Root README | Positioning line, hero visuals, quick start, opinionated pillars, examples table, docs link | Solid but internal-facing; no visuals, no pillars, pnpm-first | **P1** |
| LICENSE | MIT, in repo + packages | **No LICENSE file anywhere; no `license` field in any of the 12 package.jsons** (root says ISC) | **P0 — legal blocker** |
| npm package pages | Rich per-package READMEs | `@gmode/core` 8 lines, `@gmode/mcp` & `@gmode/rpc` 6 lines; **0 keywords, no homepage, no engines, no sideEffects — in all 12** | **P1** |
| Docs | Dedicated site (native-sdk.dev), guides + reference | 21 good markdown files in `docs/`, no site, no API reference | **P2** |
| Community files | Issue templates, contributing, security | **None** (no CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / templates) | **P2** |
| Correctness | — | Known bugs: `ApiError.expose` leak, RPC-over-binding dispatch 500, Zod v3/v4 split, CI e2e red on main | **P0** |

---

## Task index

| ID | Task | Priority | Size | Depends on |
|---|---|---|---|---|
| GM-01 | MIT license everywhere | P0 | S | — |
| GM-02 | Fix `ApiError.expose` information leak | P0 | S | — |
| GM-03 | Fix CI: e2e-smoke red on `main` | P0 | M | — |
| GM-04 | Fix `@gmode/rpc` WorkerEntrypoint dispatch (500) | P0 | L | — |
| GM-05 | Unify Zod across packages | P0 | M | — |
| GM-06 | Package-manager-agnostic scaffolding & CLI | P1 | L | — |
| GM-07 | The 60-second quickstart (end-to-end) | P1 | M | GM-06 |
| GM-08 | Root README rewrite to flagship quality | P1 | M | GM-07 |
| GM-09 | Per-package READMEs (npm landing pages) | P1 | M | — |
| GM-10 | npm metadata: engines, keywords, homepage, sideEffects | P1 | S | GM-01 |
| GM-11 | CLI output & error-message polish | P1 | M | GM-06 |
| GM-12 | Docs site (Astro Starlight on Cloudflare) | P2 | L | GM-08 |
| GM-13 | API reference generation (TypeDoc → docs site) | P2 | M | GM-12 |
| GM-14 | Fix doc/impl mismatches | P2 | S | — |
| GM-15 | Community & trust files | P2 | S | GM-01 |
| GM-16 | `ServiceOptions.basePath`: implement or remove | P3 | S | — |
| GM-17 | `cloudflareRateLimit` dead default-key branch | P3 | S | — |
| GM-18 | MCP catalog caching | P3 | S | — |
| GM-19 | Unify CLI argument parsing | P3 | M | GM-11 |
| GM-20 | Gateway defaults `scopes`/`permissions`: implement or remove | P3 | S | — |
| GM-21 | Response-header mutation consistency in middleware | P3 | S | — |
| GM-22 | Examples: one-command run + Deploy button | P3 | M | GM-06 |
| GM-23 | Road to 1.0 (versioning & stability policy) | P4 | S | all P0–P1 |

---

## P0 — Blockers (legal, security, broken CI)

### GM-01 · MIT license everywhere

**Why:** There is **no LICENSE file in the repo** and **no `license` field in any
package.json**. npm shows "license: none"; legally nobody can adopt these packages. This is
the single highest-priority defect. (Root `package.json` says `ISC`, which was never a
deliberate choice — standardize on **MIT** like Vercel OSS.)

**Changes:**
1. Add `/LICENSE` — standard MIT text, copyright `2026 Charl Kruger`.
2. Root `package.json`: `"license": "ISC"` → `"license": "MIT"`.
3. Every `packages/*/package.json` (all 12, incl. private e2e): add `"license": "MIT"`.
4. Ship the file in tarballs: copy `LICENSE` into each publishable package directory
   (committed copies — simplest and reliable) and add `"LICENSE"` to every package's
   `files` array.
5. Add a changeset (`patch`, all packages): "Add MIT license."

**Acceptance:** `LICENSE` exists at root and in each publishable package dir;
`node -e "console.log(require('./packages/core/package.json').license)"` prints `MIT` for
all; `pnpm --filter @gmode/core pack --pack-destination /tmp/x` tarball contains `LICENSE`.

### GM-02 · Fix `ApiError.expose` information leak

**Why:** `ApiError` accepts `expose?: boolean` (default true) and `error.internal()` sets
`expose: false` — but `serializeError()` in `packages/core/src/errors.ts` (~line 137)
ignores `expose` and **always serializes `message` and `details`** for any `ApiError`.
Internal errors constructed as ApiError leak their message/details to clients.

**Changes (in `packages/core/src/errors.ts`):**
1. In `serializeError`, when `err instanceof ApiError && err.expose === false`: emit
   `code: "INTERNAL_ERROR"`, `message: "Internal server error"`, keep `status`, omit
   `details`; still include `requestId`; include real message/stack only when
   `includeStack` is true (dev mode).
2. Add unit tests in `packages/core/src/errors.test.ts`: exposed error keeps
   message/details; `expose:false` error redacts message and details but keeps status;
   `includeStack:true` reveals stack.
3. Grep for callers relying on the old behavior:
   `grep -rn "expose" packages/*/src` — update any test expectations.
4. Changeset (`patch`): "serializeError now honors ApiError.expose; internal errors no
   longer leak messages/details."

**Acceptance:** new tests pass; `pnpm test` green; changeset present.

### GM-03 · Fix CI: e2e-smoke red on `main`

**Why:** The `E2E smoke` job failed on commit `5499b8c` even though
`pnpm test:e2e:smoke` passes locally (45 passed / 4 skipped, hermetic — no Cloudflare
login required). The harness now **dumps each dev-server's captured output on health
timeout** (`packages/e2e/src/harness/dev-servers.ts`), so the CI log contains the real
cause between `----- <name> output -----` markers.

**Steps:**
1. Open the failed run: `gh run list --repo charl-kruger/gmode --workflow CI --limit 5`,
   then `gh run view <id> --log-failed`. Find the `----- gateway-basic output -----` /
   `----- gmode-dev output -----` blocks and the `Gateway not healthy at …` line.
2. Diagnose. Known candidates, in likelihood order:
   - Cold-runner startup (workerd download + 2 Vite builds) still exceeding 240s →
     raise `E2E_HEALTH_TIMEOUT_MS` via workflow env, and/or cache workerd/wrangler
     artifacts with `actions/cache` keyed on the wrangler version in `pnpm-lock.yaml`.
   - A port-collision or Vite `--strictPort` failure for the web app.
   - The dashboard collector port being taken.
3. Fix the actual cause (not just timeout inflation).
4. If flaky rather than broken, add one retry around `startDevServers()` only (not around
   assertions), with a comment explaining why.

**Acceptance:** two consecutive green `E2E smoke` jobs on `main` (re-trigger with a trivial
commit or `gh workflow run`). Local `pnpm test:e2e:smoke` still green.

### GM-04 · Fix `@gmode/rpc` WorkerEntrypoint dispatch

**Why:** Service-to-service RPC over a Cloudflare service binding **returns 500 under
`wrangler dev`** — `billing-api → users-api getUserById` in `examples/gateway-basic`. It
fails regardless of gateway context/auth (reproduced with `trustGateway` removed), meaning
Cloudflare JSRPC cannot dispatch the method that `defineEntrypoint()`
(`packages/rpc/src/entrypoint.ts`) adds to the WorkerEntrypoint prototype via
`Object.defineProperty`. Setting `enumerable: true` did **not** fix it. The e2e assertion
`POST /billing/invoices uses RPC to join user email` in
`packages/e2e/src/suites/gateway-basic.smoke.test.ts` is currently `it.skip` with a
KNOWN ISSUE comment.

**Steps:**
1. Reproduce (billing as primary so its console is visible):
   ```bash
   cd examples/gateway-basic/billing-api
   ../../../node_modules/.bin/wrangler dev -c wrangler.jsonc -c ../users-api/wrangler.jsonc \
     --ip 127.0.0.1 --port 35010
   ```
   POST a signed context directly (mint with `encodeSignedGatewayContext` from
   `@gmode/core` dist; secret `dev-secret-change-me`, `aud: "billing"`).
2. Instrument `packages/rpc/src/client.ts` around `bindingFn.call(...)` (console.error the
   caught error; rebuild `@gmode/rpc`) to capture the raw Cloudflare error. Also log
   `typeof env.USERS_API.getUserById` inside the billing handler.
3. Root-cause hypotheses to test, in order:
   a. CF JSRPC only exposes methods **declared on the class** (not defineProperty'd after
      class creation). Fix candidates: build the class with real methods (computed keys at
      class-body time), or expose a single generic `rpc(name, envelope)` method on the
      entrypoint and route inside it — update `createRpcClient` to call
      `binding.rpc(name, envelope)`; per-method typing on the client stays unchanged.
   b. The envelope hits structured-clone constraints — unlikely; verify.
   c. wrangler multi-config dev limitation — if so, document it and find the
      compatibility flag or version that fixes it.
4. Whatever the fix, **add a test that exercises real WorkerEntrypoint dispatch** (unit
   tests currently call `service.invoke()` directly and pass, which is why this was never
   caught). Options: `@cloudflare/vitest-pool-workers`, or promote the e2e smoke assertion
   to canonical coverage.
5. Un-skip the e2e assertion; `pnpm test:e2e:smoke` → the invoice test returns 201.
6. Changeset (`patch`, or `minor` if the client wire format changes): describe precisely.

**Acceptance:** invoice smoke test un-skipped and green; a dispatch-level test exists;
full gate green.

### GM-05 · Unify Zod across packages

**Why:** `@gmode/mcp` depends on `zod ^4.4.3`; `core`, `gateway`, `service`, `rpc` depend
on `^3.23.8`. Zod v3 and v4 schemas are not interchangeable; users following our docs
(`import { z } from "@gmode/service"`) get v3 while mcp internally uses v4. Silent runtime
breakage risk + double-bundle weight.

**Steps:**
1. Inventory v4-specific API usage in `packages/mcp/src`:
   `grep -rn "z\." packages/mcp/src` and check each call against the v3 API.
2. **Preferred direction: move every package to Zod v4** (current major; native
   `z.toJSONSchema` could later replace `zod-to-json-schema` in `@gmode/service`):
   - Update all five package.jsons to `"zod": "^4.4.3"`; let `pnpm typecheck` drive the
     fix list.
   - `packages/service/src/schema.ts` uses `zod-to-json-schema` (v3-oriented) — replace
     with `z.toJSONSchema()` where possible; keep emitted OpenAPI identical (guard with
     the existing snapshots in `packages/service/src/service.test.ts`).
   - `ZodError` shape differs v3→v4 — check `serializeError` in core and its tests.
   - If the v4 migration exceeds ~1 day of work, **fall back** to pinning mcp to
     `^3.23.8` (verify mcp compiles on v3) and note the v4 migration as follow-up here.
3. `@gmode/service` re-exports `z` — after unification, state the shipped zod major in its
   README.
4. Changeset (`minor` for v4 — user-visible typing changes; `patch` if pin-down).

**Acceptance:** exactly one zod major across `packages/*/package.json`
(`grep '"zod"' packages/*/package.json`); full gate green.

---

## P1 — The 60-second experience

### GM-06 · Package-manager-agnostic scaffolding & CLI

**Why:** Everything assumes pnpm. `create-gmode` is advertised as `pnpm create gmode`;
scaffolded workspaces contain `pnpm-workspace.yaml` and scripts that call `pnpm …`; the CLI
shells out to hard-coded `pnpm` (`packages/cli/src/commands/dev.ts` ~207/230,
`deploy.ts` ~68, `generate.ts` ~82). The average dev has **npm**. The Vercel bar: npm,
pnpm, yarn, and bun all work, and we never ask the user to install a tool they don't have.

**Changes:**
1. **Detect the invoking PM** in `create-gmode`/`gmode init`: parse
   `process.env.npm_config_user_agent` (prefix `npm/`, `pnpm/`, `yarn/`, `bun/`; default
   `npm`). New helper `packages/cli/src/pm.ts`:
   `detectPackageManager(): { name, runCmd, execCmd, installCmd }` + unit tests.
2. **Templates emit PM-appropriate workspaces** (`packages/cli/templates/workspace/`):
   - npm / yarn / bun → `"workspaces": ["gateway", "services/*", "apps/*"]` in the root
     package.json, **no** `pnpm-workspace.yaml`.
   - pnpm → keep `pnpm-workspace.yaml`.
   - Extend the token replacement in `packages/cli/src/scaffold.ts` with `__PM_RUN__`,
     `__PM_EXEC__`, `__PM_INSTALL__` tokens; replace every literal `pnpm` in template
     package.json scripts and template READMEs with tokens.
3. **CLI stops shelling to a hard-coded PM.** Where the CLI runs a package *binary*
   (`wrangler`, `vite`), resolve it directly from `node_modules/.bin` relative to the
   workspace root (walk up like `findManifestPath`) — PM-agnostic and faster. Files:
   `dev.ts`, `deploy.ts`, `generate.ts`. Where the CLI runs a *script* (web app `dev`),
   use the detected PM's run command. Persist the PM chosen at `init` into `gmode.jsonc`
   as optional `"packageManager"` so later commands agree (add to
   `packages/cli/gmode.schema.json` + `manifest.ts` types).
4. **Wrangler `build.command` hooks** in templates/examples use `pnpm build:deps` —
   tokenize the same way (or invoke `node_modules/.bin/turbo` directly).
5. **e2e coverage:** extend `packages/e2e/src/suites/create-gmode.smoke.test.ts` to
   scaffold with a simulated npm user agent
   (`npm_config_user_agent="npm/10.0.0 node/v24.0.0 darwin x64"`) and assert: root
   package.json has `workspaces`, no `pnpm-workspace.yaml`, no literal `pnpm` in scripts.
6. Changeset (`minor`): "create-gmode and the CLI now work with npm, yarn, and bun in
   addition to pnpm."

**Acceptance:** in a temp dir with pnpm **removed from PATH**, running the built
`node packages/create-gmode/dist/bin.js my-app` with the npm user-agent env →
`cd my-app && npm install && npm run dev` boots the gateway on 8787 and `/docs` serves
Swagger. e2e suite green.

### GM-07 · The 60-second quickstart (end-to-end hardening)

**Why:** The full first-run path must be measured and made frictionless. Target on a warm
network: `npm create gmode@latest my-app` → `cd my-app` → `npm install` → `npm run dev` →
browser open, **≤ 60s, zero prompts, zero global installs, zero Cloudflare login** (the
hermetic-dev property is already validated: no `wrangler login` needed).

**Steps:**
1. Add `scripts/measure-quickstart.sh` (repo tooling, not shipped): runs the four commands
   in a temp dir with a cold npm cache, prints per-step timings. Run it; record numbers in
   the PR description.
2. Kill every prompt and warning in the flow:
   - `gmode init` must not ask questions (verify — it currently doesn't).
   - `gmode dev` passes `WRANGLER_SEND_METRICS=false` through the spawn env so wrangler's
     first-run telemetry prompt can never appear.
   - Audit `npm install` output for peer-dep warnings from our templates; fix versions.
3. `gmode dev` first-boot banner (GM-11) prints the three URLs (gateway, docs, dashboard)
   and nothing noisier above them.
4. Extend the greenfield e2e suite to assert time-to-healthy < 120s in CI (generous cold
   budget; local target stays 60).

**Acceptance:** measured timings in PR description; scaffold → dev flow has zero
prompts/warnings; greenfield e2e asserts the healthy-within-budget check.

### GM-08 · Root README rewrite

**Why:** The README is the front door. Ours is informative but reads like an internal
handbook (tables of links). The benchmark: one bold positioning line, an immediate visual,
a copy-paste quick start, opinionated "What you get" pillars, an examples table, a docs
link. Narrative, not scaffolding.

**Structure to write (replace `README.md`):**
1. `# GMode` + one-liner: *"GMode is the complete toolkit for building API platforms on
   Cloudflare Workers."* + two short positioning paragraphs: one public gateway Worker,
   private services over Service Bindings, HMAC-signed context, manifest-driven CLI — and
   why that shape (small public edge, typed contracts, zero-config local orchestration).
2. **Hero visual:** dev dashboard + `/docs` Swagger side by side. Capture from `gmode dev`
   (dashboard :9100) in light & dark, store under `.github/assets/`, use the `<picture>`
   prefers-color-scheme pattern like the benchmark. (Screenshots need a human/computer-use
   pass — leave `<!-- TODO: capture -->` placeholders if not automatable.)
3. **Quick start** (npm-first; only truthful after GM-06 lands):
   ```bash
   npm create gmode@latest my-app
   cd my-app && npm install
   npm run dev
   ```
   Follow with a ~15-line annotated sample: a `createService` route (Zod schema, typed
   handler) and the matching `gateway.service(...)` line — the authoring model at a
   glance.
4. **"What you get" pillars** (bold lead + 2–3 sentences each): *Typed end to end* (Zod →
   OpenAPI → generated client → MCP tools from one source of truth) · *A real edge
   architecture, not a router* (public gateway, private services, signed context) ·
   *Local dev that mirrors production* (one command, all workers, live dashboard) ·
   *Docs are a build artifact* (aggregated OpenAPI, Swagger/Scalar built in) ·
   *AI-native* (MCP server over your API in one line) · *Ship with confidence* (testing
   package, API Shield integration).
5. **Examples table** (existing two + the GM-22 quickstart example).
6. **Packages table** (keep, tighten descriptions).
7. Community footer: license, contributing, security links (GM-15), docs-site link
   (placeholder until GM-12, then real).
8. Badges row under the title: npm version (`@gmode/core`), CI status, license.

**Acceptance:** README renders correctly on GitHub (verify dark-mode image variants); all
commands copy-paste-run on a clean machine; no pnpm-only instructions remain above the
monorepo/contributing section (monorepo dev itself may stay pnpm).

### GM-09 · Per-package READMEs

**Why:** The package README **is the npm landing page**. `@gmode/core` has 8 lines,
`@gmode/mcp` and `@gmode/rpc` have 6. Every package needs a page that sells and teaches in
90 seconds.

**Template (apply to all 11 publishable packages):**
```markdown
# @gmode/<name>
<one-line value proposition>
## Install        — npm i @gmode/<name>  (plus peer notes)
## Quick example  — 10–25 lines, copy-paste-runnable, typed
## API            — table of main exports, one line each
## Works with     — links to sibling packages + repo + docs
## License        — MIT
```
Package-specific musts:
- **core:** errors + `serializeError`, signed gateway context (encode/verify), OpenAPI
  merge, webhooks, binding guards — each with a 3-line snippet.
- **gateway:** full minimal gateway (createGateway + 2 middleware + 1 service + export)
  and the middleware catalog table (13 middleware, one line each).
- **service:** the route-definition example (Zod params/responses/handler), context trust
  (`trustGateway`), error helpers.
- **rpc:** define entrypoint, typed client call, the wire contract, testing with
  `createMockRpcBinding` (state the GM-04 status honestly until fixed).
- **mcp:** `mountMcp` one-liner, catalog vs tools mode, OAuth hook.
- **web:** `withGmode` for TanStack Start, `createWebApp` for SPAs, why `basePath`.
- **client:** generated-client usage + `createClient` manual mode.
- **cli:** command reference table (init/new/dev/deploy/sync/doctor/generate/shield:*).
- **testing:** mock catalog table + one gateway test example.
- **create-gmode / dashboard:** short but real (what it scaffolds / what it shows, with a
  dashboard screenshot).

**Acceptance:** each README has ≥ the sections above; every code sample typechecks
(scratch file + `tsc --noEmit` against workspace deps, then delete); `pnpm pack` tarballs
include them (already in `files`).

### GM-10 · npm metadata

**Why:** All 12 package.jsons ship with **zero keywords, no homepage, no bugs URL, no
engines, no sideEffects, no author**. This hurts npm search, tree-shaking, and
version-mismatch DX.

**Changes (every publishable package.json):**
- `"engines": { "node": ">=20" }` — verify wrangler 4's actual floor and match it.
- `"keywords"`: shared base `["cloudflare", "workers", "cloudflare-workers", "api",
  "gateway", "typescript"]` + per-package additions (`"openapi"`, `"zod"`, `"mcp"`,
  `"model-context-protocol"`, `"rpc"`, `"service-bindings"`, `"tanstack"`, `"vite"`, …).
- `"homepage": "https://github.com/charl-kruger/gmode#readme"` (switch to docs site after
  GM-12); `"bugs": "https://github.com/charl-kruger/gmode/issues"`.
- `"sideEffects": false` for pure-library packages (core, gateway, service, rpc, mcp, web,
  client, testing). **Verify first** that no `src/index.ts` import graph performs
  top-level mutation that consumers rely on.
- `"author": "Charl Kruger"`.
- Changeset (`patch`).

**Acceptance:** fields present in all 12; gate green; after next release
`npm view @gmode/core` shows keywords/homepage/license.

### GM-11 · CLI output & error-message polish

**Why:** Flagship CLIs teach through their output. Ours prints plain lines, failures can
surface raw stacks, command help is thin. The benchmark's `native check` gives
`file:line:column` errors "that teach".

**Changes (`packages/cli/src`):**
1. Add an output helper (`src/ui.ts`): `success/warn/error/step` with color (respect
   `NO_COLOR` and non-TTY), consistent `✓ / ▲ / ✗` glyphs, and `errorWithFix(msg, fix)` —
   every CLI error must carry a `→ try: …` line. No new deps; raw ANSI codes (the dev
   collector already does this).
2. Sweep every `fail(`/stderr call site in `src/commands/*` and `manifest.ts` to route
   through the helper with an actionable fix. Examples:
   - missing manifest → `→ run \`gmode init\` or cd into your workspace`
   - port in use in `dev` → name the port, `→ pass --port <n>`
   - missing `.dev.vars` secret in `doctor` → print the exact line to add.
3. `gmode dev` ready banner: keep the URL block, print it after worker noise settles, add
   `press ctrl+c to stop`.
4. `gmode --help` + per-command `--help`: one-line description, usage, options table, one
   example each. Wire through `run.ts` dispatch.
5. Tests: extend `packages/cli/src/cli.test.ts` for help output and `errorWithFix`
   formatting (strip ANSI in assertions).

**Acceptance:** every CLI error includes a fix suggestion; `gmode <cmd> --help` exists for
all 12 commands; gate green.

---

## P2 — Documentation & trust

### GM-12 · Docs site — Astro Starlight on Cloudflare

**Why:** 21 solid markdown docs, no site. The bar is native-sdk.dev: searchable, navigable
docs. **Starlight deployed to Cloudflare** fits — we're a Cloudflare-native project;
dogfood the platform.

**Steps:**
1. Scaffold `apps/docs` (**out** of the publish fixed group; `"private": true`) with
   `npm create astro@latest -- --template starlight`. Pin versions.
2. Port `docs/*.md` into `src/content/docs/` with this sidebar taxonomy:
   *Start here* (Quickstart · Why GMode · Architecture) / *Guides* (Gateway · Services ·
   Web apps · RPC · MCP · Auth & security · Feature flags · Caching · Idempotency ·
   Webhooks · Telemetry · API versioning) / *CLI* (per-command pages, aligned with GM-11
   help text) / *Deploy* (Cloudflare config · API Shield · Release) / *Reference* (GM-13
   output · error-codes table · `gmode.jsonc` schema rendered from
   `packages/cli/gmode.schema.json`).
   Keep original `docs/*.md` as one-line pointers to the site for one release, then delete.
3. Write the **Quickstart** page fresh against the GM-07 flow (60-second promise,
   npm-first).
4. Brand: minimal wordmark (text fine), accent color, dark default, og:image.
5. Deploy: static assets via `wrangler.jsonc`; GitHub Action `deploy-docs.yml` on pushes
   to `main` touching `apps/docs/**` (needs a `CLOUDFLARE_API_TOKEN` repo secret —
   coordinate with the repo owner). workers.dev URL until a custom domain exists.
6. Update root README + package README doc links to the site.

**Acceptance:** `npm run build` in apps/docs passes in CI; deployed URL serves all pages;
search works; every page from `docs/` is reachable in the sidebar.

### GM-13 · API reference generation

**Why:** Typed SDKs deserve generated reference docs; TSDoc exists but is only visible
in-editor.

**Steps:**
1. Add `typedoc` + `typedoc-plugin-markdown` at the root (dev-only). `typedoc.json`:
   entry points = the 8 library packages' `src/index.ts`, exclude internals,
   `readme: none`.
2. Emit markdown into `apps/docs/src/content/docs/reference/<package>/…`; root script
   `docs:api`; run it in the docs deploy workflow (generated, not committed — gitignore
   the output path).
3. Fix every TSDoc warning the run surfaces — each exported symbol in the 8 library
   packages gets at least a one-line TSDoc.
4. Sidebar: "Reference" section grouped by package.

**Acceptance:** `pnpm docs:api` runs with zero warnings; reference pages render;
spot-check `createGateway`, `createService`, `mountMcp`, `createRpcClient`.

### GM-14 · Fix doc/impl mismatches

**Why:** Three verified lies in comments/docs:
1. `packages/gateway/src/types.ts` (~225): `defaults.auth` comment says default `true`;
   implementation (`gateway.ts` buildDefaults ~72) defaults **false**. → Fix the comment
   (false is the sane default; don't change behavior).
2. `packages/service/src/types.ts` (~66): `docs.internalOpenapi` comment says default
   `/internal/openapi.json`; actual default is `/__gmode/openapi.json` (`service.ts` ~208,
   gateway `openapi-aggregate.ts` ~12). → Fix comment.
3. `packages/service/src/types.ts` (~134): claims `operationId` is generated when
   omitted; `openapi.ts` (~97) just writes whatever is set (possibly undefined). →
   **Implement generation** (`<method><PascalPath>`, e.g. `getUsersId`) in
   `buildServiceOpenApi` when missing + test. That makes the comment true and improves
   MCP (operations without a string operationId are skipped by the MCP index).

**Acceptance:** comments match behavior; new operationId test in
`packages/service/src/service.test.ts`; changeset (`patch`).

### GM-15 · Community & trust files

**Changes:**
- `CONTRIBUTING.md`: dev setup (Node 24, pnpm 11 via corepack), the six gate commands,
  changeset requirement, PR expectations, one-line-per-package layout map.
- `SECURITY.md`: private reporting via GitHub security advisories; supported-versions
  table (latest minor).
- `CODE_OF_CONDUCT.md`: Contributor Covenant v2.1.
- `.github/ISSUE_TEMPLATE/bug_report.yml` (repro, expected/actual, versions incl.
  `gmode --version`, wrangler, node) + `feature_request.yml` + `config.yml` (docs link for
  questions). `.github/PULL_REQUEST_TEMPLATE.md`: checklist (gate run, changeset added,
  docs touched).
- Root README footer links to all of the above.

**Acceptance:** files exist; GitHub renders the templates in the new-issue flow.

---

## P3 — API polish (small, independent)

### GM-16 · `ServiceOptions.basePath`
Declared in `packages/service/src/types.ts` (~40) but **never used** in route registration
or OpenAPI generation. **Recommendation: implement** (prefix all routes + OpenAPI paths —
matches the gateway's `stripPrefix:false` use case), with tests (route reachable at
`/base/x`; OpenAPI paths prefixed). Changeset `minor`.

### GM-17 · `cloudflareRateLimit` dead default-key branch
`packages/gateway/src/middleware/cloudflare-rate-limit.ts` (~35): the default key reads
`context.matchedService`, but the middleware runs **before** routing sets it — branch
unreachable. Fix: default key = `auth.user?.id ?? auth.tenant?.id ??
request.headers.get("cf-connecting-ip") ?? "anonymous"`; drop the matchedService read;
update TSDoc + tests. Changeset `patch`.

### GM-18 · MCP catalog caching
`packages/mcp/src/handler.ts` `buildCatalog()` re-aggregates every service's OpenAPI on
**every** `tools/list` / `tools/call`. Add a per-isolate TTL cache mirroring the gateway's
own `openapiCache` (default 60s; option `catalogTtlSeconds`; `0` disables). Tests: two
calls within TTL hit the aggregate once (count via mock fetcher). Changeset `patch`.

### GM-19 · Unify CLI argument parsing
Hand-rolled and inconsistent (`requireNext` vs `argv[++i]`; unknown flags silently
ignored — see `bootstrap-shield.ts`, `sync-sequences.ts`, `push-schema.ts`). Write one
`parseArgs(spec, argv)` util in `packages/cli/src/args.ts` (zero deps): declared
flags/aliases/types; **unknown flag = error with a did-you-mean suggestion** (levenshtein
≤ 2); adopt in all 12 commands. Unit-test the util + one migration test per command.
Changeset `patch`.

### GM-20 · Gateway defaults `scopes`/`permissions`
`packages/gateway/src/types.ts` (~313) defines them; `authorize.ts` (~81) never reads
them. Implement: merge defaults into per-service requirements in `authorizeForService`
(service config wins). Tests both directions. Changeset `minor`. If product-wise
undesired, delete the fields instead (breaking — coordinate first).

### GM-21 · Middleware response-header mutation
`cloudflareRateLimit`, `memoryRateLimit`, `sessionHeader` mutate `response.headers`
directly (throws on immutable responses); other paths clone. Standardize on the existing
`withMutableHeaders` helper (`gateway.ts`): move it to a shared module, use it in all
three, respect the web/101 passthrough guard (`passthrough.ts`). Tests: middleware applied
to an immutable `fetch()` response doesn't throw. Changeset `patch`.

### GM-22 · Examples: one-command run + deploy
1. Each example gets a single `npm run example` that boots everything. Today
   `gateway-basic` needs `cp .dev.vars.example .dev.vars` × 3 first — add a `predev` node
   script that copies any missing `.dev.vars.example` → `.dev.vars`.
2. Add **`examples/quickstart`** — the exact output of `create-gmode` plus one extra
   route, so the root README's code sample is real, runnable code.
3. "Deploy to Cloudflare" button (deploy.workers.cloudflare.com deep link) in each example
   README; verify with `gmode deploy --dry-run`.

**Acceptance:** fresh clone → `pnpm install && pnpm build` →
`cd examples/gateway-basic && pnpm example` works with zero manual file copies.

---

## P4 — Road to 1.0 (GM-23)

Write a docs page + GitHub milestone defining 1.0: (a) all P0–P1 tasks done, (b) RPC
dispatch fixed and covered, (c) two consecutive weeks of green CI, (d) docs site live,
(e) semver discipline documented (pre-1.0 minors may break with changeset callouts;
post-1.0 strict), (f) deprecation policy (one minor of warning). Then cut `1.0.0` via a
`major` changeset on the fixed group.

---

## Suggested execution order & batching for Codex

Independent batches (one Codex task each; one PR each):

- **Batch A (P0 legal/security):** GM-01 + GM-02 + GM-14 — small, zero-conflict, ship first.
- **Batch B (CI):** GM-03 alone (needs Actions log access via `gh`).
- **Batch C (RPC):** GM-04 alone (deep investigation; already tracked as a follow-up task).
- **Batch D (Zod):** GM-05 alone (wide but mechanical).
- **Batch E (PM-agnostic):** GM-06 → GM-07 (same agent, sequential).
- **Batch F (npm surface):** GM-09 + GM-10 (text-heavy, no logic).
- **Batch G (CLI polish):** GM-11 → GM-19 (same files).
- **Batch H (README):** GM-08 (after E lands so npm-first commands are true; screenshots
  need a human/computer-use pass).
- **Batch I (docs site):** GM-12 → GM-13 (large; needs `CLOUDFLARE_API_TOKEN` from owner).
- **Batch J (community):** GM-15 (anytime).
- **Batch K (polish minis):** GM-16, GM-17, GM-18, GM-20, GM-21, GM-22 (independent).

**Every batch:** run the full gate, add changesets for package-affecting changes, keep
commits conventional (`fix:` / `feat:` / `docs:` / `test:`), and never touch
`.github/workflows/release.yml` publish semantics.

---

## Definition of done (program level)

1. `npm create gmode@latest my-app && cd my-app && npm install && npm run dev` works on a
   machine with only Node 20+ and npm — under 60 seconds, zero prompts, zero logins.
2. Every npm package page: MIT license, real README, keywords, homepage —
   indistinguishable in polish from a Vercel OSS package.
3. Docs site live with quickstart, guides, CLI and API reference.
4. CI green on main including hermetic e2e smoke; RPC dispatch fixed and tested.
5. No known correctness lies: docs match implementation, `expose` honored, one Zod major.
6. Community files in place; issues get templates; releases carry provenance.
