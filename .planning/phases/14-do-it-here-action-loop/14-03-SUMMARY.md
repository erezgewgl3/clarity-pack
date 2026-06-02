---
phase: 14-do-it-here-action-loop
plan: 03
subsystem: ui-blocker-surfaces
tags: [reply-in-place, situation-room, reader, org-backlog, do-it-here, SC3, SC4, NO_UUID_LEAK]
requires:
  - 14-01 situation.replyAndResume handler + messageUuid dedup
  - 14-02 isReplyReachable predicate + shared <ReplyInPlace> primitive
  - 14-04 needsDurabilityFlip/terminalKind/OrgBlockedRow fields threaded
provides:
  - ReplyInPlace mounted on all three blocker surfaces (one shared component)
  - reply ⇔ AWAITING_HUMAN gated via isReplyReachable(terminalKind) on every surface
  - honest out-of-system (reachable=false) Open↗-only degrade via the same primitive
affects:
  - src/ui/surfaces/situation-room/employee-row.tsx
  - src/ui/surfaces/reader/live-blocker-panel.tsx
  - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
  - src/ui/surfaces/_shared/reply-in-place.tsx (a11y aria-label fix)
tech-stack:
  added: []
  patterns:
    - "SC3 by construction: three surfaces import the SAME _shared/reply-in-place.tsx"
    - "split-identity props: leaf UUID is dispatch-only, human key is the display id"
    - "verdict-gated render: reachable = isReplyReachable(terminalKind), no string match"
key-files:
  created:
    - test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs
    - test/ui/surfaces/reader/live-blocker-panel-reply-in-place.test.mjs
    - test/ui/surfaces/situation-room/blocked-backlog-reply-in-place.test.mjs
  modified:
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
    - src/ui/surfaces/_shared/reply-in-place.tsx
    - test/ui/surfaces/situation-room/employee-row-actions.test.mjs
    - test/ui/reader-view.test.mjs
decisions:
  - "employee-row chain-line NOT suppressed on reply (plan scopes WARNING-2 to the Reader only)"
  - "Reader needsDurabilityFlip=false literal (no leaf-status field on BlockerChainResult — spike-safe)"
  - "Reader leafIssueUuid passed via the issueDispatchTarget const (keeps the blunt reader-view NO_UUID_LEAK guard green)"
metrics:
  duration: ~1 session
  completed: 2026-06-03
---

# Phase 14 Plan 03: Wire shared <ReplyInPlace> into all three blocker surfaces Summary

The ONE shared `<ReplyInPlace>` (wave 2) is now mounted on the Situation Room employee row, the Reader live-blocker panel, and the org-blocked backlog expander — same import, no copies (SC3) — each on its reply branch, gated `reply ⇔ AWAITING_HUMAN` via `isReplyReachable(terminalKind)`, with the real worker-emitted `needsDurabilityFlip` threaded and UUIDs kept dispatch-only.

## What shipped, per surface

**Situation Room employee row (`employee-row.tsx`):**
- New `showReply = chain?.actionAffordance === 'reply'` branch, mutually exclusive with `showAssign`.
- Mounts `<ReplyInPlace>` with `leafIssueId={chain.leafIssueId}`, `leafIssueUuid={chain.leafIssueUuid}`, `awaitedPartyLabel`, `namedAction={row.actionCard?.namedAction ?? \`waiting on ${chain.awaitedPartyLabel}\`}`, `decisionOptions={row.actionCard?.decisionOptions ?? null}`, `needsDurabilityFlip={chain.needsDurabilityFlip}` (the REAL 14-04 boolean), `reachable={isReplyReachable(chain.terminalKind)}`, `onActed={onAssignSuccess}`.
- Assign branch (`OwnerPickerPopover`, Phase 12 D-05, covers UNOWNED + AWAITING_AGENT_STUCK) untouched.

**Reader live-blocker panel (`live-blocker-panel.tsx`):**
- The `reply` affordance is now a RENDER branch (`<ReplyInPlace>`), not an `onAction` handler. The dead `replyInChat` navigate-to-chat callback + its `buildChatDeepLink` import were removed.
- `leafIssueId = data.pathIds.length <= 1 ? issueId : null` (CR-01 honest degrade for multi-hop), `leafIssueUuid={issueDispatchTarget ?? null}` (dispatch-only const), `reachable={isReplyReachable(data.terminal.kind)}`, `needsDurabilityFlip={false}` (no leaf-status field on this surface — spike-safe), `onActed={() => {}}` (usePluginData re-polls).
- **WARNING 2 fix:** the standalone `<p className="clarity-blocker-label">{blockerLine(data)}</p>` is suppressed on the reply branch (`data.actionAffordance !== 'reply'`) so the headline does not render twice; non-reply affordances keep it.

**Org-blocked backlog expander (`blocked-backlog-expander.tsx`):**
- Reply orphan rows (`row.actionAffordance === 'reply'`) mount `<ReplyInPlace>` with `leafIssueId={row.identifier}` (display key), `leafIssueUuid={row.leafIssueUuid}` (the LEAF uuid from 14-04, NOT `row.issueId` the root), `awaitedPartyLabel`, `namedAction={row.humanAction}`, `decisionOptions={row.decisionOptions}`, `needsDurabilityFlip={row.needsDurabilityFlip}`, `reachable={isReplyReachable(row.terminalKind)}`, `onActed={onAssignSuccess}`.
- Assign branch (`OwnerPickerPopover`, gated `=== 'assign'`) kept mutually exclusive; non-reply rows keep the standalone Open↗.

## Commands run (tails)

- `node --test <employee-row + live-blocker-panel mount tests>` → 25 pass / 0 fail
- `node --test <blocked-backlog mount test>` → 13 pass / 0 fail
- `node scripts/build-ui.mjs` → `dist\ui\index.js 732.8kb · Done`
- `node scripts/build-worker.mjs` → `dist\worker.js 2.5mb · Done`
- `npx tsc --noEmit` → exit 0 (clean)
- `node --test test/shared/blocker-chain.test.mjs` (engine purity) → 21 pass / 0 fail
- `node --test "test/**/*.test.mjs"` → **2513 pass / 7 fail** — all 7 = KNOWN pre-existing REQUIREMENTS CHAT/CTT traceability (out-of-scope)

## SC3 single-import cross-check

All three surfaces import `import { ReplyInPlace } from '../_shared/reply-in-place.tsx';` (one component, three mounts, no copies). The per-surface tests assert this single shared import + the shared `isReplyReachable`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing a11y] reply-in-place input had no accessible name**
- **Found during:** Task 2 full-suite gate (`test/ci/check-a11y.test.mjs`).
- **Issue:** The wave-2 (14-02) `<input className="clarity-reply-input">` had only a `placeholder`, tripping static a11y rule R2 (input requires id/name/aria-label). Pre-existing in 14-02 (verified failing at df9f76d), but the shared primitive is now mounted by all three of this plan's surfaces.
- **Fix:** Added `aria-label={\`Reply to ${awaitedPartyLabel}\`}` (scrubbed label only, NO_UUID_LEAK preserved).
- **Files modified:** `src/ui/surfaces/_shared/reply-in-place.tsx`
- **Commit:** fb59c75

**2. [Rule 1 - Bug] Reader leafIssueUuid prop tripped the blunt reader-view NO_UUID_LEAK guard**
- **Found during:** Task 1 full-suite gate (`test/ui/reader-view.test.mjs`).
- **Issue:** The pre-existing guard uses `doesNotMatch(src, /\{[^}]*target(Agent|Issue)Uuid[^}]*\}/)` against raw source — it cannot distinguish a dispatch prop from a rendered text node, so `leafIssueUuid={data.targetIssueUuid ?? null}` falsely tripped it.
- **Fix:** Pass `leafIssueUuid={issueDispatchTarget ?? null}` via the existing dispatch-only const (the file's own documented NO_UUID_LEAK convention). Updated my mount test to assert the const pattern.
- **Files modified:** `src/ui/surfaces/reader/live-blocker-panel.tsx`, `test/ui/surfaces/reader/live-blocker-panel-reply-in-place.test.mjs`
- **Commit:** fb59c75

**3. [Rule 1 - Stale test] 09-04 backlog assertion contradicted this plan**
- **Found during:** Task 2 full-suite gate (`employee-row-actions.test.mjs`).
- **Issue:** A Phase 09-04 test asserted `doesNotMatch(EXPANDER, /leafIssueUuid=/)` — i.e. the backlog expander never passes a `leafIssueUuid`. Phase 14-04 + 14-03 deliberately reverse this: the reply mount passes the distinct `row.leafIssueUuid` (LEAF uuid).
- **Fix:** Scoped the no-leafIssueUuid-prop guarantee to the `OwnerPickerPopover` (assign) mount specifically (still true), and added an assertion that the 14-03 reply mount uses `row.leafIssueUuid`.
- **Files modified:** `test/ui/surfaces/situation-room/employee-row-actions.test.mjs`
- **Commit:** fb59c75

**4. [Rule 3 - Blocking] reader-view blockerLine body-isolation regex was LF-brittle**
- **Found during:** Task 2 full-suite gate.
- **Issue:** The guard isolates the `blockerLine()` body with `/function blockerLine\([\s\S]*?\n}\n/`; my edits saved the file with Windows CRLF, so `\n}\n` (needs LF around `}`) no longer matched → `actual: null`.
- **Fix:** CRLF-tolerant terminator `\r?\n}\r?\n` (preserves the exact isolation intent).
- **Files modified:** `test/ui/reader-view.test.mjs`
- **Commit:** fb59c75

## Known Stubs

None. All three mounts are wired to live row/chain/data fields and the real `situation.replyAndResume` dispatch (via the shared primitive). No hardcoded empty values, no placeholder data sources.

## Self-Check: PASSED
