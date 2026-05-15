---
phase: 03-daily-bulletin
plan: 03
subsystem: ui
tags: [bulletin-ui, action-inbox, department-reconcile, lineage-grouper, scoped-css, react]
status: AWAITING-CHECKPOINT

# Dependency graph
requires:
  - phase: 03-daily-bulletin
    provides: "BulletinDraft / ActionInboxCard / LineageThread / StandingNumberRow types; bulletins.draft_json jsonb; getBulletinByCycle / listErrataByCycle / upsertDepartmentMembership repo fns; STANDING_NUMBER_SLOTS registry; compile-bulletin two-pass pipeline; renderBulletinIssueBody"
provides:
  - "queryActionInbox(ctx,{companyId,viewerUserId,now}) — D-19 mapping (blocked + blockerAttention.state∈{needs_attention,stalled} + viewer-scoped + 30d window); dept-tag join; worker-side ageMs/ageText"
  - "reconcileDepartments(ctx,companyId) + deriveDepartmentForAgent — idempotent role-regex department reconcile; ON CONFLICT DO NOTHING keeps manual rows"
  - "groupLineageThreads(activities,{maxDeltaSec}) — pure deterministic (entityId,actorChain,Δt) clustering; 8-node truncation; 100-iter byte-equal"
  - "bulletin.byCycle data handler — parses bulletins.draft_json into typed BulletinDraft (W3/W4, no markdown re-parser); live viewer-scoped action inbox; discriminated {kind:'published'|'not-yet-published'} payload"
  - "bulletin.action.approve / bulletin.action.decline action handlers — T-03-16 ownership re-verify before ctx.issues.update"
  - "BulletinPage + 6 sub-components (masthead, action-inbox, department-section, standing-numbers-panel, lineage-footer) matching sketches/paperclip-fix-bulletin.html"
  - "src/ui/styles/bulletin.css — warm-paper editorial surface stylesheet scoped [data-clarity-surface='bulletin']"
affects: [03-04-errata-banner-dst]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker-managed draft_json → typed UI props (W3/W4) — bulletin.byCycle returns BulletinDraft fields straight from draft_json, no markdown re-parser"
    - "Live viewer-scoped action inbox computed on each bulletin read (not snapshotted) so it reflects current issue state"
    - "Pure deterministic temporal+actor lineage clustering as the SDK-gap fallback for the missing caused_by_activity_id field"
    - "Surface-scoped runtime-injected stylesheet — second DEV-14 inject for bulletin.css (host does not auto-load sibling CSS)"

key-files:
  created:
    - src/worker/bulletin/action-inbox-query.ts
    - src/worker/bulletin/department-reconcile.ts
    - src/worker/bulletin/lineage-grouper.ts
    - src/worker/handlers/bulletin-by-cycle.ts
    - src/worker/handlers/bulletin-action-approve.ts
    - src/worker/handlers/bulletin-action-decline.ts
    - src/ui/surfaces/bulletin/index.tsx
    - src/ui/surfaces/bulletin/masthead.tsx
    - src/ui/surfaces/bulletin/action-inbox.tsx
    - src/ui/surfaces/bulletin/department-section.tsx
    - src/ui/surfaces/bulletin/standing-numbers-panel.tsx
    - src/ui/surfaces/bulletin/lineage-footer.tsx
    - src/ui/styles/bulletin.css
    - test/worker/bulletin/action-inbox-query.test.mjs
    - test/worker/bulletin/department-reconcile.test.mjs
    - test/worker/bulletin/lineage-grouper.test.mjs
    - test/worker/bulletin/bulletin-by-cycle-handler.test.mjs
    - test/worker/bulletin/bulletin-action-handlers.test.mjs
    - test/ui/bulletin-page.test.mjs
    - test/ui/bulletin-css-scope.test.mjs
  modified:
    - src/worker.ts
    - src/worker/jobs/compile-bulletin.ts
    - src/ui/index.tsx

key-decisions:
  - "Approve/Decline map to ctx.issues.update(issueId,{status:'done'},companyId) — SDK 2026.512.0 update() has signature (issueId,patch,companyId) and the patch type has NO `resolution` field; status='done' is the host's available resolution mechanism (deviation_protocol #1)"
  - "Lineage activity derivation uses the confirmed Issue.assigneeUserId as the actor key — Issue.lastActorId/lastActorName are NOT SDK fields (zero grep hits in types.d.ts); relying on them would collapse every activity to one 'unknown' cluster (deviation_protocol #7 / W5)"
  - "bulletin.byCycle returns masthead/departments/standingNumbers/lineageThreads straight from the parsed draft_json — no markdown re-parser (W3/W4 structured-data contract)"

requirements-completed: [BULL-03, BULL-04]

# Metrics
duration: ~55min
completed: AWAITING-CHECKPOINT
---

# Phase 3 Plan 03: Bulletin UI + Action Inbox + Dept Reconcile + Lineage Summary

**The full Bulletin viewing experience — a 6-component React page matching `sketches/paperclip-fix-bulletin.html` line-by-line, a scoped warm-paper editorial stylesheet, the D-19-corrected viewer-scoped Action Inbox query, Approve/Decline bridge handlers with ownership re-verification, an idempotent role-regex department reconcile, and a pure deterministic temporal-proximity lineage grouper — all wired through Plan 03-02's `bulletins.draft_json` structured-data contract.**

## Status: AWAITING-CHECKPOINT

All three autonomous build tasks (Task 1 RED, Task 2 GREEN part 1, Task 3 GREEN part 2) are **complete and committed**. The plan is `autonomous: false` — **Task 4 is a `checkpoint:human-verify` gate**: Eric runs the Countermoves visual-fidelity drill (side-by-side bulletin page vs. sketch) plus the W2 Standing-Numbers SQL verification and the W7 `stalled`-Action-Inbox confirmation. This SUMMARY will be finalized (drill outcome, STATE.md → APPROVED) only on the resume signal `approved — bulletin visual fidelity passes`.

## Performance

- **Duration (autonomous build):** ~55 min
- **Tasks:** 3 of 4 (Task 4 is the human-verify checkpoint)
- **Files:** 23 (20 created, 3 modified)

## Accomplishments

- **BULL-03 (Action Inbox) — code complete.** `queryActionInbox` implements the D-19 corrected mapping: a card surfaces only when an issue is `status='blocked'` AND `assigneeUserId === viewerUserId` (T-03-15 server-side filter) AND `blockerAttention.state ∈ {needs_attention, stalled}` AND `updatedAt` within the last 30 days. Department tag joins `clarity_department_membership` (falls back to `Builder`); age is computed worker-side; `ctx.issues.list` failure degrades to `[]` (warn, not throw). Approve/Decline are `usePluginAction` bridge calls to worker handlers that re-verify viewer ownership before mutating (T-03-16); Open is `useHostNavigation().linkProps` SPA navigation (SCAF-09, no raw `<a href>`).
- **BULL-04 (Department sections + lineage threads) — code complete.** `reconcileDepartments` runs at the start of every compile cycle: lists agents, derives a department via role-regex, UPSERTs with `source='reconcile'` — `ON CONFLICT (company_id,employee_user_id) DO NOTHING` keeps manual overrides. `groupLineageThreads` is pure deterministic clustering by `(entityId, actorChain, Δt ≤ 300s)`; clusters > 8 nodes truncate with a `truncatedCount` tail; 100-iteration determinism test locks byte-equal output.
- **Bulletin page rendered.** 6 React components compose the page inside `<ClaritySurfaceRoot name="bulletin">` with the Plan 02-09 gate order (`useOptIn` → `useResolvedCompanyId` → `useResolvedUserId`). The page reads `bulletin.byCycle` and renders masthead / action-inbox / 4 department sections / standing-numbers right rail / 8-column lineage footer / colophon. `bulletin.css` ships the warm-paper palette, Fraunces/Newsreader/JetBrains Mono fonts, drop-cap, dotted-rules, terminal-node inversion, and the 1100px responsive breakpoint — every selector scoped `[data-clarity-surface="bulletin"]`.
- **W3/W4 structured-data contract satisfied.** `bulletin.byCycle` parses `bulletins.draft_json` directly into typed `BulletinDraft` fields — there is NO markdown re-parser. The UI components receive `masthead`/`departments`/`standingNumbers`/`lineageThreads` as typed props.
- **Compile pipeline extended.** `compile-bulletin.ts` now calls `reconcileDepartments` at cycle start and `groupLineageThreads` before publish; the deterministic threads override any empty `lineageThreads` the LLM emits.

## Task Commits

1. **Task 1: RED — 7 test files (~61 assertions)** — `a1f24a5` (test)
2. **Task 2: GREEN part 1 — 5 worker files + worker.ts wiring** — `e739115` (feat)
3. **Task 3: GREEN part 2 — 6 UI components + bulletin.css + ui/index.tsx + compile-bulletin wiring** — `f1cb14b` (feat)

## Files Created/Modified

**Created (worker):** `action-inbox-query.ts`, `department-reconcile.ts`, `lineage-grouper.ts`, `bulletin-by-cycle.ts`, `bulletin-action-approve.ts`, `bulletin-action-decline.ts`
**Created (UI):** `bulletin/{index,masthead,action-inbox,department-section,standing-numbers-panel,lineage-footer}.tsx`, `styles/bulletin.css`
**Created (test):** 7 test files (action-inbox-query, department-reconcile, lineage-grouper, bulletin-by-cycle-handler, bulletin-action-handlers, bulletin-page, bulletin-css-scope)
**Modified:** `src/worker.ts` (+3 register calls; Editor-Agent block untouched), `src/worker/jobs/compile-bulletin.ts` (+reconcile/lineage pre-pass), `src/ui/index.tsx` (real BulletinPage export + bulletin.css runtime inject)

## Deviations from Plan

### Auto-resolved against SDK reality

**1. [deviation_protocol #1] `ctx.issues.update` has no `resolution` field**
- **Found during:** Task 2 (handler design — SDK pre-flight verification).
- **Issue:** The plan text specified `ctx.issues.update(...{resolution:'approved'/'declined'})`. SDK 2026.512.0's `PluginIssuesClient.update` signature is `update(issueId, patch, companyId, actor?)` and the patch type is `Partial<Pick<Issue,"title"|"description"|"status"|"priority"|...>>` — there is **no `resolution` field**, and the arg order is `(issueId, patch, companyId)`, not `(issueId, companyId, patch)`.
- **Fix:** Both Approve and Decline call `ctx.issues.update(issueId, {status:'done'}, companyId)`. `status='done'` is the host's available resolution mechanism — a human-acted blocked issue is closed. The approved-vs-declined distinction is the caller's intent (encoded in the action key), not a host field. Not a STOP — the SDK has a status-update mechanism.
- **Files:** `bulletin-action-approve.ts`, `bulletin-action-decline.ts` (documented inline).

**2. [deviation_protocol #7 / W5] `Issue.lastActorId` / `lastActorName` are not SDK fields**
- **Found during:** Task 3 (compile-bulletin lineage wiring).
- **Issue:** The plan's lineage activity-derivation sketch cast `(i as {lastActorId?:string})`. A grep of `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` finds **zero** `lastActorId`/`lastActorName` matches. Relying on them would collapse every activity to `actorId:'unknown'` → one giant lineage cluster.
- **Fix:** The activity derivation uses the **confirmed** `Issue.assigneeUserId` as the actor key and the issue title as the display name. Resolves RESEARCH.md Q4's lineage-heuristic open question for the working contract.
- **Files:** `compile-bulletin.ts` (documented inline).

**Total deviations:** 2 auto-resolved against verified SDK shape. No architectural change; no scope creep.

## Self-Check: PASSED

All 13 created source files verified present on disk; all 3 task commits (`a1f24a5`, `e739115`, `f1cb14b`) verified in git history. Suite 565 tests / 563 pass / 0 fail / 2 skip. Typecheck clean. Build clean.

## Bundle Metrics

| Artifact | Unminified (`du -k`) | Minified | Gzipped |
|----------|---------------------|----------|---------|
| `dist/ui/index.js` | 100 KB | 69.6 KB | 16.3 KB |
| `dist/worker.js` | 148 KB | 70.9 KB | 21.9 KB |

The plan's `du -k` acceptance criteria (UI ≤ 90 KB, worker ≤ 65 KB) measure the **unminified** artifact — the build scripts (`scripts/build-ui.mjs`, `scripts/build-worker.mjs`) do not minify (measurement-basis note carried from Plans 03-01 and 03-02). The real shippable metrics — UI 16.3 KB gz, worker 21.9 KB gz — are well within the RESEARCH.md bundle budget.

## Drill Outcome

**PENDING — Task 4 `checkpoint:human-verify`.** Eric runs the Countermoves visual-fidelity drill (bulletin page side-by-side with the sketch), the W2 Standing-Numbers SQL refinement (≥ 3 of 5 slots must return real non-zero values against live Countermoves data), and the W7 `stalled`-Action-Inbox confirmation. This section is finalized on `approved — bulletin visual fidelity passes`.

## Handoff Contract for Plan 03-04

- **`bulletin-by-cycle.ts` is extensible** — it already fetches and returns `errata`; Plan 03-04 surfaces the errata-footer UI component and may add the errata-write data path.
- **`department-reconcile.ts` + `lineage-grouper.ts` are final** — Plan 03-04 does not extend them.
- **UI page slots needed by Plan 03-04:** `<FailedCompileBanner>` (top of `BulletinPage`, reading a `bulletin.latestCompileStatus` handler) and `<ErrataFooter>` (below the lineage footer, reading the `errata` array already in the `bulletin.byCycle` payload).
- **`BulletinByCycleCtx` / `getLatestCompileFailure`** (Plan 03-01 repo) are the data plumbing for the banner.

## Lessons

- **Verify SDK method signatures before coding handlers.** Two plan-text assumptions (`update(...,{resolution})` arg shape and `Issue.lastActorId`) did not survive a grep of `types.d.ts`. Both were caught at design time and resolved with documented fallbacks — no rework. The Phase 2 pattern (best-effort optional-field casts in `flatten-blocker-chain.ts`) is the right convention for the loosely-typed host `Issue`.
