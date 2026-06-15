---
phase: 21-stuck-agent-reply-in-place
plan: 02
subsystem: ui
tags: [reply-in-place, stuck-agent, copy-variant, STUCK-05]
requires:
  - "ReplyInPlace primitive (Plan 14-02) — the single shared reply mechanic"
  - "Engine nudge verdict + reply-reachable flip (Plan 21-01)"
provides:
  - "ReplyInPlaceProps.variant?: 'answer' | 'nudge' — optional, backward-compatible copy prop"
  - "Pure copy-selector → variant-aware aria-label/placeholder/Send-button label"
affects:
  - "Wave-2 surfaces (employee-row, live-blocker-panel) will pass variant='nudge' on the 'nudge' branch"
tech-stack:
  added: []
  patterns:
    - "Copy-only prop: a pure selector keyed on a discriminant, never a behavior branch"
key-files:
  created: []
  modified:
    - "src/ui/surfaces/_shared/reply-in-place.tsx"
    - "test/ui/surfaces/_shared/reply-in-place.test.mjs"
decisions:
  - "D-4: variant is render-copy ONLY — kept out of dispatchReply body + dep array (T-21-03 mitigation)"
  - "'answer' default is byte-identical to pre-Phase-21 literals → zero regression for AWAITING_HUMAN callers"
metrics:
  duration: ~12 min
  completed: 2026-06-15
  tasks: 1
  files: 2
---

# Phase 21 Plan 02: ReplyInPlace variant copy prop Summary

Added an optional, backward-compatible `variant?: 'answer' | 'nudge'` prop to the ONE shared `<ReplyInPlace>` primitive — a pure copy-selector that swaps the input aria-label/placeholder and Send-button label into stuck-context "Nudge to unstick" wording when `variant='nudge'`, with `'answer'` (the default) byte-identical to today's AWAITING_HUMAN copy. No dispatch or behavior change; the Phase-14 SC3 "one primitive, no copies" rule is preserved.

## What Was Built

- **`ReplyInPlaceProps.variant?: 'answer' | 'nudge'`** — optional union with a doc comment citing 21-CONTEXT D-4: copy only, default `'answer'`, never changes dispatch.
- **Default destructuring** — `variant = 'answer'` in the component signature, so existing AWAITING_HUMAN callers (which omit the prop) are unaffected.
- **Pure copy-selector** — a single `const copy = variant === 'nudge' ? {...} : {...}` producing `inputAriaLabel`, `inputPlaceholder`, `sendLabel`. No behavior branch; the selector feeds only display strings.
  - `'answer'`: `Reply to ${awaitedPartyLabel}` / `Reply to ${awaitedPartyLabel}…` / `Send` — byte-identical to the pre-edit literals.
  - `'nudge'`: `Reply to unstick ${awaitedPartyLabel}` / `Reply to unstick — your note resumes ${awaitedPartyLabel}…` / `Nudge to unstick`.
- **Render-site wiring** — the input `aria-label`/`placeholder` and the Send-button label now read from `copy.*`; the in-flight label stays `Sending…`. The chips path, `dispatchReply`, the `reachable===false` Open↗ branch, and every dispatch arg are untouched. `variant` does NOT appear inside `dispatchReply` or its dependency array (T-21-03 mitigation).
- **Test extension** — extended the existing source-grep suite `test/ui/surfaces/_shared/reply-in-place.test.mjs` with 7 new assertions: the optional union, the default, the copy-selector shape, byte-identical `'answer'` copy, `'nudge'` wording, render-site consumption, and a guard that `variant` is absent from the dispatch callback range. Updated the pending-posture assertion to match `copy.sendLabel`.

## Verification

- `npx tsc --noEmit -p tsconfig.json` → exit 0 (TSC_OK).
- `node scripts/build-ui.mjs` → exit 0; `dist/ui/index.js` 760.1kb (BUILD_OK).
- `node --test` on `reply-in-place.test.mjs` + `reply-in-place-no-uuid-leak.test.mjs` → 28/28 pass, 0 fail.
- Acceptance criteria: `grep -n "Nudge to unstick"` matches (lines 142, 148); `variant` absent from the dispatchReply callback range (asserted by test).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing pending-posture test asserted the old literal 'Send'**
- **Found during:** Task 1 (after wiring `copy.sendLabel` into the Send button)
- **Issue:** `test/ui/surfaces/_shared/reply-in-place.test.mjs` had `assert.match(CODE, /sending\s*\?\s*'Sending…'\s*:\s*'Send'/)`, which would have failed once the literal `'Send'` became `copy.sendLabel`.
- **Fix:** Updated the assertion to `/sending\s*\?\s*'Sending…'\s*:\s*copy\.sendLabel/`. This is part of the plan's "extend a unit test if the plan calls for it" mandate (D-4 / acceptance criteria) — the copy is now selector-driven.
- **Files modified:** `test/ui/surfaces/_shared/reply-in-place.test.mjs`
- **Commit:** 0719998

## Self-Check: PASSED

- `src/ui/surfaces/_shared/reply-in-place.tsx` — modified, present.
- `test/ui/surfaces/_shared/reply-in-place.test.mjs` — modified, present.
- Commit 0719998 — present in `git log`.
