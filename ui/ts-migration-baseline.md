# TypeScript strict-mode baseline (WO-012)

**Date:** 2026-09-27
**Commit verified against:** `1c94dc1fec636936378fdee0593938c2f207a02d` (main, pre-WO-012)
**Toolchain:** `typescript@5.6.3`, Node `24.19.0`, `pnpm@10.22.0`, run from `ui/`

## What was verified

### 1. `strict: true` in `ui/tsconfig.json`

Confirmed by direct inspection of `ui/tsconfig.json` (`compilerOptions.strict: true`, line 8).

### 2. Strict sub-flags resolve to `true` (not overridden anywhere in the extends chain)

`npx tsc --showConfig` from `ui/` (extends `@tsconfig/ember/tsconfig.json`) resolves:

```
"noImplicitAny": true,
"noImplicitThis": true,
"strictNullChecks": true,
"strictFunctionTypes": true,
"strictBindCallApply": true,
"strictPropertyInitialization": true,
"alwaysStrict": true
```

None of these keys are explicitly set (to any value) in `ui/tsconfig.json` or in
`@tsconfig/ember/tsconfig.json` — they are only present in the *resolved* `--showConfig`
output as the implied expansion of `strict: true`. No override, in either the extends
chain or `ui/tsconfig.json` itself, sets any of them to `false`. Confirmed true:
`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` (the three named in the AC),
plus `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`,
`alwaysStrict` (the remainder named in implementation_steps).

No changes were required — nothing in `ui/tsconfig.json` needed an explicit override.

### 3. `allowJs: true`

Confirmed directly in `ui/tsconfig.json` (`compilerOptions.allowJs: true`, line 7) and in
the `--showConfig` resolution above.

### 4. `include` array covers migration-target directories

Current `ui/tsconfig.json` `include`:

```
app/**/*, tests/**/*, types/**/*, lib/core/**/*, lib/css/**/*, lib/kmip/**/*,
lib/ldap/**/*, lib/kubernetes/**/*, lib/open-api-explorer/**/*, lib/pki/**/*,
lib/replication/**/*, lib/service-worker-authenticated-download/**/*, lib/sync/**/*,
mirage/**/*
```

Every directory named in this story's acceptance criteria (`app`, `tests`, `types`,
`lib/core`, `lib/css`, `lib/kmip`, `lib/ldap`, `lib/kubernetes`, `lib/pki`,
`lib/replication`, `lib/sync`) is already present. No changes were required.

**`lib/kv` — investigated, deliberately NOT added (see "lib/kv" section below).**

## Baseline `tsc --noEmit` error count

Ran `npx tsc --noEmit` from `ui/` against the unmodified `tsconfig.json`:

```
Exit code: 0
Errors: 0
```

**The existing codebase compiles clean under the current strict configuration.** There is
no pre-existing violation inventory to categorize by error code — unlike WO-001's ESLint
`strict-type-checked` upgrade (which surfaced hundreds of pre-existing violations because
it turned on new rules against code never checked against them), every file currently in
`include` was already being type-checked under this same `strict: true` configuration, so
there is nothing new being enabled here.

## `lib/kv`: investigated and intentionally excluded

`ui/eslint-v8-triage.md` (WO-001) flags `lib/kv/**/*.ts` as excluded from the
`strict-type-checked` ESLint override specifically because those files are outside
`ui/tsconfig.json`'s `include`, and says adding them "would mean editing `tsconfig.json`,
not just ESLint config" — i.e., out of scope for WO-001, and squarely this story's
concern to evaluate.

Investigated by temporarily adding `lib/kv/**/*` to `include` and re-running
`tsc --noEmit`. Result: **5 pre-existing type errors** surface immediately, across both
of `lib/kv`'s two `.ts` files:

| File | Line | Code | Error |
| :--- | ---: | :--- | :--- |
| `lib/kv/addon/components/kv-version-dropdown.ts` | 24 | TS7006 | Parameter 'versionData' implicitly has an 'any' type. |
| `lib/kv/addon/components/kv-version-dropdown.ts` | 27 | TS2339 | Property 'metadata' does not exist on type 'Readonly<EmptyObject>'. |
| `lib/kv/addon/components/page/configure.ts` | 12 | TS2307 | Cannot find module 'vault/app/forms/secrets/kv' or its corresponding type declarations. |
| `lib/kv/addon/components/page/configure.ts` | 17 | TS2307 | Cannot find module 'vault/app/resources/secrets/engine' or its corresponding type declarations. |
| `lib/kv/addon/components/page/configure.ts` | 50 | TS18047 | 'event' is possibly 'null'. |

**Decision: do not add `lib/kv/**/*` to `include` in this story.** Reasoning:

- `ui/`'s CI lint job (`.github/workflows/test-ui.yml`, `run: pnpm lint`) runs
  `lint:types` (`tsc --noEmit`) as one of three `concurrently --kill-others-on-fail`
  tasks. Adding `lib/kv` would turn today's clean `tsc --noEmit` exit code 0 into exit
  code 2, breaking CI immediately on merge — a real regression, not a pre-existing one
  masked by a lint severity knob.
- Unlike WO-001's ESLint violations, there is no "downgrade to warn" equivalent for
  `tsc` — a type error is binary pass/fail for the whole program. The five errors above
  can only be resolved by editing `lib/kv/addon/components/kv-version-dropdown.ts` and
  `lib/kv/addon/components/page/configure.ts` (adding parameter types, fixing the
  `Readonly<EmptyObject>` access, adding/fixing the two missing module declarations, and
  a null check on `event`).
- This story's scope is explicitly build-configuration verification, not application
  source changes ("This story does not convert any JavaScript files to TypeScript and
  does not modify application source code").
- This story's own acceptance criteria enumerate the exact directories the `include`
  array must cover, and `lib/kv` is not among them.

**Follow-up:** `lib/kv` is one of the engine-library directories tracked by this epic's
downstream conversion stories (WO-048 through WO-051 — engine libraries — per
`ui/eslint-v8-triage.md`'s follow-up plan). Whichever story converts `lib/kv` should, as
part of that story: add `lib/kv/**/*` to `ui/tsconfig.json`'s `include`, fix the five
errors above, and remove the now-redundant `lib/kv/**/*.ts` exclusion from the
`strict-type-checked` override in `ui/.eslintrc.js` (both currently exclude `lib/kv` for
the same underlying reason — it isn't part of the `tsconfig.json` program yet).

## Verification commands (for reproduction)

```sh
cd ui
npx tsc --showConfig            # confirms strict sub-flags, allowJs
npx tsc --noEmit                # 0 errors against current tsconfig.json
```

## Update — WO-034: `ui/lib/core/` shared files converted

**Date:** 2026-09-28

WO-034 converted every `.js` file under `ui/lib/core/addon/` to `.ts`, following
`ui/lib/core/migration-triage.json`'s (WO-023) three-wave plan (wave 1: 2
files with dependencyCount >= 5, wave 2: 99 files with dependencyCount 1-4,
wave 3: 1 leaf file with dependencyCount 0 — 102 files total).

```sh
find ui/lib/core/addon/ -name '*.js' -not -name index.js | wc -l   # 0 (was 102 before WO-034)
npx tsc --noEmit                                                    # 0 errors, run from ui/
```

`ui/lib/core/app/` (157 files) is intentionally untouched — those are Ember
addon app-tree re-export shims (`export { default } from 'core/xyz';`)
required by Ember CLI's classic resolver, not migration targets; this
matches the acceptance criteria's own carve-out for "intentional
JavaScript-only files like index.js entry points." `ui/lib/core/index.js`
(the addon's package entry point) is likewise untouched for the same
reason.

Every file was `git mv`'d in a content-free rename commit before any typing
changes, so `git log --follow` preserves full pre-.ts history for all 102
files. A handful of latent runtime bugs were surfaced (and fixed) by making
previously-untyped code honestly typed — see the WO-034 commits for
specifics (a non-existent `.any()` Array method called in four different
files where `.some()` was clearly intended; one call site passing a wrapped
`{ headers }` object where raw `HeadersInit` was expected;
`dasherize(val)` receiving a bare string where its real `[string]`-tuple
signature expected an array).

## Update — WO-051: `ui/lib/kmip/` and `ui/lib/sync/` engine files converted

**Date:** 2026-09-28

`git mv`'d `addon/engine.js` -> `addon/engine.ts` and `addon/routes.js` ->
`addon/routes.ts` for both `kmip` and `sync` (4 files, both libraries had no
`resolver.js` to convert). `ember-engines`, unlike `ember-resolver` and
`ember-load-initializers`, ships no `.d.ts` at all, so `ember-engines/engine`
and `ember-engines/routes` needed ambient shims in `ui/types/global.d.ts`
(added, following the file's existing pattern for untyped packages):
`ember-engines/engine` aliases straight to the real `@ember/engine` Engine
class it re-exports at runtime; `ember-engines/routes` types its
`buildRoutes()` callback against Ember's own `DSL`/`DSLCallback` from
`@ember/routing/lib/dsl` rather than a hand-rolled stub. Each engine's
`import config from './config/environment'` also needed a same-directory
`addon/config/environment.d.ts` ambient declaration (mirroring
`app/config/environment.d.ts`'s existing pattern) because `ui/tsconfig.json`'s
`"kmip/*"`/`"sync/*"` path mappings point at `addon/*`, not the sibling
`lib/{kmip,sync}/config/` directory where the real (untouched,
`.js`-and-staying-that-way) build-time config factory lives.

```sh
find ui/lib/kmip -name '*.js' -not -name index.js | wc -l   # 0 (was 2 before WO-051)
find ui/lib/sync -name '*.js' -not -name index.js | wc -l   # 0 (was 2 before WO-051)
npx tsc --noEmit                                             # 0 errors, run from ui/
```

`ui/lib/kmip/index.js` and `ui/lib/sync/index.js` (each library's
`ember-engines` addon package entry point, calling `buildEngine({...})` via
bare CommonJS `require()`) are intentionally left as `.js`, for the same
reason WO-034 left `ui/lib/core/index.js` untouched: Ember CLI's addon
discovery loads an addon by `require()`-ing its package directory *before*
any TypeScript/Babel transform pipeline exists, and Node's directory-index
module resolution only ever looks for `index.js`/`index.json`/`index.node`
— never `index.ts`. Verified empirically for this story: renaming
`lib/kmip/index.js` to `index.ts` and running
`node -e "require('./lib/kmip')"` from `ui/` fails with `Cannot find module
'./lib/kmip'`, confirming the rename would break Ember's build, not just
change its output. `ui/lib/kmip/addon/config/environment.d.ts` and
`ui/lib/sync/addon/config/environment.d.ts` (new files, no `.js` counterpart)
are excluded from both counts above for the same "type-only, zero runtime
footprint" reason `app/config/environment.d.ts` already is.

## Update — WO-048: `ui/lib/kv/` converted to TypeScript

**Date:** 2026-09-28

WO-048 converted every `.js` file under `ui/lib/kv/addon/` to `.ts` (19 routes
plus `engine.js`/`addon/routes.js`, 3 controllers, 4 helpers, 2 utils, and 18
components — 48 files total), added `lib/kv/**/*` to `ui/tsconfig.json`'s
`include`, fixed the 5 pre-existing errors this baseline flagged above for
`kv-version-dropdown.ts` and `page/configure.ts`, and removed the
now-redundant `lib/kv/**/*.ts` exclusion from the `strict-type-checked`
override in `ui/.eslintrc.js` per this doc's own follow-up note.

```sh
find ui/lib/kv -name '*.js' | grep -v node_modules   # index.js, config/environment.js only — Node-side entry/build files, untouched like every sibling engine's own index.js
npx tsc --noEmit                                      # 0 errors, run from ui/
```

Every file was `git mv`'d before any typing changes, so `git log --follow`
preserves full pre-.ts history. A shared `ui/lib/kv/addon/utils/kv-types.ts`
module defines the domain types (`KvSecretMetadata`, `KvSubkeysResponse`,
`KvCapabilities`, etc.) that the generated `@hashicorp/vault-client-typescript`
response models don't cover — their KV payload fields are typed as plain
`object` because the OpenAPI spec doesn't model KV's dynamic maps
(`versions`, `data`, `subkeys`, `metadata`). A couple of latent issues were
surfaced by strict typing and fixed: `routes/configure.ts`'s "Configuration"
breadcrumb passed the whole `backend` resource object as `model` instead of
`backend.id` (every sibling breadcrumb entry in this file and
`routes/configuration.ts` uses `.id`); `page/secret/metadata/details.ts`'s
error handler unconditionally set `.isControlGroup` on the previous
(sometimes still-`null`) value of `this.error` before overwriting it on the
non-control-group failure path.
