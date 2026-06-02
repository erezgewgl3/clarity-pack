---
phase: 11-honest-blocker-taxonomy-engine
plan: 07
subsystem: reader-live-blocker-panel
tags: [reader, NO_UUID_LEAK, CR-01, WR-01, WR-02, IN-01, D-15, TAX-03, blocker-action, render-scan]
requires:
  - "Plan 11-06 flatten-blocker-chain.ts scrubResultLabel — awaitedPartyLabel is scrubbed of every raw UUID at the worker boundary; 'none' affordance for blocker-free issues"
  - "src/shared/scrub-human-action.ts scrubHumanAction + UUID_RE (8-kind scrub used by the behavioral test guard)"
  - "src/ui/surfaces/situation-room/employee-row.tsx affordance-dispatch analog (wake / chat deep-link / open navigation reused, not re-invented)"
  - "11-REVIEW.md CR-01 (Reader half) / WR-01 / WR-02 / IN-01"
provides:
  - "src/ui/surfaces/reader/live-blocker-panel.tsx — blockerLine() renders data.awaitedPartyLabel (the scrubbed string) for ALL UUID-bearing kinds, never raw t.label (CR-01 Reader half / D-15 closed end to end across all 3 surfaces)"
  - "src/ui/surfaces/reader/live-blocker-panel.tsx — the .clarity-blocker-action button is wired to a real dispatch (open→navigate /issues/, reply→buildChatDeepLink employee-only, nudge→issues.requestWakeup) or OMITTED (assign/none); type=\"button\" set whenever it renders (WR-02 no dead button); blocker-free → no button (WR-01)"
  - "src/ui/surfaces/reader/live-blocker-panel.tsx — corrected IN-01 comment: the scrub runs in flatten-blocker-chain.ts WORKER handler, not the panel"
  - "test/ui/surfaces/situation-room/employee-row-actions.test.mjs — UUID-pattern render-scan: a source-scan asserting blockerLine() reads awaitedPartyLabel not t.label, plus a behavioral guard asserting scrubHumanAction yields UUID-free output across all 8 kinds (the assertion that would have caught CR-01)"
affects:
  - "Phase 11 re-verification — failed truth #5 / SC5 / D-15 (NO_UUID_LEAK) can now flip to VERIFIED: all three blocker surfaces (employee-row, needs-you-banner, live-blocker-panel) render only scrubbed labels"
tech-stack:
  added: []
  patterns:
    - "Render the worker-scrubbed display string (awaitedPartyLabel), never the raw pure-engine label (t.label) — the panel is a pure consumer of the NO_UUID_LEAK guarantee, which lives at the worker boundary"
    - "Honest read-context button: render a <button> ONLY when a real onClick backs it; any affordance with no wired dispatch on this surface renders nothing — no dead button"
    - "Reuse the situation-room affordance-dispatch paths (issues.requestWakeup / buildChatDeepLink employee-only / navigate /<prefix>/issues/<identifier>) instead of inventing new ones"
    - "Behavioral UUID-pattern test guard: import the real scrubHumanAction and assert a raw-UUID terminal yields a UUID-free label — catches a render leak the field-name-absence scan misses"
key-files:
  created: []
  modified:
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - test/ui/surfaces/situation-room/employee-row-actions.test.mjs
decisions:
  - "CR-01 Reader half (Task 1, committed 89cd189 in a prior session): blockerLine() now returns/embeds data.awaitedPartyLabel for AWAITING_HUMAN / EXTERNAL / CYCLE / UNOWNED / SELF_RESOLVING and the AWAITING_AGENT_WORKING/STUCK compound lines; UNCLASSIFIED unchanged (already UUID-safe degradeReason). No t.label survives in any rendered string (t.kind only, for the switch + data-terminal-kind attribute). IN-01 comment rewritten to name flatten-blocker-chain.ts as the scrub site."
  - "WR-02 / WR-01 (Task 2): the read-context honesty rule — a button renders ONLY when a real dispatch backs it. 'open' → nav to /<prefix>/issues/<identifier> (paperclip-issue-url-pattern memory); 'reply' → buildChatDeepLink employee-only (mirrors employee-row openChatWithOwner); 'nudge' → issues.requestWakeup on the leaf issue. 'assign' (needs OwnerPickerPopover, not mounted here) and 'none' render NO button. type=\"button\" + real onClick whenever a button renders; targetAgentUuid/targetIssueUuid consumed as dispatch args only, never interpolated into visible text. showButton = actionLabel !== null && onAction !== null."
  - "CR-01 test-gap (Task 3): the existing render-scan only checked *Uuid field-name absence — that is what let CR-01 pass. Upgraded with (a) a source-scan isolating blockerLine()'s body and asserting it reads data.awaitedPartyLabel and does NOT read t.label (regression-proof: reverting Task 1 fails it), and (b) a behavioral guard importing scrubHumanAction and asserting a raw-UUID terminal scrubs to a UUID-free awaitedPartyLabel across all 8 kinds. Existing field-name assertions kept (defense in depth)."
metrics:
  duration: "~25 minutes"
  completed: 2026-06-02
  tasks: 3
  files: 2
  commits: 4
---

# Phase 11 Plan 07: Reader live-blocker-panel NO_UUID_LEAK Render + No-Dead-Button Summary

The Reader surface is now the third and final blocker surface to render only **scrubbed** labels. With 11-06 making `data.awaitedPartyLabel` scrubbed at the worker boundary, `blockerLine()` renders that scrubbed string for AWAITING_HUMAN and every UUID-bearing kind instead of the raw `t.label` (which still embeds UUIDs straight off the pure engine). This closes the **CR-01 Reader half** / failed truth #5 / SC5 / D-15 (NO_UUID_LEAK). Alongside it, the `.clarity-blocker-action` button is wired to a real dispatch or honestly omitted (**WR-02** no dead button), a blocker-free issue renders no button (**WR-01** 'none' affordance), the false scrub-location comment is corrected (**IN-01**), and — critically — the NO_UUID_LEAK render-scan is upgraded so it would have **caught** CR-01 (it now asserts the rendered label text is UUID-free, not merely that `*Uuid` field names are absent from JSX). Requirement **TAX-03** satisfied on the Reader surface.

## What Shipped

- **Task 1 — CR-01 Reader half + IN-01 comment (commit 89cd189, landed in a prior session before this executor run).** `blockerLine()` renders `data.awaitedPartyLabel` for AWAITING_HUMAN, EXTERNAL, CYCLE (`Circular dependency — ${…}`), UNOWNED (the scrub already emits "… — assign an owner first", no second "— no owner"), SELF_RESOLVING (`${…} (resolves on its own)`), and the AWAITING_AGENT_WORKING/STUCK compound lines (`${…} is working` / `${…} is stuck`). UNCLASSIFIED is unchanged (UUID-safe degradeReason). No `t.label` survives in any rendered string — only `t.kind` (the switch discriminant + the `data-terminal-kind` attribute). The exhaustive switch + `const _exhaustive: never` guard is preserved. The `:40` and `:48-51` comments now correctly state the scrub runs in the `flatten-blocker-chain.ts` WORKER handler (mirroring org-blocked-backlog.ts / build-employees-rollup.ts), NOT in the panel.

- **Task 2 — WR-02 / WR-01 button wiring (commit 16851d1, this run).** Applied the read-context honesty rule: a `<button>` renders ONLY when a real dispatch backs it. Wired affordances reuse the situation-room paths — `'open'` → `nav.navigate(/${companyPrefix}/issues/${issueId})` (the `/issues/` URL pattern per the paperclip-issue-url-pattern memory, NOT `/<prefix>/<id>`); `'reply'` → `buildChatDeepLink({ route: 'employee-only' })` + navigate (mirrors employee-row's `openChatWithOwner`); `'nudge'` → `usePluginAction('issues.requestWakeup')` on the leaf issue (best-effort, no-throw, `busy` guard). `'assign'` (needs the OwnerPickerPopover, not mounted on this surface) and `'none'` set `onAction = null` → no button. `showButton = actionLabel !== null && onAction !== null`; every rendered button carries `type="button"` + the real `onClick`. The mutation targets `targetAgentUuid` / `targetIssueUuid` are read into plain consts and passed as dispatch args only — never interpolated into visible text.

- **Task 3 — CR-01 test-gap upgrade (commit d0083d1, this run).** Extended the NO_UUID_LEAK render-scan in `employee-row-actions.test.mjs` with two new tests: (1) a **source-scan** that isolates `blockerLine()`'s body and asserts it reads `data.awaitedPartyLabel` and does NOT read `t.label` — regression-proof, since reverting Task 1 fails it; (2) a **behavioral guard** that imports the real `scrubHumanAction` and asserts a terminal whose label embeds a raw hex UUID scrubs to a UUID-FREE `awaitedPartyLabel` across all 8 kinds (the exact assertion that would have caught CR-01). The existing `*Uuid` field-name-absence assertions are kept intact as defense in depth.

## Deviations from Plan

### Execution-context note (not a code deviation)

Task 1 (commit 89cd189) and a Task-1 RED test commit (09567ec, on `reader-view.test.mjs`) were already in git history at the start of this executor run, and the Task-2 button-wiring code was sitting as an uncommitted working-tree edit on `live-blocker-panel.tsx` from a prior session. This executor reconciled that state: verified the uncommitted edit was exactly the Task-2 implementation (button wiring mirroring `employee-row.tsx`, all imported dependencies present, tsc + UI suite green), committed it as 16851d1, then executed Task 3 fresh. No code was rewritten or duplicated; the prior-session work was validated against the plan's acceptance criteria before committing.

### Auto-fixed Issues

None. The plan executed as written — the only adjustment was reconciling the prior-session partial state described above. No Rule 1/2/3 fixes were needed; no authentication gates; no new package installs (threat T-11-07-SC N/A).

## Verification

- `node --test test/ui/surfaces/situation-room/employee-row-actions.test.mjs` → 19/19 pass, including the two new CR-01 guards (source-scan + behavioral UUID-pattern guard).
- `node --test "test/ui/**/*.test.mjs" "test/shared/**/*.test.mjs" "test/worker/**/*.test.mjs"` → 2160/2161 pass, 1 skipped, **0 fail** (the 11-06 chat-messages timing-flaky test passed in this run; no regressions).
- `npx tsc --noEmit` → 0 errors (big-bang stays fully migrated; the test-file `.ts` import of scrubHumanAction typechecks).
- Acceptance greps: `t\.label` → NONE in `live-blocker-panel.tsx`; `awaitedPartyLabel` → 14 matches; `flatten-blocker-chain` in comment → 4 matches; `type="button"` + `clarity-blocker-action` + `/issues/` navigation all present; the UUID-pattern guard `[0-9a-f]{8}-` present in the test.

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`. T-11-07-01 (rendered-label info-disclosure) is the CR-01 Reader-half fix — directly mitigated by rendering the scrubbed `awaitedPartyLabel`, with the upgraded behavioral test asserting the rendered string matches no UUID pattern. T-11-07-02 (`targetAgentUuid`/`targetIssueUuid` in JSX) — consumed as dispatch args only; the existing field-name scan plus the new UUID-pattern scan give defense in depth. T-11-07-03 (dead `.clarity-blocker-action` button) — WR-02 mitigated: button renders only with a wired `onClick` + `type="button"`, else omitted. No threat flags raised.

## Known Stubs

None. `blockerLine()` renders a scrubbed line for all 8 kinds; the button is either wired to a real dispatch or omitted (no placeholder/no-op). The `'assign'` affordance deliberately renders no button on the Reader surface (the OwnerPickerPopover is a Situation-Room control, not mounted here) — this is an honest omission, not a stub; the Situation Room owns the assign-owner flow (Plan 09-04).

## For Phase 11 Re-verification

- All three blocker surfaces (`employee-row.tsx`, `needs-you-banner.tsx`, `live-blocker-panel.tsx`) now render only scrubbed labels. Failed truth #5 / SC5 / D-15 (NO_UUID_LEAK) can flip to VERIFIED. The render-scan now carries a UUID-pattern guard that would have caught CR-01, so a future raw-label regression is caught by the test rather than at drill time.

## Self-Check: PASSED

Both modified files exist on disk (`src/ui/surfaces/reader/live-blocker-panel.tsx`, `test/ui/surfaces/situation-room/employee-row-actions.test.mjs`). All three per-task commits are present in git history: 89cd189 (Task 1 CR-01 Reader half + IN-01), 16851d1 (Task 2 WR-02/WR-01 button), d0083d1 (Task 3 CR-01 test-gap upgrade); plus the Task-1 RED commit 09567ec.
