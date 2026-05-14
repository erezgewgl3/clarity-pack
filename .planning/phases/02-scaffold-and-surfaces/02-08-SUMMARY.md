---
phase: 2
plan: 02-08
plan_name: situation-room-gap-closure
status: TASKS_1_2_3_COMPLETE — Task 4 (Countermoves re-drill) AWAITING_HUMAN
completed_date_partial: 2026-05-14T23:00Z
wave: 6
type: execute
depends_on: ["02-04"]
gap_closure: true
parent_plan: 02-04
autonomous: false  # Task 4 is checkpoint:human-verify

one_liner: "Closes the visual-fidelity, UUID-narration, and polish gaps surfaced by the Plan 02-04 drill (DEV-06, DEV-07, DEV-08, DEV-10, DEV-11, DEV-12, DEV-13). Adds ~310 lines of CSS chrome, a pure humanizeChain helper, useOptIn cache invalidation, and a production-mode esbuild define block."

dependency_graph:
  requires:
    - "Plan 02-04 (Situation Room shipped; drill against Countermoves identified the 8 gap defects DEV-06..DEV-13)"
    - "@paperclipai/plugin-sdk 2026.512.0 PluginDataResult.refresh() (verified at dist/ui/types.d.ts:328)"
    - "sketches/paperclip-fix-situation-room.html (visual design contract)"
  provides:
    - "src/worker/jobs/humanize-snapshot.ts — pure UUID-scrubbing helpers (humanizeChain, buildIdLookup, isUuidShaped) reusable by Phase 3 Bulletin compiler + Phase 4 Chat surfaces"
    - "Plan 02-08 conventions: parse-based CSS rule-existence test (test/ui/clarity-pack-css-rules.test.mjs) — pattern for any future CSS-bearing plan in Phase 3/4"
    - "Plan 02-08 conventions: shape-negation assertion pattern (test asserts output does NOT match UUID regex) — re-usable for any operator-facing label contract"
    - "Production-mode esbuild define block — defense-in-depth template for any future bundle"
    - "DEV-11-AGENT-ONLY deviation finding (SDK has no PluginUsersClient) — recorded for Phase 3 if/when SDK adds the accessor"
  affects:
    - "Plan 02-04 status: PARTIAL → APPROVED on Task 4 verdict 'approved — phase 2 closed'"
    - "Phase 2 status: EXECUTING → COMPLETE on Task 4 approval"
    - "14 Phase-2 requirements (OPTIN-01..05 + ROOM-01..08 + COEXIST-06) flip from 'Implemented (pending rehearsal)' to Implemented on Task 4 approval"

tech_stack:
  added: []  # No new dependencies — pure source + CSS extensions
  patterns:
    - "Parse-based CSS rule-existence testing: walk theme.css char-by-char, track brace depth at top level and within @media, collect (selector, body) pairs, assert each audited classname has >=1 rule with >=1 non-trivial declaration. Node 24 cannot reliably evaluate oklch() + color-mix() + CSS variables via JSDOM/getComputedStyle, so structural parse is the contract."
    - "Shape-negation label assertions: instead of asserting an exact string, assert the output does NOT match the UUID regex /[0-9a-f]{8}-[0-9a-f]{4}-/. Catches the failure mode where a test fixture mirrors the bug (executor uses a UUID-shaped 'expected' value, so the test passes even though the bug is unfixed)."
    - "Pure helper extraction (humanizeChain): wraps the flattenBlockerChain output WITHOUT touching the deterministic-chain core. PRIM-03 guarantee preserved; narration humanization is a string-rewrite layer above."
    - "Path-A SDK refetch: usePluginData destructures refresh; toggle() awaits the mutation action then calls refresh(). No invalidationKey-bump fallback needed — SDK exposes refresh() as a stable contract (PluginDataResult.refresh: () => void at types.d.ts:328)."
    - "esbuild define for dev-mode shim suppression: define {NODE_ENV, import.meta.env.*} → dead-code-eliminates HMR client / DevTools shim branches that would otherwise produce console noise."

key_files:
  created:
    - path: "src/worker/jobs/humanize-snapshot.ts"
      role: "Pure helpers humanizeChain / buildIdLookup / isUuidShaped. Wraps every blocker_chain.terminal.label so no UUID-shaped substring reaches the UI. Agent-only resolution (SDK has no PluginUsersClient — verified, see DEV-11-AGENT-ONLY)."
    - path: "test/worker/humanize-snapshot.test.mjs"
      role: "23 unit tests for the pure helpers including shape-negation against drill fixtures."
    - path: "test/worker/situation-snapshot-narration.test.mjs"
      role: "4 integration tests asserting the situation-snapshot job INSERTs UUID-free labels for both employees and critical_path."
    - path: "test/worker/awaiting-you-count-semantics.test.mjs"
      role: "2 tests for DEV-13 — awaitingYouCount filters on viewerUserId, excludes __unowned__."
    - path: "test/ui/clarity-pack-css-rules.test.mjs"
      role: "44 parse-based CSS rule-existence tests covering 36 classnames + scope-check + display:grid assertion + 5 preserved-state-pill regressions + build-gated dist-asserts (RUN_BUILD_TESTS=1)."
    - path: "test/ui/agent-card-now-doing-fallback.test.mjs"
      role: "6 source-grep tests for DEV-12: formatAge import, fallback helper presence, no-bare-null pattern, no role+state concatenation, AgentCard export."
    - path: "test/ui/use-opt-in-cache-invalidation.test.mjs"
      role: "3 tests for DEV-10: refresh destructure, sequence (setOptIn before refresh), pattern detection (Path A or Path B)."
    - path: "test/ui/no-react-key-warnings.test.mjs"
      role: "6 static-analysis tests for DEV-07 — every .map(...) callback returning JSX has key={...} nearby (catches obvious regressions)."
    - path: "test/build/no-vite-hmr-in-production.test.mjs"
      role: "5 build-artifact tests for DEV-08: scripts/build-ui.mjs has NODE_ENV/import.meta.env defines; dist/ui/index.js does not contain /@vite/client, wss://127.0.0.1:13100, or import.meta.hot."
  modified:
    - path: "src/ui/primitives/theme.css"
      delta: "+402 lines (353 → 755)"
      role: "Plan 02-08 Task 1: ~310 lines of new CSS rules — palette extension for situation-room, CTA cluster (5 classes), page chrome (4), agent card (8), critical path (7), awaiting-you pill (4), artifacts shelf (7), sparkline (1). Every selector scoped under [data-clarity-surface]; responsive @media at 1180px and 760px."
    - path: "src/worker/jobs/situation-snapshot.ts"
      role: "Plan 02-08 Task 2 + Task 3: imports humanizeChain + buildIdLookup; per-company IdLookup built before employee walk; buildEmployeeRow wraps flattenBlockerChain output with humanizeChain. Plan 02-08 Task 3 DEV-13: awaitingYouCount now filters t.userId === viewerUserId."
    - path: "src/ui/surfaces/situation-room/agent-card.tsx"
      role: "Plan 02-08 Task 2 (DEV-12): adds nowDoingFallback() helper returning 'Standby — idle <age>' or '<state> for <age>' when employee.now_doing is null. The now-doing <p> renders unconditionally now."
    - path: "src/ui/primitives/use-opt-in.ts"
      role: "Plan 02-08 Task 3 (DEV-10): destructures refresh from usePluginData; toggle() awaits setOptIn then calls refresh(). UI flips from CTA to data-bound view without a hard refresh."
    - path: "scripts/build-ui.mjs"
      role: "Plan 02-08 Task 3 (DEV-08): adds esbuild define block setting process.env.NODE_ENV='production' + import.meta.env.{PROD:true, DEV:false, MODE:'production'} for defense-in-depth against accidental dev-mode shim inclusion."

decisions:
  - "Agent-only humanization (DEV-11-AGENT-ONLY) — SDK 2026.512.0 has no PluginUsersClient; grep on node_modules/@paperclipai/plugin-sdk/dist/types.d.ts returned zero hits for 'UsersClient'. The captured Plan 02-04 drill payload contained only agent UUIDs, so agent-only humanization closes the actual drill defect. Human-user name resolution becomes a Phase 3 follow-on if/when the SDK adds the accessor."
  - "Path A (refresh) over Path B (invalidationKey) for useOptIn cache invalidation — PluginDataResult.refresh exists in the SDK at dist/ui/types.d.ts:328 as a stable contract. Path A is cleaner and doesn't require the worker handler to accept extra params."
  - "Title-case heuristic for agent roles — 2-4 letter all-lowercase strings become all-uppercase ('ceo' → 'CEO', 'cto' → 'CTO', 'pm' → 'PM'); longer all-lowercase strings get first-letter-upper ('editor' → 'Editor'); mixed-case input passes through unchanged ('iOS Engineer' stays). Empirical: every agent role in the Paperclip default org chart is either an acronym or a single English word."
  - "now_doing fallback wording — 'Standby — idle <age>' for Standby state, '<HumanisedState> for <age>' for everything else. Phase 3's Editor-Agent prose pass will eventually replace this with richer text; this is a stand-in to fill empty card bodies."
  - "Vite HMR define block as defense-in-depth — investigation showed the drill's wss://127.0.0.1:13100 console errors originated from the HOST page's own Vite dev client, NOT the plugin bundle. The define block is added anyway because any future library import that branches on NODE_ENV could re-introduce the noise."
  - "Reader CSS NOT in scope — theme.css already covers Reader View extensively (lines 92-329); the 02-03c drill verdict was 'approved — reader green with 3 polish items deferred'. If the re-drill surfaces Reader chrome gaps they get filed as Plan 02-09."
  - "Visual fidelity bar is 'recognizable design parity', NOT pixel-perfect — the mockup uses oklch + Google Fonts that may resolve differently in the host CSS environment. The Task 4 manual rehearsal Section A checklist is a side-by-side eyeball comparison; same warm-dark palette, same 3-col grid, same serif-italic headings, not exact hex matching."

requirements_addressed:
  - "ROOM-01 — Agent card fields (DEV-12 closure: now_doing fallback + CSS chrome) — pending Task 4 confirmation"
  - "ROOM-02 — Critical Path one-line narration (DEV-11 closure: UUID humanization) — pending Task 4 confirmation"
  - "ROOM-03 — Transitively-resolved blocker chains (narration humanized) — pending Task 4 confirmation"
  - "ROOM-04 — Artifacts shelf chrome — pending Task 4 confirmation"
  - "ROOM-08 — Awaiting You pill count semantics (DEV-13 closure) — pending Task 4 confirmation"
  - "DEV-06 — Situation Room CSS chrome (closed by Task 1)"
  - "DEV-07 — React key warnings (closed by Task 3 audit; no regressions)"
  - "DEV-08 — Vite HMR console noise from plugin bundle side (closed by Task 3 define block; host-side wss errors are a Paperclip-side concern)"
  - "DEV-10 — useOptIn cache invalidation (closed by Task 3 refresh wiring)"
  - "DEV-11 — UUID-to-name narration (closed by Task 2 humanizeChain — agent-only per DEV-11-AGENT-ONLY)"
  - "DEV-12 — now_doing null fallback + role/state separation (closed by Task 2)"
  - "DEV-13 — Awaiting You count excludes __unowned__ and other-user terminals (closed by Task 2's coordinated edit in situation-snapshot.ts)"

deviations:
  - id: "DEV-11-AGENT-ONLY"
    classification: "Plan-flagged, pre-approved"
    found_during: "Task 2 implementation, pre-flight SDK shape check"
    issue: "Plan 02-08 Task 2 prescribed buildIdLookup({ agents, users }) with users sourced from ctx.users.list({ companyId }). Verified against node_modules/@paperclipai/plugin-sdk/dist/types.d.ts: no PluginUsersClient interface exists; grep on 'UsersClient' or 'users\\b' returns zero hits."
    decision: "Shipped agent-only humanization. buildIdLookup is still called with users: [] (the parameter is reserved for future SDK accessor). The captured drill payload contains ONLY agent UUIDs, so the agent-only path closes the drill's actual narration defect."
    impact: "Zero functional impact for v1. If/when SDK adds PluginUsersClient, the situation-snapshot job's buildIdLookup call gains users: await ctx.users.list({ companyId }) — one-line change."
  - id: "TASK-3-REGEX-RELAX"
    classification: "Test-design refinement"
    found_during: "Task 3 GREEN run"
    issue: "Initial use-opt-in-cache-invalidation regex required '.refresh()' (chained form). My implementation destructured refresh + called as refresh() (no dot). Both forms are valid Path A wiring."
    decision: "Relaxed the regex to accept refresh() (destructured) OR .refresh() (chained); the destructure pattern is what the SDK example code in hooks.d.ts:11 doc-comment uses, so it's idiomatic."
    impact: "Test still asserts the underlying contract (refresh invocation after setOptIn await); just accepts the more idiomatic call shape."

known_stubs: []  # No stubs introduced. Editor-Agent prose pass for now_doing is documented in agent-card.tsx as a Phase 3 enhancement, but the fallback text is real and operator-visible.

threat_flags: []  # No new security-relevant surface introduced. humanizeChain operates on string data already in-memory; per-company lookup scope documented (T-02-08-01 / T-02-08-05).

metrics:
  duration_minutes: ~80
  pre_plan_test_count: 269
  post_plan_test_count: 361
  test_delta: +92  # (one was a planned-skip)
  commits: 6  # Task 1 RED + GREEN, Task 2 RED + GREEN, Task 3 RED + GREEN
  build_ui_kb_before: 8.2 + 43.5  # css + js
  build_ui_kb_after: 17.5 + 43.5  # css grew; js stable
  worker_kb: 38.7
  theme_css_lines_before: 353
  theme_css_lines_after: 755
  files_created: 7  # 1 source + 6 test files
  files_modified: 5
---

# Plan 02-08 Summary — Situation Room Gap Closure

**Phase 2, Plan 02-08 — Gap-closure for Plan 02-04 PARTIAL.**

Plan 02-04 shipped the Situation Room functionally — opt-in gate honored, snapshot job ticking, leader election working, coexistence CI clean — but the 2026-05-14 drill against Countermoves caught three classes of defect that unit tests structurally couldn't catch:

1. **DEV-06** — Every `clarity-*` semantic classname had **zero CSS rules** backing it. `dist/ui/index.css` was 8.2 KB and contained nothing for the Situation Room surface. Every component rendered as default-browser unstyled HTML.
2. **DEV-11 / DEV-12 / DEV-13** — Critical Path narration showed raw UUIDs (`"Owner unknown — assign b2a22e50-d772-4b70-bb50-4f4e93c2e984 first"`); agent cards had blank `now_doing` slots; Awaiting You count included `__unowned__` terminals that weren't actually awaiting the viewer.
3. **DEV-07 / DEV-08 / DEV-10** — React key warnings, Vite HMR WebSocket noise (from the host's own dev mode, not the plugin), and `useOptIn().toggle()` not invalidating the get-opt-in cache (UI didn't flip after click without a hard refresh).

Plan 02-08 closes all eight defect IDs. Tasks 1-3 are executor work (autonomous, full RED→GREEN TDD); Task 4 is a checkpoint:human-verify gate for Eric to re-drill against Countermoves.

## What landed (Tasks 1-3)

### Task 1 — CSS chrome (DEV-06 closure)

**Commits:** `2898696` (RED) + `dafec55` (GREEN)

- `test/ui/clarity-pack-css-rules.test.mjs` — 44 parse-based tests. AUDITED_CLASSNAMES is a frozen export of 36 classnames covering 6 clusters (CTA, page chrome, agent card, critical path, awaiting-you pill, artifacts shelf, sparkline). For each: assert ≥1 rule exists with ≥1 non-trivial declaration AND every rule is scope-prefixed under `[data-clarity-surface]`. `.clarity-agent-grid` rule asserted to use `display: grid` or `display: flex` (proves substantive layout, not a no-op color tweak). 5 preserved-state-pill checks guard against regressions. Build-gated test (RUN_BUILD_TESTS=1) asserts dist/ui/index.css contains key classnames.
- `src/ui/primitives/theme.css` — +402 lines (353 → 755). Palette extension (`--clarity-bg-2/3/4`, `--clarity-line(-bright)`, `--clarity-ink-2/3/4`, `--clarity-you`, `--clarity-you-soft`); CTA cluster (5 classes); page chrome (4 classes with responsive `@media` at 1180px and 760px breakpoints); agent card cluster (8 classes including terminal-kind attribute variants); critical path cluster (7 classes); awaiting-you pill (4 classes); artifacts shelf (7 classes); sparkline (1 class). Every selector scoped under `[data-clarity-surface]` per SCAF-06 / COEXIST-01.
- `dist/ui/index.css` grew from 8.2 KB to **17.5 KB** (+115%); 18 references to audited classnames.
- `scripts/check-css-scope.mjs`: 94 top-level selectors, all scoped. Zero regressions.

### Task 2 — UUID-to-name narration humanization (DEV-11 + DEV-12 + DEV-13 closure)

**Commits:** `ef254ab` (RED) + `30bf4bc` (GREEN)

- `src/worker/jobs/humanize-snapshot.ts` (NEW, ~110 lines) — pure helpers: `isUuidShaped`, `buildIdLookup`, `humanizeChain`. Three-pass label rewrite:
  - **Pass 1** — `HUMAN_ACTION_ON` with `userId === '__unowned__'`: extract the first UUID from the existing label, rewrite to `"<lookup-resolved-label> has no owner assigned"` (or `"Agent has no owner assigned"` on lookup miss).
  - **Pass 2** — Any other terminal kind containing a UUID substring: substitute with lookup label or short-form `agent#abcdefgh`.
  - **Pass 3** — Belt-and-suspenders: any UUID that somehow survived gets short-formed.
  - `humanizeChain` is pure: returns NEW chain + NEW terminal; never mutates input. Discriminated-union exhaustiveness check via TS `never`.
- `src/worker/jobs/situation-snapshot.ts` — imports `humanizeChain` + `buildIdLookup`; builds per-company `IdLookup` BEFORE the employee walk (threat T-02-08-01 / T-02-08-05: per-company scope, no cross-tenant leak); `buildEmployeeRow` wraps `flattenBlockerChain` output. critical_path inherits humanization transitively. **DEV-13 fix shipped in the same edit:** `awaitingYouCount` now filters `t.userId === viewerUserId`, excluding `__unowned__` and other-user terminals.
- `src/ui/surfaces/situation-room/agent-card.tsx` — `nowDoingFallback()` helper returns `"Standby — idle <age>"` or `"<HumanisedState> for <age>"` when `employee.now_doing` is null. The `<p className="clarity-now-doing">` now renders unconditionally.
- Test files: `test/worker/humanize-snapshot.test.mjs` (23 tests); `test/worker/situation-snapshot-narration.test.mjs` (4 integration tests with shape-negation assertions against drill fixtures); `test/ui/agent-card-now-doing-fallback.test.mjs` (6 source-grep tests).

### Task 3 — Polish defect cluster (DEV-07 + DEV-08 + DEV-10 closure)

**Commits:** `54c2634` (RED) + `bcfc471` (GREEN)

- **DEV-10:** `src/ui/primitives/use-opt-in.ts` destructures `refresh` from `usePluginData` (Path A; verified `refresh(): void` exists in SDK at `node_modules/@paperclipai/plugin-sdk/dist/ui/types.d.ts:328`). `toggle()` awaits `setOptIn` then calls `refresh()`. UI flips from CTA → data-bound render within ~1 RTT after click.
- **DEV-08:** `scripts/build-ui.mjs` adds esbuild `define:` block setting `process.env.NODE_ENV='production'`, `import.meta.env.PROD=true`, `import.meta.env.DEV=false`, `import.meta.env.MODE='production'`. Defense-in-depth: dev-mode shims (HMR clients, React DevTools wiring) dead-code-eliminate. Verified: `dist/ui/index.js` contains zero references to `/@vite/client`, `wss://127.0.0.1:13100`, or `import.meta.hot`. **Investigation note:** the drill's observed WebSocket errors originated from the HOST page's own Vite dev-mode HMR client (Paperclip UI in dev mode), not the plugin bundle. The define block is defense against future drift; Section C of the re-drill confirms the plugin side is clean.
- **DEV-07:** New `test/ui/no-react-key-warnings.test.mjs` (6 static-analysis tests) catches regressions. Existing keys were already correct; no source changes needed.
- **DEV-13:** Already landed in Task 2 GREEN (same file, same commit). Test `test/worker/awaiting-you-count-semantics.test.mjs` asserts the contract: 2 `__unowned__` terminals → count 0; mixed eric/bob/__unowned__ → count 1.
- New test files: `test/ui/use-opt-in-cache-invalidation.test.mjs` (3 tests); `test/ui/no-react-key-warnings.test.mjs` (6 tests); `test/build/no-vite-hmr-in-production.test.mjs` (5 tests); `test/worker/awaiting-you-count-semantics.test.mjs` (2 tests).

## What's still pending — Task 4 (checkpoint:human-verify, BLOCKING)

**Operator:** Eric. **Target:** Countermoves Hostinger (`countermoves.gl3group.com`). **Cadence:** Single rehearsal session per the `<how-to-verify>` script in `02-08-PLAN.md` lines 920-1003.

**Pre-flight (5 min)** — confirm Caddyfile state, run local `node --test "test/**/*.test.mjs"` (expect 361 pass / 0 fail / 1 skip), run local `node scripts/build-ui.mjs` (expect 17.5 KB css), `npm pack` + `scp` to Countermoves, `cd ~/paperclip && pnpm paperclipai plugin uninstall clarity-pack && pnpm paperclipai plugin install ~/clarity-pack-*.tgz`.

**Section A — Visual fidelity (DEV-06 closure proof).** Side-by-side compare `https://countermoves.gl3group.com/COU/situation-room` with `sketches/paperclip-fix-situation-room.html`. Visual contract: agent grid is multi-column with state-pilled cards (NOT a vertical stack of unstyled `<div>`s); critical path strip has numbered list with serif italic; awaiting-you pill is yellow-bordered + soft yellow background; warm-dark palette. Bar: "recognizable design parity", not pixel-perfect.

**Section B — Narration humanization (DEV-11/12 closure).** Cmd-F page for `-d772-` (unique drill UUID substring); expect zero matches. Terminal labels read in English ("CEO has no owner assigned" etc.). No agent card has blank now_doing slot.

**Section C — Polish (DEV-07/08/10/13 closure).** Toggle Clarity off via Settings, navigate to /COU/situation-room (expect CTA), click "Enable Clarity Pack" → confirm UI flips within ~2s without hard refresh. DevTools Console: zero React key warnings; zero `wss://127.0.0.1:13100` errors from the plugin bundle; zero `/@vite/client` network requests originating from clarity-pack assets.

**Section D — Coexistence CI (optional).** `node scripts/coexistence-checks/run-all.mjs` → 6/6 PASS.

**Section E — Snapshot bookend.** INTENTIONALLY SKIPPED per session scope decision (28h after 02-03c drill exercised it on the same instance; CLAUDE.md bookend rule targets BEAAA, not Countermoves).

**Verdict shapes:**

- `"approved — phase 2 closed"` → continuation agent (or operator) executes 02-08-PLAN.md `<how-to-verify>` steps 17-25: append REHEARSAL.md row, flip Plan 02-04 to APPROVED, mark 14 requirements complete, update STATE.md (`phase_2_status: COMPLETE`, `completed_phases: 2`, `percent: 40`), update ROADMAP.md, append API-SHAPES Finding #11, single closing commit `docs(02-08): Plan 02-08 + Phase 2 close — drill APPROVED on Countermoves`, file MemPalace drawer.
- `"changes needed: <list>"` → file Plan 02-09 with the new defect register; this plan stays PARTIAL.
- `"aborted: <reason>"` → halt close-out with no state changes.

## Test count delta

| Stage | Pass | Fail | Skip | Delta |
|---|---|---|---|---|
| Plan 02-04 close | 269 | 0 | 0 | — |
| Task 1 GREEN | 312 | 0 | 1 | +43 |
| Task 2 GREEN | 345 | 0 | 1 | +33 |
| Task 3 GREEN | 361 | 0 | 1 | +16 |
| **Plan 02-08 (Tasks 1-3 complete)** | **361** | **0** | **1** | **+92** |

The 1 skip is the build-gated dist-asset check inside `test/ui/clarity-pack-css-rules.test.mjs` (passes when `RUN_BUILD_TESTS=1`).

## Commits

| Hash | Type | Description |
|---|---|---|
| `2898696` | test | Task 1 RED — CSS rule-existence contract for clarity-* classnames |
| `dafec55` | feat | Task 1 GREEN — CSS chrome for every clarity-* classname (DEV-06) |
| `ef254ab` | test | Task 2 RED — humanizeChain + narration integration + now_doing fallback |
| `30bf4bc` | feat | Task 2 GREEN — UUID-to-name narration humanization (DEV-11/12) |
| `54c2634` | test | Task 3 RED — polish defect cluster contracts (DEV-07/08/10/13) |
| `bcfc471` | fix  | Task 3 GREEN — useOptIn refresh + production esbuild + React keys + awaiting-you |

## Build sizes (for npm pack)

- `dist/ui/index.css`: 17.5 KB (was 8.2 KB — +115%)
- `dist/ui/index.js`: 43.5 KB (was ~44 KB — stable)
- `dist/worker.js`: 38.7 KB (was ~39 KB — stable)
- Estimated `clarity-pack-0.2.0+1.tgz`: ~30 KB (was 27.4 KB; the CSS delta is the only material growth)

## Conventions established

1. **Parse-based CSS rule-existence testing** — adopt for any future plan that ships substantive CSS. The pattern: read theme.css, strip block comments, walk char-by-char tracking brace depth (recognize `@media` wrappers and descend), collect (selector, body) pairs, assert each audited classname has ≥1 rule with ≥1 non-trivial declaration. Don't rely on JSDOM `getComputedStyle` for oklch/CSS-variables — Node's test runtime is unreliable there.

2. **Shape-negation assertions for operator-facing labels** — instead of `assert.equal(label, 'expected string')`, prefer `assert.doesNotMatch(label, /UUID-shape-regex/)`. This catches the failure mode where the test fixture's "expected" mirrors the bug (the executor typed a UUID-shaped expected value and the test passed even though the bug wasn't fixed).

3. **Pure helper extraction for label rewrites** — humanization is a string-rewrite pass that wraps `flattenBlockerChain` output WITHOUT touching the deterministic-chain core. PRIM-03 guarantee preserved.

4. **Path-A SDK refetch as default** — `usePluginData<T>(key, params)` returns `{ data, loading, error, refresh }`; destructure `refresh` and call it after mutating actions resolve. The invalidation-key params-bump fallback (Path B) is unnecessary at SDK 2026.512.0.

5. **esbuild define block as defense-in-depth** — every future production bundle script (`scripts/build-ui.mjs`, `scripts/build-worker.mjs`) should include `define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.env.PROD": "true", ... }` to dead-code-eliminate dev-mode shim branches.

## Self-Check: PASSED

**File existence verification** (2026-05-14T23:00Z):

- FOUND: src/worker/jobs/humanize-snapshot.ts
- FOUND: test/worker/humanize-snapshot.test.mjs
- FOUND: test/worker/situation-snapshot-narration.test.mjs
- FOUND: test/worker/awaiting-you-count-semantics.test.mjs
- FOUND: test/ui/clarity-pack-css-rules.test.mjs
- FOUND: test/ui/agent-card-now-doing-fallback.test.mjs
- FOUND: test/ui/use-opt-in-cache-invalidation.test.mjs
- FOUND: test/ui/no-react-key-warnings.test.mjs
- FOUND: test/build/no-vite-hmr-in-production.test.mjs

**Commit verification** (against `git log --all`):

- FOUND: 2898696 — Task 1 RED
- FOUND: dafec55 — Task 1 GREEN
- FOUND: ef254ab — Task 2 RED
- FOUND: 30bf4bc — Task 2 GREEN
- FOUND: 54c2634 — Task 3 RED
- FOUND: bcfc471 — Task 3 GREEN

**Test run verification:** `node --test "test/**/*.test.mjs"` → 361 pass / 0 fail / 1 skip (the RUN_BUILD_TESTS-gated dist-asset check).

**Build verification:** `node scripts/build-ui.mjs` → 17.5 KB css / 43.5 KB js. `node scripts/build-worker.mjs` → 38.7 KB. Typecheck clean.

**Coexistence CI verification:** `node scripts/coexistence-checks/run-all.mjs` → 6/6 PASS.

All claims in this SUMMARY are backed by either a file-existence check, a commit-hash check, or a test-run check.

