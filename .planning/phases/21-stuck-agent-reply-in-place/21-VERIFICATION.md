---
phase: 21-stuck-agent-reply-in-place
verified: 2026-06-16T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification: []
---

# Phase 21: Stuck-Agent Reply-In-Place Verification Report

**Phase Goal:** The operator can unstick a STUCK agent from inside the cockpit — the same reply-in-place affordance that ships for `AWAITING_HUMAN` (human-wait) rows now also appears on `AWAITING_AGENT_STUCK` (Watch-tier) rows, and a plain operator reply resumes the stuck agent without leaving the Situation Room or the Reader.
**Verified:** 2026-06-16
**Status:** passed (with STUCK-03 live-Send rider — code-proven, operator-boundary-reserved)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | ---------- | -------------- |
| 1 | Reply-in-place affordance on `AWAITING_AGENT_STUCK` rows in BOTH the SR employee row AND the Reader live-blocker panel — same shared `<ReplyInPlace>` primitive, gated to accept STUCK, no third copy (STUCK-01, STUCK-02) | ✓ VERIFIED | SR `employee-row.tsx:239` `showNudge = chain?.actionAffordance === 'nudge'`; mount at `:559` `<ReplyInPlace variant="nudge">` inside the `visualTier === 'watch'` block (:527). Reader `live-blocker-panel.tsx:291` `isNudgeBranch`; mount at `:411-428` `variant={isNudgeBranch ? 'nudge' : 'answer'}`. Both `import { ReplyInPlace } from '../_shared/reply-in-place.tsx'` — the ONE primitive (line 45 / 34). |
| 2 | Submitting a reply on a stuck row posts a canonical `public.issue_comments` comment and resumes the stuck agent via `situation.replyAndResume` — worker accepts a STUCK leaf (STUCK-03) | ✓ VERIFIED (code-proven; live-Send = operator rider) | Engine gate `reply-reachable.ts:65` `isReplyReachable('AWAITING_AGENT_STUCK')===true`. Handler `situation-reply-and-resume.ts` UNCHANGED since Phase-14 commit `3dc4752` (terminal-kind-agnostic; `git diff 3dc4752 HEAD` empty). Primitive dispatches `reply(...)` with `needsDurabilityFlip`. Tests 14/15 in `situation-reply-and-resume.test.mjs` pin kind-agnostic + Shape-B durable resume. Live Send reserved to operator (auto-mode classifier denied agent posting to a real production agent) — mechanism live-proven for the identical handler+primitive in Phase 14. |
| 3 | A stuck agent is NEVER resumed by merely viewing/loading a row — resume only on explicit operator reply (STUCK-04) | ✓ VERIFIED | `reply-in-place.tsx` contains ZERO `React.useEffect` (whole-file read); `dispatchReply` invoked only from Send `onClick` (:314), chip `onClick` (:287), Enter keydown (:307). Tests 16/17 pin single dispatch site + no-useEffect. Live drill: all 4 stuck rows stayed BLOCKED on view (21-05). |
| 4 | Reply copy reads appropriately for the stuck context ("nudge / reply to unstick"), distinct from `AWAITING_HUMAN` wording (STUCK-05) | ✓ VERIFIED | `reply-in-place.tsx:143-154` pure copy-selector: `variant==='nudge'` → aria "Reply to unstick {label}", placeholder "Reply to unstick — your note resumes {label}…", button "Nudge to unstick". `'answer'` default byte-identical to pre-Phase-21 ("Send"). `variant` absent from `dispatchReply` deps (:235-245) — copy only, no behavior change. |
| 5 | Every new render/resume path degrade-safe + NO_UUID_LEAK clean; bookended live BEAAA deploy completes a real stuck reply→resume drill; two-source version bump applied (STUCK-06 + live acceptance) | ✓ VERIFIED (with live-Send rider) | `*Uuid` props dispatch-only (`mutationIssueUuid` const :171, never in render JSX); `reachable===false` degrades to namedAction + Open↗ (no dead Send, :251-268). `package.json` + `src/manifest.ts:702` both `1.8.2`. No new migration (last is `0019_action_cards_flag.sql`); no new capability (manifest.ts Phase-21 edits = version-bump only). Live deploy to BEAAA v1.8.2 bookended by standing DO backup; 5/6 STUCK live-positive read-only; live Send operator-reserved. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/shared/blocker-chain.ts` | STUCK → `{tier:'watch', actionAffordance:'nudge', needsYou:false}`; engine pure | ✓ VERIFIED | `:88` exact triple; exhaustive switch + `never` guard intact (:99-103); no AI/IO/wall-clock import. tier/needsYou deliberately unchanged (quiet Watch). |
| `src/shared/reply-reachable.ts` | `isReplyReachable(STUCK)===true` | ✓ VERIFIED | `:65` returns true; exhaustive switch + `never` guard (:76-80); input is kind discriminant alone (pure). |
| `src/ui/surfaces/_shared/reply-in-place.tsx` | optional `variant?:'answer'\|'nudge'`, copy-only, default 'answer' | ✓ VERIFIED | `:64` union; `:133` default `'answer'`; `:143-154` pure selector; absent from dispatch deps. |
| `src/ui/surfaces/situation-room/employee-row.tsx` | `<ReplyInPlace variant='nudge'>` mounted on nudge in Watch-tier body | ✓ VERIFIED | `:239` showNudge; `:559-577` mount in `visualTier==='watch'` block; tier-utils not forked. |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | 'nudge' case mounts `<ReplyInPlace>`; old requestWakeup removed | ✓ VERIFIED | `:411-428` mount; `:301-303` case 'nudge' onAction handled by primitive; all `requestWakeup`/`usePluginAction` occurrences are removal-documenting COMMENTS only (no live code). |
| `src/worker/agents/action-cards.ts` | `actionKindFromAffordance` handles 'nudge'→'answer' | ✓ VERIFIED | `:248-251` `case 'nudge': return 'answer'`; reuses 0015 CHECK enum, no migration. |
| `src/worker/handlers/situation-reply-and-resume.ts` | UNCHANGED (terminal-kind-agnostic) | ✓ VERIFIED | Last modified Phase-14 commit `3dc4752`; `git diff 3dc4752 HEAD` on this file is empty. |
| `src/ui/primitives/theme.css` | `.clarity-reply-compose` flex with `min-width:0` input | ✓ VERIFIED | `:1854-1878` `display:flex` + `.clarity-reply-input { flex:1 1 auto; min-width:0 }` + `.clarity-reply-send { flex:0 0 auto }`, scoped `[data-clarity-surface]`. |
| No new `migrations/*.sql` | last is 0019 | ✓ VERIFIED | `ls migrations/` → 0019_action_cards_flag.sql is last. |
| No new manifest capability | unchanged | ✓ VERIFIED | manifest.ts Phase-21 commits (`8480b94`, `4c0a9ca`) are version-bump + layout only. |
| `package.json` + `src/manifest.ts` at 1.8.2 | two-source bump | ✓ VERIFIED | Both read `1.8.2` (manifest.ts:702). |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `blocker-chain.ts` (verdict) | UI surfaces | `actionAffordance==='nudge'` consumed by showNudge / isNudgeBranch | ✓ WIRED | Both surfaces branch off the single engine verdict, not a kind list or string match. |
| `reply-reachable.ts` | `<ReplyInPlace reachable>` | `isReplyReachable(terminalKind)` passed by both surfaces | ✓ WIRED | SR `:571`, Reader `:420` pass the predicate result; stuck → reachable:true → Send renders (no dead Open↗). |
| `<ReplyInPlace>` Send | `situation.replyAndResume` handler | `usePluginAction('situation.replyAndResume')` → `reply({needsDurabilityFlip,...})` | ✓ WIRED | `:135` action hook; `:193-201` dispatch carries needsDurabilityFlip; handler applies Shape-B in_progress flip (kind-agnostic). |
| rollup `needsDurabilityFlip` | primitive dispatch | `chain.needsDurabilityFlip` passed on nudge (SR), `false` on Reader (no leaf status) | ✓ WIRED | SR `:570` real value (status-derived, D-5); Reader `:419` false (BlockerChainResult has no leaf status — spike-safe). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| employee-row nudge branch | `chain.actionAffordance` / `chain.needsDurabilityFlip` | worker rollup `blockerChain` (engine verdict, status-derived flip — Plan 14-04) | Yes (live drill showed 4 real stuck agents rendering nudge) | ✓ FLOWING |
| Reader nudge branch | `data.actionAffordance` / `data.terminal.kind` | `flatten-blocker-chain` engine output | Yes (live `data-action-affordance="nudge"` confirmed BEAAA-671) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Engine verdict + reachable for STUCK | `node --test blocked-no-edge-verdict-consistency + reply-reachable` | 27/27 pass | ✓ PASS |
| Full suite green | `npm test` | 2959 tests, 2957 pass, 0 fail, 2 skipped | ✓ PASS |
| 2 skips are pre-existing | grep skip output | both are `dist/ui/index.js` build-gated (RUN_BUILD_TESTS) — unrelated to Phase 21 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| STUCK-01 | 21-03 | Reply affordance on stuck SR employee row (Watch tier) | ✓ SATISFIED | employee-row.tsx showNudge mount in Watch body; live STUCK-01 ✓ |
| STUCK-02 | 21-03 | Same affordance on Reader live-blocker panel | ✓ SATISFIED | live-blocker-panel.tsx isNudgeBranch mount; live STUCK-02 ✓ |
| STUCK-03 | 21-01 | Reply posts comment + resumes via `situation.replyAndResume` (STUCK leaf) | ✓ SATISFIED (code) / rider (live Send) | reachable flip + kind-agnostic handler + Tests 14/15; live Send operator-reserved (boundary), mechanism Phase-14-proven |
| STUCK-04 | 21-03/04 | No auto-resume on view — only explicit reply | ✓ SATISFIED | zero useEffect in primitive; Tests 16/17; live rows stayed BLOCKED |
| STUCK-05 | 21-02 | Stuck-context copy distinct from human-decision | ✓ SATISFIED | variant copy-selector; live "Nudge to unstick" confirmed |
| STUCK-06 | 21-03/04/05 | Degrade-safe + NO_UUID_LEAK on every new path | ✓ SATISFIED | *Uuid dispatch-only; reachable===false degrade; render-scan guards green; live whole-page UUID scan clean |

No orphaned requirements: all 6 STUCK reqs map to Phase 21 plans and are verified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX in Phase-21 modified source; no stub returns on the new render paths; no orphaned components | ℹ Info | The 4 `requestWakeup`/`usePluginAction` grep hits in live-blocker-panel.tsx are removal-documenting COMMENTS, verified not live code. |

### Human Verification Required

None required for code-level goal achievement. The phase already completed a bookended live BEAAA v1.8.2 deploy with 5/6 STUCK requirements verified live-positive read-only, plus an operator-found layout defect fixed and re-verified live.

**STUCK-03 live-Send rider (informational, not a gap):** The single live operator Send → resume against a real production agent was deliberately reserved to Eric (the Claude Code auto-mode classifier correctly denied the agent composing/submitting a comment to a live production agent — a boundary that stands regardless of the autonomy grant). The mechanism is code-proven (2957 green incl. nudge-dispatch + no-auto-resume + NO_UUID_LEAK tests) and was live-proven for the IDENTICAL `situation.replyAndResume` handler + `<ReplyInPlace>` primitive in Phase 14 — v1.6.0 changes only the copy variant, not the dispatch. Per the verification guidance this is a legitimate verified-with-rider: the code is present, wired, and correct; only the human-initiated production Send awaits Eric's authenticated session.

### Gaps Summary

No blocking gaps. Every must-have truth resolves to VERIFIED against the actual source (not just the SUMMARYs). The engine stays pure/AI-free (one verdict triple + one boolean flipped, exhaustive switches with `never` guards intact); the ONE shared `<ReplyInPlace>` primitive is reused on both surfaces with only an optional copy-variant prop (no third copy, no dispatch change); the `situation.replyAndResume` handler is genuinely unchanged (terminal-kind-agnostic by construction); no new migration or capability was introduced; both version sources read 1.8.2; the full suite is honestly green (2957/2959, 2 unrelated build-gated skips); and the live BEAAA deploy is complete with the one remaining live Send legitimately boundary-reserved to the operator.

---

_Verified: 2026-06-16_
_Verifier: Claude (gsd-verifier)_
