---
phase: 14-do-it-here-action-loop
plan: 02
subsystem: action-loop
tags: [reply-in-place, reachable-predicate, no-uuid-leak, await-confirm, shared-primitive]
requires:
  - "14-01 (situation.replyAndResume handler — the dispatch target)"
  - "14-04 (terminalKind / needsDurabilityFlip / awaitedPartyLabel threaded onto the rows)"
provides:
  - "isReplyReachable(terminalKind) — pure AWAITING_HUMAN-only reachable predicate"
  - "<ReplyInPlace> — the single shared reply/chip/Open↗/await-confirm primitive"
  - "cannedSentence(option) — chip-label → plain operator answer sentence"
affects:
  - "wave 3 (14-03) wires <ReplyInPlace> onto the three surfaces gated on isReplyReachable(row.terminalKind)"
tech-stack:
  added: []
  patterns:
    - "verdict-driven predicate (off terminalKind), never a scrubbed-label string match"
    - "split-identity NO_UUID_LEAK: *Uuid dispatch-only consts, leafIssueId/awaitedPartyLabel render-only"
    - "await-confirm honesty: success ONLY on structured { ok }; honest error otherwise"
    - "client messageUuid idempotency (reused on Retry)"
key-files:
  created:
    - "src/shared/reply-reachable.ts"
    - "src/ui/surfaces/_shared/reply-in-place.tsx"
    - "test/shared/reply-reachable.test.mjs"
    - "test/ui/surfaces/_shared/reply-in-place.test.mjs"
    - "test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs"
  modified: []
decisions:
  - "isReplyReachable returns true for AWAITING_HUMAN ONLY; the dead AWAITING_AGENT_STUCK=true arm is removed and asserted false."
  - "The predicate reads the terminalKind STRING (Terminal['kind']) — matches the row shape from 14-04; engine (blocker-chain.ts) untouched."
  - "<ReplyInPlace> is ONE shared component under src/ui/surfaces/_shared/; the reachable boolean is computed by each surface and consumed (the primitive does not import the predicate)."
  - "Chips render iff decisionOptions is a non-empty array; each chip dispatches the SAME replyAndResume path with cannedSentence(option) — no separate decide handler."
  - "messageUuid idempotency uses a client debounce (a ref-pinned uuid reused on Retry) — no new migration/table this plan (D-15 cheaper fallback)."
metrics:
  duration: "~1 session"
  completed: "2026-06-03"
  tasks: 2
  files: 5
---

# Phase 14 Plan 02: Reply-Reachable Predicate + Shared <ReplyInPlace> Primitive Summary

The pure AWAITING_HUMAN-only `isReplyReachable(terminalKind)` predicate plus the ONE shared `<ReplyInPlace>` UI primitive (free-text input + Send, optional decision chips, Open↗ escape, `situation.replyAndResume` dispatch, await-confirm honesty, NO_UUID_LEAK) that all three blocker surfaces will import in wave 3.

## What was built

### Task 1 — `isReplyReachable(terminalKind)` (commit `0353f4e`)
- `src/shared/reply-reachable.ts` — pure exhaustive `switch` over all 8 `Terminal['kind']` values with a `const _exhaustive: never` guard (the classifyVerdict idiom).
- Returns `true` for `AWAITING_HUMAN` ONLY (the spike-proven dominant BEAAA shape). All seven other kinds → `false`, explicitly including `AWAITING_AGENT_STUCK` (DEFERRED — stays `'assign'` per Phase 12 D-05; the dead `=true` arm from the prior draft is GONE).
- Input is the `terminalKind` STRING — matches what the rows carry from 14-04; no full `Terminal` object, no `targetAgentUuid`, no `awaitedPartyLabel`/`ownerName` string match.
- Engine (`blocker-chain.ts`) NOT imported and NOT modified — purity boundary held (regression test green).
- `test/shared/reply-reachable.test.mjs` — per-kind coverage (AWAITING_HUMAN→true, the other seven→false incl. AWAITING_AGENT_STUCK→false), "exactly one reachable kind", and a purity guard (no AI token, no UUID/label field, no clock/network — comment-stripped code scan).

### Task 2 — `<ReplyInPlace>` (commit `173c1e4`)
- `src/ui/surfaces/_shared/reply-in-place.tsx` — the SINGLE shared primitive (new `_shared/` dir). Wave 3 imports THIS; no copies (SC3).
- Dispatches `usePluginAction('situation.replyAndResume')` with `{ companyId, leafIssueUuid: leafIssueUuid ?? leafIssueId, leafIssueId, body, userId, messageUuid, needsDurabilityFlip }` — mirrors owner-picker's `dispatchAssign` split + `?? leafIssueId` fallback.
- `reachable === true`: free-text input + Send; chips render iff `decisionOptions` is a non-empty array, each chip dispatching the SAME path with `cannedSentence(option)`.
- `reachable === false`: named action + Open↗ (navigates `/${companyPrefix}/issues/${leafIssueId}` — the HUMAN key, never the UUID); NO input/chips/Send. When `leafIssueId` is null → no Open↗ button (CR-01 honest degrade).
- await-confirm: `Sending…` + disabled controls in flight; success ONLY on the structured `'ok' in result && result.ok` (→ toast + `onActed()` + clear messageUuid); on `{ error }`/throw → honest error toast, `onActed` NOT called, input kept, messageUuid retained for a deduped Retry.
- `cannedSentence`: Approve→"Approved.", Reject→"Rejected.", Yes→"Yes.", No→"No.", pick-one X→"X." — plain operator sentences, never a command grammar.
- `test/ui/surfaces/_shared/reply-in-place.test.mjs` + `…-no-uuid-leak.test.mjs` — source-grep convention (node:test cannot import a `.tsx`); 18 tests covering the action wiring, the reachable=false Open↗-only branch, chip gating + shared dispatch, the dispatch param split, messageUuid reuse, await-confirm success/error gating, pending posture, cannedSentence mapping, and the NO_UUID_LEAK render-scan (no `*Uuid` inside a JSX `{...}` or rendered template).

## Verification — all green

| Command | Result |
|---|---|
| `node --test test/shared/reply-reachable.test.mjs` | pass 11 / fail 0 |
| `node --test test/ui/surfaces/_shared/reply-in-place.test.mjs …-no-uuid-leak.test.mjs` | pass 18 / fail 0 |
| `node --test test/shared/blocker-chain.test.mjs` | pass (engine untouched) |
| Full suite (all 4 files) | tests 50 / pass 50 / fail 0 |
| `node scripts/build-worker.mjs` | `dist\worker.js 2.5mb` Done |
| `node scripts/build-ui.mjs` | `dist\ui\index.js 724.8kb` Done |
| `npx tsc --noEmit` | exit 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Behavior test could not import the `.tsx` component**
- **Found during:** Task 2
- **Issue:** node:test natively type-strips `.ts` but cannot load `.tsx` (JSX) — `ERR_UNKNOWN_FILE_EXTENSION`. The initial behavior test `import { cannedSentence }` from the `.tsx` failed.
- **Fix:** Converted to the established source-grep convention (employee-row-no-uuid-leak.test.mjs) — a local mirror of `cannedSentence` plus grep guards that PIN the source to the mirrored mapping. No component logic changed.
- **Files modified:** test/ui/surfaces/_shared/reply-in-place.test.mjs
- **Commit:** 173c1e4

**2. [Rule 1 - Bug] Purity guard matched my own doc comment**
- **Found during:** Task 1
- **Issue:** The AI-token purity guard scanned raw source and matched a vendor-token substring inside the file's doc comment.
- **Fix:** Strip comments before scanning (the employee-row render-scan convention) and use the blocker-chain word-boundaried token list (`\b(openai|anthropic|claude_local|llm|gpt|completion)\b`).
- **Files modified:** test/shared/reply-reachable.test.mjs
- **Commit:** 0353f4e

## Threat coverage (from plan threat_model)
- **T-14-08 (UUID leak):** mitigated — render-scan guard asserts no `leafIssueUuid`/`targetAgentUuid`/`targetIssueUuid`/`mutationIssueUuid` inside a JSX `{...}` or rendered template; only `leafIssueId`/`awaitedPartyLabel` render.
- **T-14-09 (dead Send):** mitigated — `reachable===false` removes the Send affordance entirely; Open↗ → real human-key URL.
- **T-14-10 (double-dispatch):** mitigated — `sending` guard + one messageUuid per click reused on Retry.
- **T-14-11 (optimistic false resume):** mitigated — success only on `{ ok }`; honest error otherwise.
- **T-14-12 (Open↗ UUID 404):** mitigated — Open↗ uses `leafIssueId`; no button when null.
- **T-14-13 (chip command injection):** mitigated — `cannedSentence` emits a plain answer sentence.
- **T-14-14 (unproven shape):** mitigated — `isReplyReachable` false for everything but AWAITING_HUMAN.

## Known Stubs
None. No surface wiring this plan (that is wave 3 / 14-03 by design); the primitive + predicate are complete and tested.

## Self-Check: PASSED
- src/shared/reply-reachable.ts — FOUND
- src/ui/surfaces/_shared/reply-in-place.tsx — FOUND
- test/shared/reply-reachable.test.mjs — FOUND
- test/ui/surfaces/_shared/reply-in-place.test.mjs — FOUND
- test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs — FOUND
- commit 0353f4e — FOUND
- commit 173c1e4 — FOUND
