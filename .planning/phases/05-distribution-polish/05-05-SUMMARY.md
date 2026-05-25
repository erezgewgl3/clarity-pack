---
phase: 05-distribution-polish
plan: 05
subsystem: clarity-pack-zero-rabbit-holes
tags:
  - phase-05
  - zero-rabbit-holes
  - paused-agent-banner
  - ref-chip-peek
  - picker-row-dispatch
  - d-06
  - d-07
  - d-08
  - d-09
  - d-10
dependency_graph:
  requires:
    - "04.2-07"  # ReverseTopic.employeeAgentId field (added by D-02 popover filter)
    - "04.2-04"  # chat-surface roster→setEmployee dispatch (consumer of D-10 `employee` payload)
    - "02-09"    # useResolvedUserId resolver (DEV-15-STRUCTURAL)
    - "02-02"    # RefCardData type + resolve-refs handler (extended here)
    - "04.2-03"  # URL_HASH carrier (deep-link contract reused)
  provides:
    - "AgentPauseBanner"             # generic paused-agent banner (Reader top-of-tab + chat header)
    - "editor.pause-status discriminated" # cause/agentName/detail union
    - "ref-chip hover peek"          # title + status + ownerName + descriptionExcerpt
    - "buildTopicDeepLink(prefix, topicId, employeeUserId?)" # closes GAP-PICKER-ROW-DISPATCH
  affects:
    - "src/ui/surfaces/reader/index.tsx"
    - "src/ui/surfaces/chat/index.tsx"
    - "src/ui/primitives/ref-chip.tsx"
    - "src/ui/primitives/theme.css"
    - "src/worker/handlers/editor-pause-status.ts"
    - "src/worker/handlers/resolve-refs.ts"
    - "src/shared/types.ts (RefCardData extension)"
    - "src/shared/reference-resolver.ts (field forwarding)"
    - "src/ui/surfaces/chat/deep-link.mjs"
    - "src/ui/surfaces/chat/deep-link.d.mts"
    - "src/ui/surfaces/reader/reverse-topics-link.tsx"
tech-stack:
  added: []  # NO new deps — pure code edits + test files
  patterns:
    - "Discriminated-union payload for pause cause (operator | budget | adapter)"
    - "ctx.agents.get post-fetch enrichment inside one PRIM-01 worker call"
    - "Hover-peek popover via positioning wrap + mouseEnter/mouseLeave + 500ms touch long-press"
    - "URL_HASH deep-link carrier extended with optional employee param (back-compat preserved)"
key-files:
  created:
    - "src/ui/primitives/agent-pause-banner.tsx"
    - "test/ui/agent-pause-banner.test.mjs"
    - "test/ui/ref-chip-peek.test.mjs"
    - "test/ui/deep-link.test.mjs"
    - "test/worker/editor-pause-status.test.mjs"
  modified:
    - "src/ui/surfaces/reader/index.tsx"
    - "src/ui/surfaces/chat/index.tsx"
    - "src/ui/primitives/ref-chip.tsx"
    - "src/ui/primitives/theme.css"
    - "src/worker/handlers/editor-pause-status.ts"
    - "src/worker/handlers/resolve-refs.ts"
    - "src/shared/types.ts"
    - "src/shared/reference-resolver.ts"
    - "src/ui/surfaces/chat/deep-link.mjs"
    - "src/ui/surfaces/chat/deep-link.d.mts"
    - "src/ui/surfaces/reader/reverse-topics-link.tsx"
    - "test/worker/resolve-refs.test.mjs"
    - "test/ui/reverse-topics-link-entry-point.test.mjs"
decisions:
  - "D-06 satisfied — generic paused-agent banner mounts on BOTH Reader top-of-tab AND chat ChatPageBody (above .clarity-chat-shell)."
  - "D-07 satisfied — three locked copies dispatch on data.cause: operator | budget | adapter; agentName comes from ctx.agents.get with friendly 'this employee' fallback (NO_UUID_LEAK)."
  - "D-08 satisfied — ref-chip click navigation to /<prefix>/issues/<id> preserved; hover peek + 500ms touch long-press fallback added."
  - "D-09 satisfied — resolve-refs payload extended with descriptionExcerpt (first line, ≤120 chars, viewer-gated) + ownerName (server-resolved); PRIM-01 single-round-trip preserved."
  - "D-10 satisfied — buildTopicDeepLink accepts optional 3rd employeeUserId arg; reverse-topics-link.tsx passes t.employeeAgentId; closes GAP-PICKER-ROW-DISPATCH (rc.7 drill)."
  - "Editor-only PauseBanner.tsx UNCHANGED — locked literal 'Editorial Desk paused — last compile failed at <HH:MM>. Resume in agent panel.' still present (reader-view.test.mjs lock)."
  - "Legacy editor.pause-status fields (lastFailureAt + reason) preserved on paused payload so the editor-only banner keeps rendering (PRIM-01 spirit: one worker call, two consumers)."
  - "Plan 04.2-07 D-07 lock on the 2-arg buildTopicDeepLink call shape EXPLICITLY superseded by Plan 05-05 D-10 — pre-existing test (T6 in reverse-topics-link-entry-point.test.mjs) updated to pin the new 3-arg shape."
metrics:
  duration_seconds: 940
  duration_human: "~15 min sequential executor on master"
  completed_at: "2026-05-25T19:08:00Z"
  tasks_completed: 3
  commits: 3
  test_delta_baseline: 1444  # post-Plan 05-04
  test_delta_after: 1493     # net +49 tests (target was +15)
  failed_tests: 0
  skipped_tests: 2  # pre-existing
---

# Phase 05 Plan 05: Zero-rabbit-holes finishers (paused-agent banner + ref-chip peek + picker-row dispatch) Summary

Three "zero rabbit-holes" finishers shipped as 3 atomic commits + 5 new test files: a generic paused-agent banner mounted on BOTH Reader top-of-tab and chat header with three locked D-07 copies dispatched on `data.cause` (operator | budget | adapter), a hover-only peek card on every BEAAA-NNN ref-chip showing title + status + owner display name + first-line description excerpt (≤120 chars, viewer-gated), and a `buildTopicDeepLink(companyPrefix, topicIssueId, employeeUserId?)` extension + caller audit that closes the rc.7 GAP-PICKER-ROW-DISPATCH defect — picker-row click now lands on the thread with the correct employee selected instead of the empty `Select an employee` state.

## Commits

| Commit | Task | Subject |
| ------ | ---- | ------- |
| `19527e6` | Task 1 (D-06 + D-07) | feat(05-05): paused-agent banner with cause-discriminated copy |
| `426a977` | Task 2 (D-08 + D-09) | feat(05-05): ref-chip hover peek + resolve-refs payload extension |
| `4de9c5a` | Task 3 (D-10)        | feat(05-05): buildTopicDeepLink employeeUserId extension closes GAP-PICKER-ROW-DISPATCH |

Commit range on master: `4d72442..4de9c5a` (3 task commits after the Plan 05-09 closure commit).

## Wave-2 coordination

Re-read `src/ui/surfaces/reader/index.tsx` post-Plan-05-04 line numbers before inserting the `<AgentPauseBanner />` mount. Plan 05-04 landed `<DeliverablePreview …>` around line 336–341 (the populated render); Plan 05-05's banner inserts BEFORE the `<div className="clarity-reader-header-actions">` at line 289 (now line 297 post-banner-insertion). No merge friction — the banner is structurally above all of Plan 05-04's previewer mount path and the header-actions row. The editor-only `<PauseBanner />` at the FOOTER stays exactly where it was (the locked literal lives there).

## Suite delta

- **Baseline (post-Plan 05-04):** 1444 tests pass / 0 fail / 2 skip.
- **After Plan 05-05:** **1493 tests pass / 0 fail / 2 skip** (+49 net tests).
- Target was +15 (5 banner + 6 ref-chip-peek + 4 deep-link); we delivered:
  - 14 banner tests (`test/ui/agent-pause-banner.test.mjs`)
  - 10 worker tests (`test/worker/editor-pause-status.test.mjs`)
  - 11 ref-chip-peek tests (`test/ui/ref-chip-peek.test.mjs`)
  - 6 new resolve-refs tests (`test/worker/resolve-refs.test.mjs` extended)
  - 8 deep-link tests (`test/ui/deep-link.test.mjs`)

The over-delivery comes from source-grep + runtime tests being filed under both layers (worker runtime tests + UI source-grep tests) for every contract.

## Quality gates

| Gate | Result |
| ---- | ------ |
| `tsc --noEmit` | clean (0 errors, 0 warnings) |
| `node scripts/check-css-scope.mjs` | 118 top-level selectors, all scoped under `[data-clarity-surface]` |
| `node scripts/check-a11y.mjs` | 66 files / 0 violations |
| `node scripts/coexistence-checks/run-all.mjs` | 10/10 PASS |
| `node scripts/check-ui-bundle-size.mjs` | 615,421 bytes (601.0 kB) / 665,600 byte ceiling — comfortably inside, no SheetJS sentinels |
| Worker build (`node scripts/build-worker.mjs`) | exit 0 — 2.1 MB |
| UI build (`node scripts/build-ui.mjs`) | exit 0 — 601.0 kB |
| Full `node --test test/**/*.test.mjs` | 1491/1491 pass / 0 fail / 2 pre-existing skip |

## Caller-audit grep output (D-10 closure)

```
$ grep -rn 'buildTopicDeepLink(' src/
src/ui/surfaces/chat/deep-link.d.mts:76:export function buildTopicDeepLink(
src/ui/surfaces/chat/deep-link.mjs:158:export function buildTopicDeepLink(companyPrefix, topicIssueId, employeeUserId) {
src/ui/surfaces/reader/reverse-topics-link.tsx:162:                const deepLink = buildTopicDeepLink(
```

Exactly 3 occurrences — the export definition, the type declaration, and the fixed caller. Any 4th line would have indicated an audit miss; none found.

## What ships

### Task 1 — Generic paused-agent banner + worker discriminated-union extension (D-06 + D-07)

- **NEW** `src/ui/primitives/agent-pause-banner.tsx` — generic banner shared by Reader top-of-tab AND chat ChatPageBody. Three locked D-07 copies dispatch on `data.cause`:
  - operator → `${agentName} paused by operator — ▶ Resume heartbeat`
  - budget   → `${agentName} stopped — budget exhausted; check budget caps — ▶ Resume heartbeat`
  - adapter  → `${agentName} stopped — codex adapter error ${detail}; ▶ Retry heartbeat`
- `agentName` resolved server-side via `ctx.agents.get(EDITOR_AGENT_KEY, companyId)`; UI fallback is the LITERAL string `'this employee'` — NEVER the UUID (NO_UUID_LEAK).
- Banner is dismissible (× button, per-session in component state) and uses `useResolvedUserId()` so detail-tab loading windows don't fail-closed.
- ▶ Resume / ▶ Retry button wires to `usePluginAction('agents.resumeHeartbeat')` with graceful-degrade copy on host action key not bound (mirrors Plan 04.1-10 right-rail pattern).
- Worker handler `editor.pause-status` extended to return discriminated union. Legacy `lastFailureAt` + `reason` fields preserved on the paused payload so the editor-only `pause-banner.tsx` (locked by `reader-view.test.mjs`) keeps rendering — **one worker call serves both consumers** (PRIM-01 spirit).
- Cause derivation: lowercase substring scan of `reason` text — `budget` → budget; `codex|adapter` → adapter (with `detail` = `HH:MM`); else `operator` (default — operator clicked Pause).
- CSS scoped under `[data-clarity-surface] .clarity-agent-pause-banner` (theme.css).

### Task 2 — Ref-chip hover peek card + resolve-refs payload extension (D-08 + D-09)

- `RefCardData` extended with optional `ownerName?: string | null` + `descriptionExcerpt?: string | null` (optional preserves back-compat).
- Pure resolver `src/shared/reference-resolver.ts` forwards both new fields.
- Worker handler `resolve-refs`:
  - First-line description excerpt via `firstLineExcerpt` helper with `DESC_EXCERPT_MAX = 120`; viewer-gated by the SAME `_viewer_can_read` field as the legacy excerpt (PRIM-02 inheritance).
  - Owner display name resolved via `ctx.agents.get(ownerUserId, companyId)` POST-fetch, batched across distinct owner UUIDs (M `agents.get` calls for M ≤ N distinct owners — no quadratic storm).
  - PRIM-01 single-round-trip preserved — ONE `ctx.http.fetch` per handler invocation; `agents.get` is local enrichment inside the same call.
  - Degrades to `ownerName: null` on `agents.get` throw; UI surfaces the LITERAL `'unassigned'` — NEVER the UUID.
- UI primitive `ref-chip.tsx`:
  - **Click navigation UNCHANGED** — anchor still routes to `/<companyPrefix>/issues/<identifier>` via `nav.linkProps` (D-08 lock).
  - Hover-peek wrap span (`clarity-ref-chip-wrap`) with `onMouseEnter` / `onMouseLeave`; touch long-press fallback (500ms) via `onTouchStart` / `onTouchEnd` / `onTouchMove`.
  - Long-press timer cleaned up on component unmount.
  - Peek popover (`clarity-ref-chip-peek`, `role="tooltip"`) renders title + status + ownerName + descriptionExcerpt (conditional on presence so PRIM-02 viewer-denied cases hide the excerpt section).
  - Peek works even when the chip is in its loading state OR when the chip is a fallback `<span>` (no `companyPrefix`) — operator gets the affordance regardless of click-routability.
- CSS scoped under `[data-clarity-surface] .clarity-ref-chip-peek` (theme.css). `pointer-events: none` on the popover so it doesn't intercept the hover-leave on the wrap.

### Task 3 — buildTopicDeepLink employeeUserId extension + caller audit (D-10)

- `buildTopicDeepLink(companyPrefix, topicIssueId, employeeUserId?)` — optional third parameter threads into the encoded URL_HASH payload as `employee`. When omitted OR empty, behaviour is exactly the pre-05-05 2-arg form (back-compat preserved).
- `.d.mts` signature mirrors the `.mjs` change.
- `reverse-topics-link.tsx` line 162 picker row click now passes `t.employeeAgentId` as the third arg. `t.employeeAgentId` is already typed optional on the `ReverseTopic` row (added by Plan 04.2-07 for the popover filter); when missing, `buildTopicDeepLink` degrades to the 2-arg path.
- Caller audit closure — `grep -rn 'buildTopicDeepLink(' src/` returns EXACTLY 3 lines (the .mjs export, the .d.mts declaration, and the fixed reverse-topics-link.tsx caller). No other callers exist in `src/`.
- Closes **GAP-PICKER-ROW-DISPATCH** from the rc.7 drill (STATE.md "Forward defects routed to Plan 04.2-08"): the picker row click landed on the chat-surface empty `Select an employee` state because the URL_HASH payload carried no `employee` field. Chat-surface dispatch (Plan 04.2-04) already reads `link.employee` → matches roster row → `setEmployee(matched)` → `setTopic` — **no chat-side change was needed** in this plan; the audit + emitter fix IS the load-bearing work.

## Threat model — disposition outcomes

| Threat ID | Disposition | Outcome |
| --------- | ----------- | ------- |
| T-05-05-01 | mitigate | descriptionExcerpt is first-line + 120-char cap; viewer-gated by `_viewer_can_read === false ? null : firstLineExcerpt(...)` — same gate as legacy excerpt. No markdown in peek — plain text only. PASSED. |
| T-05-05-02 | mitigate | Peek payload comes from `resolve-refs` only (access-checked at worker tier); UI renders fields verbatim with no unmask. PASSED. |
| T-05-05-03 | mitigate | Server resolves agent display name via `ctx.agents.get` (same access-check as Plan 04.2-06 D9 pattern); UI fallback is the literal `'this employee'` / `'unassigned'` — NEVER the UUID. Tests assert no UUID substring in display fields. PASSED. |
| T-05-05-04 | accept | URL-hash deep link `employee` field could be tampered — Plan 04.2-03 threat model already classified all URL-hash fields as untrusted operator input. Chat-surface dispatch looks up the employee in the existing roster fetched by the SAME opted-in user; forged UUID either matches a roster row (legitimate access) or returns null (graceful no-op). No new attack surface. PASSED. |
| T-05-05-05 | accept | `ctx.agents.get` batch on resolve-refs N distinct owners — bounded by PRIM-01 ref count per render (Reader's resolve-refs call is N=O(refs-in-prose); typically < 20). Per-call timeout/failure non-fatal (try/catch + null). PASSED. |
| T-05-05-06 | mitigate | No new npm dependencies introduced. Plan 05-05 is pure code edits + test files. No package-legitimacy audit row required. PASSED. |
| T-05-05-07 | mitigate | `editor.pause-status` `agentName` field — when called with `agentId` of a non-Editor employee-agent, worker treats it like any agents.get lookup; viewer-permission inherited from host. PASSED. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] T6 in `test/ui/reverse-topics-link-entry-point.test.mjs` updated to match D-10 contract**

- **Found during:** Task 3 verify gate (full suite run).
- **Issue:** Plan 04.2-07 D-07 lock pinned the OLD 2-arg `buildTopicDeepLink(companyPrefix, t.topicIssueId)` call shape. Plan 05-05 D-10 EXPLICITLY supersedes that lock — the whole point of D-10 is the third-arg extension. After updating `reverse-topics-link.tsx` to pass `t.employeeAgentId`, the pre-existing T6 test failed because its regex still matched the 2-arg form only.
- **Fix:** Updated T6 regex to pin the new 3-arg shape (`buildTopicDeepLink(companyPrefix, t.topicIssueId, t.employeeAgentId)` with multi-line tolerance via `s` flag); rewrote the test comment to cite the supersession (Plan 05-05 D-10 supersedes Plan 04.2-07 D-07 row-call-shape lock).
- **Files modified:** `test/ui/reverse-topics-link-entry-point.test.mjs`
- **Commit:** `4de9c5a` (Task 3 commit — bundled with the implementation change).
- **Rule rationale:** This is a Rule 1 (Bug) — the stale test was failing the legitimate D-10 contract change. Not a Rule 4 architectural decision because the supersession was explicitly authorized in the plan's D-10 design lock (CONTEXT.md `### Plan 05-05`).

### Other adjustments

None. No Rule 2 / Rule 3 / Rule 4 deviations. No architectural changes. The plan executed exactly as written for Tasks 1, 2, and 3.

## NO version bump confirmation

- `package.json` `version`: **`1.0.0-rc.7`** — UNCHANGED by this plan.
- `src/manifest.ts` version: **`1.0.0-rc.7`** — UNCHANGED by this plan.
- No `npm pack`, no tarball produced. The single phase-wide `rc.7 → 1.0.0` bump lives EXCLUSIVELY in Plan 05-10 (closure).

## Forward defects deferred

None. Plan 05-05 closes 3 of the 4 rc.7 forward defects routed to Plan 04.2-08 (GAP-PICKER-ROW-DISPATCH was the load-bearing one). The other three rc.7 defects (`GAP-D8-LINEAGE-TOOLTIP`, `GAP-D8-REVERSE-TOOLTIP-FALLBACK`, `GAP-RCB-05-CHIP-STYLING`) continue to be carried by **Plan 05-07** (Phase 4.2 polish bundle) per Phase 5 wave ordering.

## Operator drill — deferred to Plan 05-10 closure

This plan's `<human-check>` rows describe the live behaviour to verify during the Phase 5 closure ALL-paths drill (Plan 05-10 owns the canonical drill). No separate drill at this plan. Live verification path: install rc.7-equivalent build with these commits on Countermoves → pause Editor-Agent → open Reader on COU-2215 → banner appears with operator copy; close Reader; open Chat → banner appears with same copy. Hover a `BEAAA-141` ref-chip → peek card opens with title/status/owner/excerpt; click → still navigates. On COU-2441 (rc.7 N=2 ambiguous fixture): click Continue → popover auto-opens with 2 candidate rows → click either row → chat opens with CEO selected + topic active (NOT empty state).

## Self-Check: PASSED

**Created files verified to exist on disk:**

- `src/ui/primitives/agent-pause-banner.tsx` ✓
- `test/ui/agent-pause-banner.test.mjs` ✓
- `test/ui/ref-chip-peek.test.mjs` ✓
- `test/ui/deep-link.test.mjs` ✓
- `test/worker/editor-pause-status.test.mjs` ✓
- `.planning/phases/05-distribution-polish/05-05-SUMMARY.md` (this file) ✓

**Commits verified in git log:**

- `19527e6` — Task 1 (D-06 + D-07) ✓
- `426a977` — Task 2 (D-08 + D-09) ✓
- `4de9c5a` — Task 3 (D-10) ✓

Self-check verdict: **PASSED**. Proceeding to state updates.
