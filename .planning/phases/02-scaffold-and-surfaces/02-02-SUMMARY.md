---
phase: 02-scaffold-and-surfaces
plan: 02
subsystem: scaffold-primitives-trust-model
tags: [scaffold, primitives, trust-model, eslint, css-scope, polling, postinstall-audit, ci]
requires:
  - Plan 02-01 (smoke spike — installable shell; D-01 detailTab confirmed canonical per kitchen-sink; D-02 namespace pattern locked)
  - Plan 01-05 (safety CLI now supports embedded-postgres + Windows dev work — unblocks future Linux re-spike against the same code)
  - Node >= 20 (native .ts strip-types; .tsx requires bundle step, not unit-test load)
  - pnpm 9.x (default-deny postinstall behavior — defense-in-depth alongside our audit script)
provides:
  - "Full 5-slot manifest (Reader detailTab + Situation Room/Bulletin/Chat pages + Settings settingsPage) — all four surfaces declared per SCAF-01 so 02-03 + 02-04 fill in real components without manifest churn."
  - "6 shared primitives (PRIM-01..06): src/shared/{types,reference-resolver,blocker-chain,opt-in}.ts + src/ui/primitives/{state-pill,ref-chip,use-poll,use-host-navigation,clarity-surface-root,theme.css}."
  - "2 worker handlers registered in src/worker.ts: resolve-refs (PRIM-01 single round-trip), flatten-blocker-chain (PRIM-03/04/05 deterministic terminal selection)."
  - "Trust-model hardening: 2 custom ESLint rules (no-raw-fetch-in-ui, no-raw-anchor-to-host-paths) + scripts/check-css-scope.mjs (every theme.css selector under [data-clarity-surface]) + scripts/audit-postinstall.mjs (216 packages clean; esbuild allowlisted with documented rationale) + .npmrc ignore-scripts=true."
  - ".github/workflows/scaffold-check.yml — CI on every PR + push to main running the full local sequence: pnpm install --frozen-lockfile → audit-postinstall → CSS scope → ESLint src/ → tsc → node:test → pnpm build."
  - "src/ui/primitives/use-poll.ts is lifecycle-aware: PLUGIN_DISABLED is TERMINAL (stopped=true; clearTimeout; no further schedules); WORKER_UNAVAILABLE / TIMEOUT / UNKNOWN are TRANSIENT (exponential backoff capped at 5min). Content-hash dedupe uses inlined synchronous murmur3-32 — no Web Crypto digest API (async hashing races with the next tick per PITFALLS.md #7)."
  - "5 surface stubs that wrap in <ClaritySurfaceRoot name=...> and render placeholder text linking to the plan that fills them in (02-03 Reader, 02-04 Situation Room/Settings, Phase 3 Bulletin, Phase 4 Chat)."
affects:
  - "src/manifest.ts — promoted from 2-slot smoke shape to full 5-slot Phase-2 declaration (11 capabilities; 6 coreReadTables; entrypoints.worker+ui; database.migrationsDir='migrations')."
  - "src/worker.ts — registers registerResolveRefs + registerFlattenBlockerChain at setup; pure data-providers."
  - "src/ui/index.tsx — barrel-exports ReaderView + SituationRoom + BulletinPage + ChatPage + SettingsPage (matches manifest exportName fields)."
  - "src/ui/reader-view-stub.tsx — DELETED; replaced by src/ui/surfaces/reader-view-stub.tsx (consistent location with other surface stubs)."
  - "tsconfig.json — added allowImportingTsExtensions + verbatimModuleSyntax so .ts source can import .ts source explicitly (matches Node 24 native-strip-types runtime model used by tests)."
  - "tsconfig.manifest.json — override allowImportingTsExtensions=false (tsc requires noEmit when the flag is on; manifest build emits dist/manifest.js)."
  - "package.json devDeps: + eslint ^10.3.0, + @typescript-eslint/parser ^8.59.3."
  - "pnpm-lock.yaml committed (SCAF-04 frozen-lockfile posture)."
tech-stack:
  added:
    - "eslint ^10.3.0 (devDep) — drives the custom rules in CI + locally."
    - "@typescript-eslint/parser ^8.59.3 (devDep) — parses .tsx for the rules; flat-config plugin namespace."
  patterns:
    - "Pure helpers extracted from .tsx components into separate .ts files for unit-testability (state-pill-format.ts owns formatAge/humaniseState/STATE_TO_CLASS). Node 24 native strip-types loads .ts but not .tsx; extracting the pure-function surface to .ts avoids the alternative of an esbuild compile-before-test step."
    - "Injectable timer + visibility-API + onStateChange callback for createPollLoop. Production code defaults to real setTimeout/document.visibilityState; tests pass mocks so the state machine drives deterministically without React."
    - "Lifecycle-aware error discrimination via PollErrorKind union: TERMINAL (PLUGIN_DISABLED) vs TRANSIENT (everything else). Captures PITFALLS.md #1 in a type-safe shape downstream consumers can pattern-match on for surface-level UX (e.g. Situation Room shows 'Plugin disabled — re-enable in admin' on PLUGIN_DISABLED but a transient banner on WORKER_UNAVAILABLE)."
    - "Append-only ALLOWLIST in audit-postinstall.mjs with code-comment rationale per entry citing empirical evidence (current single entry: esbuild, citing 02-01 SMOKE-FINDINGS §D-08(f))."
    - "Custom ESLint rule filename scoping via context.filename normalization (.replace(/\\\\/g, '/').includes('/src/ui/'))."
key-files:
  created:
    - .planning/phases/02-scaffold-and-surfaces/02-02-SUMMARY.md
    - src/shared/types.ts
    - src/shared/reference-resolver.ts
    - src/shared/blocker-chain.ts
    - src/shared/opt-in.ts
    - src/worker/handlers/resolve-refs.ts
    - src/worker/handlers/flatten-blocker-chain.ts
    - src/ui/primitives/theme.css
    - src/ui/primitives/clarity-surface-root.tsx
    - src/ui/primitives/state-pill.tsx
    - src/ui/primitives/state-pill-format.ts
    - src/ui/primitives/ref-chip.tsx
    - src/ui/primitives/use-poll.ts
    - src/ui/primitives/use-host-navigation.ts
    - src/ui/surfaces/reader-view-stub.tsx
    - src/ui/surfaces/situation-room-stub.tsx
    - src/ui/surfaces/bulletin-stub.tsx
    - src/ui/surfaces/chat-stub.tsx
    - src/ui/surfaces/settings-stub.tsx
    - eslint-rules/no-raw-fetch-in-ui.js
    - eslint-rules/no-raw-anchor-to-host-paths.js
    - eslint.config.js
    - scripts/check-css-scope.mjs
    - scripts/audit-postinstall.mjs
    - .npmrc
    - .github/workflows/scaffold-check.yml
    - test/shared/reference-resolver.test.mjs
    - test/shared/blocker-chain.test.mjs
    - test/shared/opt-in.test.mjs
    - test/worker/resolve-refs.test.mjs
    - test/ui/use-poll.test.mjs
    - test/ui/state-pill.test.mjs
    - test/ui/css-scope.test.mjs
    - test/ui/eslint-no-raw-fetch.test.mjs
    - test/fixtures/ui-raw-fetch/src/ui/bad-fetch.tsx
    - test/fixtures/ui-raw-anchor/src/ui/bad-anchor.tsx
    - test/fixtures/ui-clean/src/ui/clean.tsx
  modified:
    - src/manifest.ts (promoted 2-slot smoke → 5-slot Phase-2 shape)
    - src/worker.ts (registers 2 data handlers)
    - src/ui/index.tsx (barrel-exports 5 components)
    - tsconfig.json (allowImportingTsExtensions + verbatimModuleSyntax)
    - tsconfig.manifest.json (override allowImportingTsExtensions=false)
    - package.json + pnpm-lock.yaml (+ eslint, + @typescript-eslint/parser)
  deleted:
    - src/ui/reader-view-stub.tsx (replaced by src/ui/surfaces/reader-view-stub.tsx)
decisions:
  - "Pure helpers extracted from state-pill.tsx into state-pill-format.ts. Reason: Node 24's native --experimental-strip-types loads .ts but NOT .tsx; loading state-pill.tsx into node:test requires either an esbuild compile-before-test step OR loading the bundled UI output. Extracting the pure-function surface to .ts means we get unit tests on the logic that would break in non-obvious ways (off-by-one age buckets, missing STATE_TO_CLASS entries) without the JSX-loading complexity. The thin JSX surface gets visual review during Plan 02-03 integration."
  - "use-poll.ts inlines a synchronous murmur3-32 instead of using Web Crypto's async digest API. Reason: the Web Crypto digest API is Promise-based; running it inside a poll tick returns control to the event loop before the dedupe predicate runs, which means two consecutive ticks can compute hashes out of order and the dedupe becomes unreliable (PITFALLS.md #7). murmur3 is ≤50 LOC, dependency-free, suitable for content-equality only (not cryptographic strength), and synchronous by construction. Verified by a source-grep test asserting the file does NOT contain 'crypto.subtle' / the Web Crypto async digest API token."
  - "ESLint rule scope-matcher uses normalised path `.replace(/\\\\/g, '/').includes('/src/ui/')` rather than relative-path heuristics. Reason: fixtures under test/fixtures/ui-raw-*/src/ui/ must also fire the rule so the eslint-no-raw-fetch.test.mjs wrapper can verify the rule fires. The normalised-path includes() match handles both src/ui/ in the real tree AND fixture trees with the same path segment."
  - "Custom ESLint rule for `<a href>` only flags JSX, not React.createElement('a', { href: ... }). Reason: the createElement form is rare in modern React; if it appears, the rule's lack of coverage is a minor false-negative we accept rather than build a deeper AST analyser. Plan 02-03 + 02-04 surfaces use JSX exclusively."
  - "Removed 'users' from manifest.coreReadTables. Reason: SDK 2026.512.0's PluginDatabaseCoreReadTable union does NOT include 'users' (tsc rejected it). Same stale-research-doc drift as the Task 1 manifest corrections in commit bef083e — the plan example listed 'users' from an older SDK shape. If we need user-row reads later (e.g. Reader's 'blocked by Eric' display), we use a worker handler hitting the host user API rather than direct DB SELECT — cleaner privilege boundary anyway."
  - "esbuild allowlisted in audit-postinstall.mjs with documented rationale. Reason: esbuild's package.json declares `postinstall: 'node install.js'` for legacy fallback, but pnpm 9.x default-deny blocks execution AND the platform binary is delivered via @esbuild/<platform> optional-dep (a pure package extraction with no script invocation). Empirical evidence per Plan 02-01 SMOKE-FINDINGS §D-08(f): tree diff --ignore-scripts vs default install is empty. Future allowlist additions follow the same pattern: name + cite empirical evidence."
  - "ESLint scope in CI workflow: src/ only, NOT test/fixtures/. Reason: fixtures under test/fixtures/ui-raw-fetch/ + test/fixtures/ui-raw-anchor/ are DELIBERATELY bad (they exercise the rules); CI would fail on them otherwise. The fixtures are linted by the eslint-no-raw-fetch.test.mjs wrapper which expects exit non-zero."
  - "PRIM-03 grep guard in test/shared/blocker-chain.test.mjs scans the source file for AI-vendor tokens (openai/anthropic/claude_local/llm/gpt/completion). This caught two self-traps during this plan: comments in blocker-chain.ts mentioning 'LLM' for context, and use-poll.ts comments mentioning 'crypto.subtle'. Reworded both to use non-trigger phrasings. The grep is intentionally simple — any future edits that add an AI dependency will fail this test immediately."
metrics:
  duration: ~2.5 hours (Task 1 ~30min + Task 2a ~30min + Task 2b ~45min + Task 3 ~25min + verification/fixes ~20min)
  total_loc: ~1850 (src/shared/* ~280 + src/worker/handlers/* ~110 + src/ui/primitives/* ~600 + src/ui/surfaces/* ~150 + src/manifest.ts +60 + tests ~450 + scripts ~200 + eslint-rules ~120 + workflows ~50)
  test_count_added: 34 (shared 16 + worker 3 + ui 15)
  test_count_total: 156 (Plans 01-04 = 109 + Plan 01-05 = 13 + Plan 02-02 = 34)
  test_pass_rate: 156/156 (1 pre-existing skip from Plan 01-04 R7-on-Windows-no-symlink)
  commits: 4 (Plan 02-02 commits only — plus this SUMMARY commit)
    - 2082bff — feat(02-02): Task 1 — shared primitives + worker handlers + 19 tests pass
    - 7903414 — feat(02-02): Task 2a — ESLint custom rules + fixtures + 3 tests pass
    - 215886a — feat(02-02): Task 2b — theme.css + CSS scope check + 6 UI primitives + 13 new tests pass
    - 87374fb — feat(02-02): Task 3 — manifest promoted to 5 surfaces + postinstall audit + scaffold-check CI
    - (this commit) — docs(02-02): SUMMARY.md
deferred:
  - "Real Reader view content (Plan 02-03): TL;DR + inline ref chips + ancestry breadcrumb + AC checklist + deliverable preview per sketches/paperclip-fix-task-detail.html. The stub at src/ui/surfaces/reader-view-stub.tsx is a placeholder; Plan 02-03 replaces its body."
  - "Editor-Agent (Plan 02-03): manifest agents[] declaration + reconcileEditorAgent + compileTldr with idempotency + self-loop filter + token cap + circuit breaker."
  - "Real Situation Room content (Plan 02-04): 60s materialized snapshot job + agent grid + critical-path strip + artifacts shelf per sketches/paperclip-fix-situation-room.html. Stub is placeholder."
  - "Opt-in gate (Plan 02-04 Task 1): clarity_user_prefs handlers + opt-in-guard wrap for ALL existing handlers + settings page UI + Enable-Clarity CTA + useOptIn hook. The Settings stub is currently a placeholder; Plan 02-04 fills it."
  - "Linux re-spike (Plan 02-01 Check B closure): visual confirmation that `detailTab + entityTypes: ['issue']` renders alongside Paperclip's classic tabs at install time. Architectural confidence is HIGH (kitchen-sink uses the exact same pattern), but the empirical bar requires a Linux Paperclip host (the Plan 02-01 spike was Windows-blocked by an upstream ESM-path bug — Finding #5). WSL or a throwaway VPS will close it in ~30-60 minutes when scheduled."
  - "BroadcastChannel single-leader election wrapping use-poll (Plan 02-04): the current usePoll returns isLeader=null. Plan 02-04 adds useLeaderElection + usePollWithLeader so that with 5 tabs open, only one tab is the leader for the 60s situation-snapshot fetch + others consume via BroadcastChannel postMessage."
phase_closure:
  status: COMPLETE
  blocker: none
  on_pass:
    - "Phase 2 Wave 2 done. Wave 3 unblocked (Plan 02-03: Editor-Agent + Reader view). The scaffold + 6 primitives + trust-model hardening that every downstream surface assumes are now real."
    - "BEAAA install path is partially de-risked: install command form confirmed (Plan 02-01 Check A), migration namespace pattern confirmed (Plan 02-01 Check C), postinstall audit baseline confirmed (Plan 02-01 Check E + this plan's automated audit), useInstanceConfig FALLBACK locked (Plan 02-01 Check F), and the trust-model hardening makes downstream feature code unable to violate the same-origin trust posture by accident. Remaining empirical gates: Plan 02-01 Check B visual D-01 (Linux re-spike) + integration testing through 02-03 + 02-04 on Countermoves."
  on_fail:
    - "n/a — plan closed PASS"
---

# Plan 02-02 Summary: Scaffold + 6 Shared Primitives + Trust-Model Hardening

## What was done (and why)

Plan 02-01's smoke spike proved the plugin INSTALLS. Plan 02-02's job was to
make sure that what installs is something we'd actually want to build features
on — a real scaffold with shared primitives that downstream plans (02-03
Reader + Editor-Agent; 02-04 Situation Room + opt-in gate) can consume
directly + trust-model hardening that makes feature code STRUCTURALLY unable
to violate the same-origin posture.

The plan landed across 4 atomic commits, one per task chunk, all matching the
Phase 1 atomic-commit + TDD pattern.

### Task 1 — Shared primitives + worker handlers (19 tests pass)

Pure code that both worker and UI tiers import. Six artifacts that every
downstream surface needs:

- **types.ts** — RefCardData, Terminal, BlockerChainResult, TLDR, OptInPrefs
  canonical shapes. The <interfaces> block of 02-02-PLAN.md verbatim.
- **reference-resolver.ts** — `resolveRefs(ids, fetcher)` enforces PRIM-01
  (single round-trip; dedupes input before fetch) and PRIM-02 (null excerpt
  forwarded when viewer lacks permission). Output preserves input order even
  when fetcher returns out of order. Missing ids get an 'unknown' placeholder
  rather than throwing.
- **blocker-chain.ts** — deterministic DFS over blocker edges, returning one
  of 4 terminals: HUMAN_ACTION_ON / SELF_RESOLVING / EXTERNAL / CYCLE. Cycle
  output rotated to canonical form (smallest id first) for determinism.
  Adjacency edges sorted by `to` field at build-up so iteration order doesn't
  depend on input array order. PRIM-03 grep guard enforces zero AI-vendor
  references in the source.
- **opt-in.ts** — `getOptIn(userId, prefs)` returns OFF defaults when no row
  exists (OPTIN-01 absence-of-row semantics). `isOptedIn` is the predicate.
- **resolve-refs.ts** + **flatten-blocker-chain.ts** worker handlers — close
  over `ctx.http.fetch + ctx.host.currentCompanyId` and defer to the pure
  shared modules. Endpoint paths reflect the Paperclip API-drift fix from
  Plan 01-04 anomaly (/api/issues moved to /api/companies/{id}/issues).

### Task 2 — UI primitives + trust-model hardening (15 tests pass)

The 6 UI primitives + the 2 custom ESLint rules + the CSS scope script. The
load-bearing pieces:

- **theme.css** — 11 top-level selectors, ALL scoped under
  [data-clarity-surface]. Warm-dark oklch palette matching the mockups; 5
  state-pill background variants; ref-chip styles. NO global resets.
- **scripts/check-css-scope.mjs** — regex-based scope enforcement (no
  PostCSS dep). Positive test: theme.css passes. Negative test: synthetic
  CSS with `body { ... }` fails, proving the script catches violations.
- **clarity-surface-root.tsx** — `<ClaritySurfaceRoot name="...">` sets the
  data-clarity-surface attribute. Every Phase-2 surface wraps in this.
- **state-pill.tsx** + **state-pill-format.ts** — 5-state pill from the
  sketches. Pure helpers extracted to .ts for unit-testability (Node 24
  doesn't load .tsx natively).
- **ref-chip.tsx** — wraps usePluginData('resolve-refs', { ids: [refId] });
  renders id + status badge inline.
- **use-poll.ts** — lifecycle-aware polling (SCAF-07 + PITFALLS.md #1).
  PLUGIN_DISABLED is TERMINAL (stopped=true; clearTimeout; no further
  schedules). WORKER_UNAVAILABLE / TIMEOUT / UNKNOWN are TRANSIENT
  (exponential backoff). Content-hash dedupe via inlined synchronous
  murmur3-32 (NO Web Crypto async digest — would race with the next tick).
  Pure createPollLoop state machine exported separately for unit testing.
- **use-host-navigation.ts** — thin re-export of useHostNavigation from
  the SDK. Surfaces use linkProps() instead of raw <a href>.
- **2 custom ESLint rules** — `no-raw-fetch-in-ui` (bans fetch /
  XMLHttpRequest / axios / got / node-fetch in src/ui/**) and
  `no-raw-anchor-to-host-paths` (bans JSX <a href> targeting host paths).
  Plus 3 fixtures (bad-fetch + bad-anchor + clean baseline) and a
  spawnSync-driven test that asserts the bad fixtures exit non-zero and the
  clean one exits 0.

### Task 3 — Manifest promotion + postinstall audit + CI (no new tests; integration only)

Wires Tasks 1 + 2 into the full Phase-2 shape:

- **src/manifest.ts** — 5 slots (Reader detailTab + Situation Room/Bulletin/
  Chat pages + Settings settingsPage) + 11 capabilities + 6 coreReadTables +
  entrypoints worker + ui + migrationsDir. Dropped 'users' from
  coreReadTables (SDK type union doesn't include it — another stale-research-
  doc drift caught by tsc).
- **src/worker.ts** — registers registerResolveRefs +
  registerFlattenBlockerChain at setup.
- **5 surface stubs** under src/ui/surfaces/ — each wraps in
  <ClaritySurfaceRoot> and renders placeholder text linking to the plan
  that will fill it in.
- **src/ui/index.tsx** — barrel-exports all 5 named components matching the
  manifest exportName fields.
- **scripts/audit-postinstall.mjs** — walks node_modules/.pnpm/, fails on
  any unallowlisted dep with lifecycle scripts. esbuild allowlisted with
  documented rationale citing Plan 02-01 SMOKE-FINDINGS §D-08(f). 216
  packages clean on the current install.
- **.npmrc ignore-scripts=true** — defense in depth alongside the audit.
- **.github/workflows/scaffold-check.yml** — CI on every PR + push to main
  running: pnpm install --frozen-lockfile → audit-postinstall → CSS scope →
  ESLint src/ → tsc → node:test (shared + worker + ui) → pnpm build.

## Verification

Local CI sequence (matches what scaffold-check.yml runs in GitHub Actions):

- audit-postinstall: **216 packages scanned, 0 unallowlisted lifecycle scripts**
- check-css-scope: **11 top-level selectors, all scoped under [data-clarity-surface]**
- ESLint src/: **clean** (deliberately-bad fixtures linted separately by the test wrapper)
- tsc --noEmit: **exit 0**
- node:test across shared + worker + ui: **34 pass / 0 fail**
- pnpm build: **dist/worker.js (238b) + dist/ui/index.js (2.6kb) + dist/ui/index.css (2.1kb) + dist/manifest.js** all green
- Dynamic-import manifest probe: **5 slots, 11 caps, migrationsDir='migrations', entrypoints worker+ui, agents[] absent (lands in 02-03)**

Self-trap caught during execution (worth flagging): the PRIM-03 grep guard
in test/shared/blocker-chain.test.mjs fired against MY OWN comments in
src/shared/blocker-chain.ts (had used "LLM" in a header comment explaining
what the file does NOT contain). Same pattern hit use-poll.ts (header
comment mentioned the Web Crypto async digest API by name). Both reworded
to non-trigger phrasings. The grep is intentionally simple — future edits
that add an AI dependency will fail the test immediately.

## What this unlocks

**Plan 02-03 (Editor-Agent + Reader view fillers).** Every primitive Reader
view needs — `<RefChip>`, `<StatePill>`, `<ClaritySurfaceRoot>`,
`resolveRefs`, `flattenBlockerChain`, `useHostNavigation` — exists with
unit tests + type contracts + trust-model lint coverage. Plan 02-03 fills
in the components without re-inventing shared infrastructure.

**Plan 02-04 (Situation Room + opt-in + coexistence CI).** Same story
amplified — Situation Room composes AgentGrid + CriticalPathStrip +
ArtifactsShippedShelf out of the primitives; opt-in gate uses
getOptIn/isOptedIn helpers; usePollWithLeader wraps use-poll with
BroadcastChannel.

**Trust-model regression-proof.** Future feature code in src/ui/ cannot
ship a raw fetch() or raw <a href="/api/..."> without ESLint failing CI.
Future deps cannot ship postinstall scripts without the audit failing CI.
Future CSS additions to theme.css cannot leak onto the host page without
check-css-scope.mjs failing CI. The trust posture is enforced
STRUCTURALLY, not in code review.
