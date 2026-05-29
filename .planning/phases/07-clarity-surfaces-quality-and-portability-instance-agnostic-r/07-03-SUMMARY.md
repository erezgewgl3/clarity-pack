---
phase: 07-clarity-surfaces-quality-and-portability-instance-agnostic-r
plan: 03
subsystem: Situation Room org-level blocked backlog (org-truth banner; computed in the situation.snapshot DATA HANDLER, reusing the shared flattener + ranking)
tags: [situation-room, org-blocked-backlog, blocker-chain, pickTopChains, no-uuid-leak, data-handler-scope, banner, deep-link-reuse, ROOM-12, D-I4-01, D-I4-02, D-I4-03, D-I4-04, D-I4-05]
requires:
  - src/shared/blocker-chain.ts (flattenBlockerChain — the existing pure flattener, REUSED unchanged)
  - src/worker/jobs/situation-snapshot.ts (the relations.get BFS edge/nodeMeta build pattern, mirrored; the recompute job re-imports pickTopChains)
  - src/worker/handlers/resolve-refs.ts (the D-09 ctx.agents.get NO_UUID_LEAK dedupe+degrade pattern, replicated locally)
  - src/ui/surfaces/chat/deep-link.mjs (buildChatDeepLink employee-only carrier — REUSED for the per-row chat affordance)
  - src/ui/primitives/state-pill-format.ts (formatAge — REUSED for the row age chip)
  - src/ui/primitives/use-resolved-company-id.ts (extractCompanyPrefixFromPathname — instance-agnostic prefix)
provides:
  - src/shared/blocker-chain.ts (pickTopChains EXPORTED — single source of truth for the HUMAN_ACTION_ON-first ranking; the job re-imports it)
  - src/worker/handlers/org-blocked-backlog.ts (buildOrgBlockedBacklog — pure builder: walks status=blocked, flattens, ranks, caps 15, total/overflow, owner NAMES, NO_UUID_LEAK, degrade-safe, instance-agnostic)
  - src/worker/handlers/situation-room.ts (situation.snapshot DATA HANDLER computes + attaches org_blocked_backlog; SituationRoomCtx widened with issues(list+relations) + agents(get))
  - src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx (top-of-room "N blocked · M need you" banner + expandable panel; per-row title + human action + owner NAME + age + two affordances)
  - src/ui/surfaces/situation-room/index.tsx (SituationData.org_blocked_backlog + banner mounted above the room header)
affects:
  - "ROOM-12 — NEW requirement (Pending → flips to Implemented post-drill); the org-truth surface that makes the Situation Room honest about what is actually blocked"
  - "recompute-situation job — now imports pickTopChains from the shared module (byte-identical runtime; the critical-path call site is unchanged)"
  - "situation.snapshot handler — no-row path no longer returns null; it returns {org_blocked_backlog, taken_at} so the banner renders even when the materialized snapshot row is empty/stale (dead-job host)"
tech_stack:
  added: []   # NO new runtime dep — the builder + banner are hand-rolled, plugin-local; flattener/ranking/carrier all reused
  patterns:
    - "Compute-in-the-handler (D-I4-05): the org backlog is computed FRESH in the situation.snapshot DATA HANDLER (a valid HTTP-request scope), NOT the scope-dead recompute-situation job (whose host calls fail every tick on paperclipai@2026.525.0 PR #6547). The handler narrows the full PluginContext to {issues, agents, logger} and calls the pure builder."
    - "Single source-of-truth ranking: pickTopChains MOVED from the private job declaration (situation-snapshot.ts:286-303) into src/shared/blocker-chain.ts (exported); the job imports it — byte-identical runtime, zero behavior change. The new builder imports the SAME function."
    - "Reuse-not-reimplement: flattenBlockerChain (the existing deterministic DFS) flattens each blocked issue; the per-issue edge/nodeMeta set is built by mirroring the snapshot job's relations.get BFS (MAX_CHAIN_DEPTH=6); pickTopChains ranks HUMAN_ACTION_ON-first. No new graph logic."
    - "NO_UUID_LEAK (D-09): distinct owner UUIDs are deduped + resolved via ctx.agents.get → .name; a thrown/absent/missing-client lookup degrades ownerName to null (rendered 'Unassigned'), NEVER the raw UUID. The UUID is carried only as ownerAgentId — the chat-deep-link target, never visible text."
    - "Degrade-safe + instance-agnostic: a thrown issues.list → empty backlog; a per-issue relations/flatten throw → that issue is skipped (the rest survive); no company-prefix literal anywhere in the builder."
    - "Carrier reuse: the per-row 'open chat with owner' affordance reuses the ROOM-09 buildChatDeepLink({route:'employee-only'}) URL_HASH carrier (proven to survive the live host) — not a re-derived deep link."
    - "Dead-job compute-vs-cache: the handler attaches org_blocked_backlog whether or not a materialized snapshot row exists; the no-row path returns {org_blocked_backlog, taken_at:now} instead of null so the banner renders on a host where the recompute job is scope-dead."
    - "Empirical bundle-ceiling recalibration (Plan 05-04/05-11/07-02/07-04 precedent): the banner overflowed the ~1.3 kB 07-04 headroom; ceiling 696→704 kB with a justification comment + a confirmed zero-SheetJS scan."
key_files:
  created:
    - src/worker/handlers/org-blocked-backlog.ts
    - src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx
    - test/worker/org-blocked-backlog.test.mjs
    - test/ui/surfaces/situation-room/org-blocked-backlog-banner.test.mjs
  modified:
    - src/shared/blocker-chain.ts
    - src/worker/jobs/situation-snapshot.ts
    - src/worker/handlers/situation-room.ts
    - src/ui/surfaces/situation-room/index.tsx
    - src/ui/primitives/theme.css
    - test/shared/blocker-chain.test.mjs
    - test/worker/situation-room-handler.test.mjs
    - scripts/check-ui-bundle-size.mjs
    - .planning/REQUIREMENTS.md
decisions:
  - "Cap = 15 (D-I4-04 range 12–15): covers a ~two-dozen-blocked org at >half while staying scannable; total count + overflow indicator surface the rest."
  - "Auto-expand when need_you_count > 0 (Claude discretion): the operator sees the human-action backlog immediately; otherwise the banner starts collapsed."
  - "Age copy: 'blocked {formatAge(age_ms)}' (e.g. 'blocked 3d') reusing the existing state-pill formatAge; the age chip is omitted (no NaN) when no timestamp field parses (<age_source_note> defensive read of updatedAt/statusChangedAt/blockedAt/createdAt)."
  - "need_you_count = HUMAN_ACTION_ON rows whose terminal.userId === viewerUserId (not __unowned__, not other users), mirroring the snapshot job's awaiting-you semantics; viewerUserId derives from params.userId in the handler so the count is per-operator."
  - "pickTopChains moved to src/shared/blocker-chain.ts (exported) as the single source of truth; the recompute job imports it (byte-identical runtime). The builder imports the same function — no duplicated ranking."
  - "The agent grid + the misleading per-agent 'No blockers' text are LEFT UNTOUCHED (D-I4-01): the banner is the additive org-truth surface."
  - "Bundle ceiling recalibrated 696→704 kB (720,896 B): the org-blocked-backlog banner is the only UI-bundle addition (+8,073 B over the 07-04 build), overflowed the ~1.3 kB 07-04 headroom; zero SheetJS sentinels confirmed; per the 05-04/05-11/07-02/07-04 empirical-recalibration precedent. The locked banner feature surface (D-I4-01..04) was NOT crippled to fit."
metrics:
  duration: "~1 session (autonomous, ~20 min execute)"
  tasks_completed: 3
  files_created: 4
  files_modified: 9
  files_deleted: 0
  completed_date: "2026-05-29"
  suite: "2109 total / 2106 pass / 1 fail (pre-existing situation.artifacts) / 2 skip"
---

# Phase 7 Plan 03: Situation Room org-level blocked backlog (ITEM 4) Summary

**One-liner:** The Situation Room now shows a top-of-room org-truth banner ("N blocked · M need you") that expands to a panel listing ALL company-wide `status=blocked` issues — each flattened to its single human action via the EXISTING `flattenBlockerChain`, ranked HUMAN_ACTION_ON-first via the EXISTING `pickTopChains` (now exported from the shared module as the single source of truth), owner resolved to a display NAME (never a UUID — degrades to "Unassigned"), with two per-row affordances (open the issue + open chat with the owner via the reused ROOM-09 carrier) — all COMPUTED in the `situation.snapshot` DATA HANDLER (a valid scope), NOT the scope-dead recompute job. Version stays 1.0.0; no migration; no new runtime dep.

## The problem this fixes

Root cause (07-CONTEXT ITEM 4 + `situation-snapshot.ts`): `buildEmployeeRow` walks blockers PER AGENT from `current_focus_issue_id`, gated `if (startId)`. Every agent on the live host is idle/Standby (no focus) → empty chain → the card renders "No blockers" — while ~24 issues sit `status=blocked`. That is the inverse of the plugin's core promise ("every blocker chain flattened to a single human action"). The fix is output/insight only — NO new schema: an ORG-LEVEL backlog walked from `status=blocked` directly.

## What shipped

### 1. `pickTopChains` exported from the shared module + the pure builder (Task 1, RED→GREEN)

- **`src/shared/blocker-chain.ts`** gains `export function pickTopChains(chains, max)` — MOVED verbatim from the private declaration in the recompute job (`situation-snapshot.ts:286-303`): priority `HUMAN_ACTION_ON=0 > SELF_RESOLVING=1 > EXTERNAL=2 > CYCLE=3` (default 99); stable sort then `slice(0, max)`; pure. The job now `import { …, pickTopChains } from '../../shared/blocker-chain.ts'` and its local declaration is deleted — **byte-identical runtime** for the job (the critical-path call site at the old line 404 is unchanged). `flattenBlockerChain`'s bytes are untouched (its PRIM-03 AI-token grep-guard still passes).
- **NEW `src/worker/handlers/org-blocked-backlog.ts`** — `buildOrgBlockedBacklog(ctx, companyId, viewerUserId)`, a pure, structurally-typed (test-stubbable, no SDK import) builder. It:
  1. `ctx.issues.list({ companyId, status: 'blocked' })` then defensively filters `i.status === 'blocked'` (`<list_filter_note>`). A thrown list → the empty backlog `{ rows:[], total:0, blocked_count:0, need_you_count:0, overflow:false }` — never throws.
  2. For each blocked issue, builds edges + nodeMeta by the relations.get BFS (mirrors `situation-snapshot.ts:160-203`, `MAX_CHAIN_DEPTH=6`); a thrown `relations.get` on the ROOT propagates so the whole issue is skipped, an inner-node throw is skipped; then `flattenBlockerChain({ startId, edges, nodeMeta, viewerUserId })` → one Terminal (a thrown flatten skips that issue, the rest survive).
  3. Ranks the flattened chains via `pickTopChains(chains, CAP=15)` keeping the source-issue pairing.
  4. Resolves distinct owner UUIDs → display NAMES via the D-09 `ctx.agents.get` NO_UUID_LEAK pattern (dedupe; `.name`; degrade to null on throw/absent/missing-client — NEVER the UUID; guarded by `typeof ctx.agents?.get === 'function'`).
  5. Emits `OrgBlockedBacklog { rows, total, blocked_count, need_you_count, overflow }` where each `OrgBlockedRow = { issueId, identifier, title, humanAction (terminal.label), terminalKind, ownerName: string|null, ownerAgentId: string|null, age_ms: number|null }`. `total`/`blocked_count` = all blocked; `rows` = top-CAP; `overflow = total > 15`; `need_you_count` = HUMAN_ACTION_ON rows whose `terminal.userId === viewerUserId` (excludes `__unowned__` + other users).
- Instance-agnostic: zero `BEAAA`/company-prefix literal in the builder.
- **Tests:** `pickTopChains` ranking (HUMAN_ACTION_ON-first / cap / empty / pure) added to `test/shared/blocker-chain.test.mjs`; the full builder behavior pinned in `test/worker/org-blocked-backlog.test.mjs` (ranking; cap 15 + overflow + total; ownerName via agents.get NEVER the UUID; agents.get-throws → null; missing-agents-client → null; blocked-only filter; per-issue relations.get-throws skip; fully-thrown list → empty; age present vs absent; need_you_count viewer-scoped + excludes __unowned__; row shape). RED confirmed first (module missing + pickTopChains not exported), then GREEN; the snapshot suite stayed green (the move did not regress the job).

### 2. Wire into the situation.snapshot DATA HANDLER + banner/panel UI + scoped CSS + ROOM-12 (Task 2, RED→GREEN)

- **`src/worker/handlers/situation-room.ts`**: `SituationRoomCtx` widened to `OptInGuardDataCtx & { issues: Pick<PluginIssuesClient,'list'|'relations'>; agents?: Pick<PluginAgentsClient,'get'>; logger?: PluginLogger }` (mirrors `ResolveRefsCtx`). In the `situation.snapshot` handler, after resolving `companyId` and deriving `viewerUserId = params.userId`, it calls `buildOrgBlockedBacklog({ issues, agents, logger }, companyId, viewerUserId)` wrapped in try/catch (a thrown builder → an empty backlog + warn — never blanks the handler) and attaches it per `<compute_vs_cache_note>`: a snapshot row present → `{ ...payload, org_blocked_backlog, taken_at: row.taken_at }`; **no row** → `{ org_blocked_backlog, taken_at: new Date().toISOString() }` (the dead-job path — the previous `return null` would have swallowed the freshly computed backlog). The opt-in-guard wrap is unchanged. The compute is in the HANDLER, NOT the dead job.
- **`src/worker.ts`**: the `registerSituationRoomHandlers(ctx as unknown as SituationRoomCtx)` call shape is unchanged — only the TYPE widened, and ctx (the full PluginContext) carries `issues`+`agents` at runtime, so the cast still compiles.
- **NEW `src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx`** — `OrgBlockedBacklogBanner({ backlog, companyId })`. Renders nothing when `backlog` is null or `blocked_count === 0`. Otherwise a collapsible `<section className="clarity-blocked-banner">`: a toggle button "`{blocked_count} blocked · {need_you_count} need you`" + a chevron, `aria-expanded`, auto-expanded when `needYouCount > 0`. The expanded panel lists `backlog.rows`; each row renders the issue TITLE, the single human action (`row.humanAction` — React text), the owner as `row.ownerName ?? 'Unassigned'` (NEVER `ownerAgentId` as text), the age chip `blocked {formatAge(row.age_ms)}` only when `row.age_ms != null`, and TWO affordances: (a) "Open issue" → `navigate('/<companyPrefix>/issues/<identifier>')`, (b) "Open chat with {owner}" → `buildChatDeepLink({route:'employee-only', companyPrefix, assigneeAgentId: row.ownerAgentId})` then `navigate(deepLink.to)` (disabled when `ownerAgentId` is null/`__unowned__`). When `backlog.overflow`, a footer "Showing top {rows.length} of {total} blocked". All text is React text nodes; no `dangerouslySetInnerHTML`; no raw UUID rendered.
- **`src/ui/surfaces/situation-room/index.tsx`**: `SituationData` gains `org_blocked_backlog?: OrgBlockedBacklog | null`; `<OrgBlockedBacklogBanner backlog={payload.org_blocked_backlog ?? null} companyId={companyId} />` is mounted at the TOP of the returned fragment, ABOVE `<header className="clarity-room-header">` — so the agent grid below is unchanged.
- **`src/ui/primitives/theme.css`**: added `.clarity-blocked-banner` / `-toggle` / `-headline` / `-needyou` / `-chevron`, `.clarity-blocked-panel`, `.clarity-blocked-list`, `.clarity-blocked-row` (+ `-main`/`-title`/`-action`/`-meta`/`-owner`/`-age`/`-actions`/`-btn`/`-btn-chat`), `.clarity-blocked-overflow` — ALL scoped under `[data-clarity-surface='situation-room']` (check-css-scope: 164 selectors, all scoped).
- **`.planning/REQUIREMENTS.md`**: ROOM-12 added to the ROOM block (Phase 7 additions) AND a `ROOM-12 | Phase 7 / Plan 07-03 | Pending` status-table row.
- **Tests:** `test/worker/situation-room-handler.test.mjs` extended (makeCtx stubs issues.list/relations.get/agents.get) — new tests assert org_blocked_backlog is attached with the expected blocked_count + an ownerName-not-UUID row, AND the with-row payload+taken_at path, AND the no-row fresh `{org_blocked_backlog, taken_at}` (dead-job) path, AND viewer-scoped need_you_count; the original 6 tests still pass. `test/ui/surfaces/situation-room/org-blocked-backlog-banner.test.mjs` (source-grep idiom, no jsdom) pins the imports/carriers, empty→null, the two headline numbers, aria-expanded + auto-expand, owner via `ownerName ?? 'Unassigned'` (never the UUID), the two affordances + employee-only deep link, the overflow footer, no `dangerouslySetInnerHTML`, the mount-above-header, and the scoped CSS. RED confirmed first, then GREEN.

### 3. Full gates + builds + pack (Task 3)

All autonomous gates green; tarball packed. See the gate table below. **NO version bump** (1.0.0 in `package.json` + `src/manifest.ts:337` + `dist/manifest.js`); **NO migration** (latest is 0014, untouched — the backlog is COMPUTED, not stored); **NO new runtime dep** (`package.json` `dependencies` byte-unchanged).

## Deviations from Plan

### Authorized / intended

**1. [AUTHORIZED recalibration — anticipated by the plan-checker] UI bundle ceiling 696 → 704 kB.** The plan-checker correction flagged that Task 3's plan text cited a STALE 694 kB ceiling; the actual constant was already 696 kB (712,704 B, recalibrated by Plan 07-04) with only ~1.3 kB headroom. As predicted, the banner overflowed it: the built `dist/ui/index.js` went 711,429 B (07-04) → **719,502 B** (+8,073 B over the 07-04 build; +6,798 B over the 696 kB ceiling). The org-blocked-backlog banner (`org-blocked-backlog-banner.tsx`) + the banner mount/SituationData field in `index.tsx` are the ONLY new UI-bundle code (the builder is worker-side, zero UI cost; `pickTopChains` moved into a shared module the UI does not import). Per the plan's explicit contingency + the empirical-recalibration precedent (Plan 05-04 / 05-11 / 07-02 / 07-04): confirmed the overage is this plan's legitimate banner code, confirmed **zero SheetJS sentinels** (`XLSX`/`SheetJS`/`!ref` all 0 in the UI bundle), and bumped `UI_BUNDLE_BYTES_CEILING` 696→704 kB (720,896 B, ~1.4 kB headroom) with a dated justification comment ("Plan 07-03: org-blocked-backlog banner, +8,073 bytes, no SheetJS"). The locked banner feature surface (D-I4-01..04) was NOT crippled to fit.

**2. [Rule 1 - intended TDD churn] Two existing situation-room-handler tests updated in Task 2.** The handler now ALWAYS attaches `org_blocked_backlog` + `taken_at`: (a) the old "returns null when no row exists" test correctly flipped — it became "returns a fresh {org_blocked_backlog, taken_at} when NO row exists (dead-job path)" (asserts non-null + the empty-backlog shape); (b) the "returns most-recent row payload" test is unchanged in intent (taken_at + employees preserved). Not a behavior regression — the no-row path now serves the org-truth banner on a host where the recompute job is scope-dead (the load-bearing reason this plan computes in the handler). The opt-in-guard + namespace tests are untouched and still green.

**3. [No new test harness — established idiom] UI banner verified by source-grep.** Per the repo convention (no jsdom in devDependencies; mirrors `agent-card-open-chat.test.mjs` / `critical-path-affordances.test.mjs`), the banner is verified by source-grep; the load-bearing builder logic (ranking/cap/NO_UUID_LEAK/degrade/age/need_you) is asserted DIRECTLY off the pure `buildOrgBlockedBacklog`. No new devDep.

## Threat surface

- **T-07-03-UUID (load-bearing) — mitigated.** Owner display resolves via the D-09 `ctx.agents.get` dedupe pattern; a thrown/absent/missing-client lookup degrades `ownerName` to null → the row renders "Unassigned", NEVER the raw UUID. The UUID is carried only as `ownerAgentId` (the chat-deep-link target, never visible text). Pinned by the Task-1 `agents.get-throws → ownerName null` + missing-client tests AND the Task-2 banner `ownerName ?? 'Unassigned'` / no-UUID-as-text source-scan.
- **T-07-03-XSS — mitigated.** The banner emits React text nodes only (React escapes them); NEVER `dangerouslySetInnerHTML` (pinned by the banner source-scan). The two affordances navigate via the host router; the chat link rides the URL_HASH carrier that already treats every field as untrusted (deep-link.mjs T-04.2-03).
- **T-07-03-DoS — accepted.** The per-issue BFS is bounded at MAX_CHAIN_DEPTH=6; the row list is capped at 15; the flattener is the existing linear deterministic DFS; a thrown SDK call degrades rather than loops.
- **T-07-03-SCOPE — mitigated.** The backlog is computed in the `situation.snapshot` DATA HANDLER (valid scope), NOT the scope-dead recompute job; pinned by the Task-2 handler test producing org_blocked_backlog from the handler's stubbed ctx.issues/ctx.agents.
- **T-07-03-SC — mitigated: NO new runtime deps** (`package.json` `dependencies` unchanged; no package install attempted).

## Quality gates (Task 3 — all green)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `node scripts/check-css-scope.mjs` | PASS — 164 selectors, all scoped under `[data-clarity-surface]` (the new `.clarity-blocked-*` are scoped under `[data-clarity-surface='situation-room']`) |
| `node scripts/build-worker.mjs` | PASS — dist/worker.js 2.4 MB |
| `node scripts/build-ui.mjs` | PASS — dist/ui/index.js 702.6 kB (719,502 B) |
| `npx tsc --project tsconfig.manifest.json` | PASS — dist/manifest.js version '1.0.0' |
| `node scripts/check-ui-bundle-size.mjs` | PASS — **719,502 B ≤ 720,896 ceiling (recalibrated 696→704 kB, see Deviation #1)**; 0 SheetJS sentinels |
| `node --test "test/**/*.test.mjs"` | **2109 total / 2106 pass / 1 fail / 2 skip** — the 1 fail is the documented pre-existing `situation.artifacts: per-agent arrays sorted DESC by createdAt`; every other test passes |
| `grep -c paperclipInvocation dist/worker.js` | **5** (≥ 5 — SDK NOT externalized) |
| Version literal | `1.0.0` in package.json:3 AND src/manifest.ts:337 AND dist/manifest.js — NO bump |
| No new dep / migration | `dependencies` unchanged; no new migration (latest is 0014, untouched) |
| Source greps | `org-blocked-backlog.ts` imports `flattenBlockerChain` + `pickTopChains` (no re-impl) + NO `BEAAA` literal; `blocker-chain.ts` `export function pickTopChains` + the job imports it; `situation-room.ts` (HANDLER) references `buildOrgBlockedBacklog` + attaches `org_blocked_backlog` (the dead JOB does NOT — `grep org_blocked_backlog situation-snapshot.ts` = 0); SituationRoomCtx widened with `Pick<PluginIssuesClient,…>`; banner has 0 `dangerouslySetInnerHTML` + renders `ownerName ?? 'Unassigned'`; index.tsx mounts `<OrgBlockedBacklogBanner` above the room header; REQUIREMENTS.md ROOM-12 in both regions |

## Tarball

- **filename:** `clarity-pack-1.0.0.tgz` (repo root)
- **sha256:** `b3dc5d37c7f1b165a00955880a2699ecc0117814f8a8d2f549dadb75b5154f41`
- **size:** `711589` bytes (711.6 kB)
- **files:** 18 (dist/ + migrations/ + README.md + package.json); 0 src/, 0 test/, 0 .png leaks
- **version:** 1.0.0 (unchanged)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `f437191` | feat(07-03): export pickTopChains + pure org-blocked-backlog builder (RED→GREEN) |
| 2 | `e892efc` | feat(07-03): wire org-blocked-backlog into situation.snapshot handler + banner UI (ROOM-12) |
| 3 | (this commit) | docs(07-03): full gates + builds + pack + SUMMARY/STATE/ROADMAP/REQUIREMENTS |

---

## AUTONOMOUS post-build deploy + live BEAAA Playwright drill (run by the ORCHESTRATOR after the build — Eric pre-authorized, do NOT pause)

Deploy via DEPLOY-RUNBOOK.md Path A (PRE-AUTHORIZED: the bookended-by-snapshots rule is satisfied by the DO daily backup + the rehearsed Phase 1 restore; no manual pre-deploy snapshot — memory `autonomous-deploy-authorization`). Requires the LOCAL environment (authenticated localhost:3100 tunnel + BEAAA SSH `ssh ariclaw` + Playwright MCP). **fail2ban bans rapid SSH** — minimize connections (rm+cat-over-stdin upload as ONE connection + one install here-string), do NOT retry-spam (07-01's 5-connection burst tripped it). Tunnel notes: Radix tabs need a real `browser_click`; read DOM via `browser_evaluate`. BEAAA has ~24 status=blocked issues incl. BEAAA-828, so the banner/panel is live-verifiable.

Deploy this exact tarball: `clarity-pack-1.0.0.tgz` sha256 `b3dc5d37c7f1b165a00955880a2699ecc0117814f8a8d2f549dadb75b5154f41` (711,589 bytes).

1. **Banner shows a NON-ZERO blocked count (PRIMARY live proof) — VERDICT: TBD.** Open the BEAAA Situation Room (`/<prefix>/situation-room`); `browser_evaluate` the banner DOM — assert the `.clarity-blocked-banner` renders and shows a NON-ZERO "N blocked" count (BEAAA has ~24), NOT hidden/zero. Core fix: the room is no longer all "No blockers" while two-dozen issues are blocked. (Note: the compute is fresh in the data handler, so it works even though the recompute job is scope-dead and the agent grid may be empty/stale.)
2. **≥1 backlog row renders title + human action + owner NAME — VERDICT: TBD.** Expand the panel (auto-expanded if M>0, else `browser_click` the toggle); assert ≥1 `.clarity-blocked-row` shows (a) an issue title, (b) a single human-action string (the terminal label), and (c) an owner that is a display NAME or "Unassigned" — assert NO raw base62/UUID owner string appears in any row's visible text (NO_UUID_LEAK live check). Record the BEAAA blocked-count + a sample row's owner-name here.
3. **Both per-row affordances exist — VERDICT: TBD.** Assert each row carries an "Open issue" control (navigates `/<prefix>/issues/<identifier>`) and an "Open chat with <owner>" control (builds the employee-only `#h=` deep link). A `browser_click` on "Open chat with <owner>" should land on the chat surface with the owner pre-selected (reuses the verified ROOM-09 carrier — known-good from the 6.1 drill).
4. **Scope-fence sanity — VERDICT: TBD.** Confirm the agent grid below is unchanged (the per-agent cards still render; the banner is additive).

Record the verdicts here. **ROOM-12 flips to Implemented** after the drill confirms steps 1–3 (the banner shows a non-zero count, ≥1 row renders title+human-action+owner-NAME, and the two affordances exist). The live BEAAA deploy + Playwright drill were NOT run in this build task — orchestrator-pending.

## Self-Check: PASSED

- Created files exist: `src/worker/handlers/org-blocked-backlog.ts`, `src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx`, `test/worker/org-blocked-backlog.test.mjs`, `test/ui/surfaces/situation-room/org-blocked-backlog-banner.test.mjs`, `07-03-SUMMARY.md`, `clarity-pack-1.0.0.tgz` — all FOUND.
- Per-task commits exist: `f437191` (Task 1), `e892efc` (Task 2) — both FOUND in git log.
- Full gate battery green (Task 3) except the documented pre-existing `situation.artifacts` test; bundle ceiling recalibrated 696→704 kB (justified, zero SheetJS); tarball packed sha256 `b3dc5d37…`.
- Live BEAAA deploy + Playwright drill NOT run in this build task — orchestrator-pending (verdicts TBD above).
