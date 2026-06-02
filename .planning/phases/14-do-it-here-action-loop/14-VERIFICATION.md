---
phase: 14-do-it-here-action-loop
verified: 2026-06-03T06:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live BEAAA reply-posts-and-resumes drill: operator types a reply on a Needs-you row on the live Situation Room, clicks Send, and verifies the toast + agent reply appear."
    expected: "Toast 'Replied to <party> · BEAAA-NN' appears; the awaited agent posts a new comment in the issue thread within one heartbeat cycle; the row leaves the Needs-you list after onActed refetches."
    why_human: "Cannot run the live Paperclip host locally. The mutation path (ctx.issues.createComment + optional ctx.issues.update) only resolves against the live BEAAA instance. No mock captures the end-to-end heartbeat-wake behavior."
  - test: "Live BEAAA quick-decision chip drill: on a row where the actionCard.decisionOptions is non-null (a binary blocker), tap the Approve or Reject chip and verify the canned sentence posts to the thread."
    expected: "Chip renders on the Situation Room row; tapping it dispatches 'Approved.' or 'Rejected.' as the reply body; the same toast + agent-resume path as the free-text reply applies."
    why_human: "Chips render conditionally on Phase-13 data that requires a live actionCard with decisionOptions populated — not reproducible locally."
---

# Phase 14: Do-It-Here Action Loop Verification Report

**Phase Goal:** Let the operator act in place — reply-in-place + quick-decision chips that post to the awaited agent and actually unblock+resume it, available across all three blocker surfaces, with an honest escape hatch for out-of-system humans.
**Verified:** 2026-06-03
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Operator reply posts as canonical issue_comments comment via ctx.issues.createComment then unblocks+resumes per Phase-10 recipe | VERIFIED | `situation-reply-and-resume.ts:106` — `ctx.issues.createComment(leafIssueUuid, body, companyId)`; dedup at line 90-98; Shape-B flip at lines 122-139; spike contract in `10-03-SPIKE-FINDINGS.md`. Test: Test 3+4 in handler test (28/28 pass). |
| SC2 | Quick-decision chips offered when decisionOptions is non-null; complete same unblock+resume path | VERIFIED | `reply-in-place.tsx:221` — `hasChips = Array.isArray(decisionOptions) && decisionOptions.length > 0`; chips dispatch `dispatchReply(cannedSentence(option))` (line 234); no separate handler. Employee-row passes `row.actionCard?.decisionOptions ?? null` (L404). Test: reply-in-place.test.mjs chips tests (13/13 pass). |
| SC3 | One shared `<ReplyInPlace>` imported by all three surfaces — no copies | VERIFIED | grep confirms all three import from same path: `employee-row.tsx:43` imports `../_shared/reply-in-place.tsx`; `live-blocker-panel.tsx:34` same; `blocked-backlog-expander.tsx:25` same. Test: SC3 import test passes on all three surface tests (38/38). |
| SC4 | Out-of-system rows surface named action + Open↗, no dead Send; isReplyReachable is pure verdict-driven (AWAITING_HUMAN only) | VERIFIED | `reply-reachable.ts:48-76` — exhaustive switch, AWAITING_HUMAN → true, all others → false, `never` guard. `reply-in-place.tsx:199-215` — `if (!reachable)` branch renders named-action + Open↗ only. Open↗ uses `/${companyPrefix}/issues/${leafIssueId}` (human key, line 203). Test: reply-reachable.test.mjs 11/11 pass; purity guard passes. |
| SC5 | UUIDs never rendered; mutation carries UUID, display uses human-readable | VERIFIED | `reply-in-place.tsx:134` — `const mutationIssueUuid = leafIssueUuid ?? leafIssueId;` dispatch-only const; never in JSX. Open↗ and toast use `leafIssueId` (human key). NO_UUID_LEAK render-scan tests: `reply-in-place-no-uuid-leak.test.mjs` 10/10 pass; `employee-row-no-uuid-leak.test.mjs` 5/5 pass. |

**Score:** 5/5 truths verified

### Spike Fidelity Check

| Claim | Evidence | Status |
|-------|----------|--------|
| Shape-B flip gated on REAL `needsDurabilityFlip` (leaf status==='blocked'), NOT terminal.kind | `situation-reply-and-resume.ts:85` — `needsDurabilityFlip = params?.needsDurabilityFlip === true`; handler docs explicitly say "NOT a terminal.kind proxy." Test 5 in handler suite verifies `terminal.kind` in params does NOT drive the flip. | VERIFIED |
| `needsDurabilityFlip` derived from real leaf status in rollup | `build-employees-rollup.ts:448` — `const needsDurabilityFlip = leafStatus === 'blocked'`; `leafStatus` from resolved `leaf.status ?? focusIssue.status`. Backlog handler at `org-blocked-backlog.ts:535` — same pattern. | VERIFIED |
| Shape-A comment-only (no flip) | `situation-reply-and-resume.ts:122` — flip is inside `if (needsDurabilityFlip)`. Test 3 verifies Shape-A → zero `ctx.issues.update` calls. | VERIFIED |

### Idempotency Check

| Check | Evidence | Status |
|-------|----------|--------|
| Dedup BEFORE mutation | `situation-reply-and-resume.ts:90` — `getReplyResumeByUuid` at step 1, before any `createComment`. | VERIFIED |
| Same messageUuid → exactly one comment | Test 6 in handler suite: second call with same UUID returns original `commentId` without re-posting. | VERIFIED |
| ON CONFLICT DO NOTHING | `migrations/0016_reply_resume_dedup.sql:55` and `reply-resume-repo.ts:81`. | VERIFIED |
| requestWakeup carries idempotencyKey:messageUuid | `situation-reply-and-resume.ts:162` — `idempotencyKey: messageUuid`. Test 9 verifies this. | VERIFIED |

### Engine Untouched Check

| Check | Evidence | Status |
|-------|----------|--------|
| classifyVerdict AWAITING_AGENT_STUCK → actionAffordance:'assign' (unchanged) | `blocker-chain.ts:70-73` — "Plan 12-01 D-05 — … the row offers 'assign'." No Phase 14 edits to this function. | VERIFIED |
| AI-token grep guard passes | `blocker-chain.test.mjs` — "PRIM-03 deterministic-graph-only — blocker-chain.ts source contains zero LLM/AI references" (21/21 pass). | VERIFIED |
| Determinism test passes | blocker-chain.test.mjs — "Determinism — same input produces same output bytes across 100 invocations" passes. | VERIFIED |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0016_reply_resume_dedup.sql` | Additive dedup table, plugin namespace only, no public.* DDL | VERIFIED | 60 lines; CREATE TABLE IF NOT EXISTS `plugin_clarity_pack_cdd6bda4bd.reply_resume_dedup`; no public.* refs; UNIQUE(company_id, message_uuid); COMMENT apostrophe-free. |
| `src/worker/db/reply-resume-repo.ts` | getReplyResumeByUuid + insertReplyResume | VERIFIED | 85 lines; both functions present; ON CONFLICT DO NOTHING; company-scoped. |
| `src/worker/handlers/situation-reply-and-resume.ts` | Handler: dedup-before-mutation; createComment; conditional flip; fire-and-forget wakeup; honest error | VERIFIED | 176 lines; all 5 steps documented and implemented. |
| `src/shared/reply-reachable.ts` | Pure isReplyReachable(terminalKind) — AWAITING_HUMAN only; exhaustive switch | VERIFIED | 77 lines; exhaustive switch; `never` guard on default. |
| `src/ui/surfaces/_shared/reply-in-place.tsx` | ONE shared primitive: free-text + Send + chips (decisionOptions) + Open↗ + await-confirm | VERIFIED | 268 lines; all four branches present; cannedSentence mapper; freshMessageUuid; pending state. |
| `src/worker.ts` registration | registerSituationReplyAndResume called next to registerSituationAssignOwner | VERIFIED | Lines 388-399 in worker.ts. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `worker.ts` | `situation.replyAndResume` | `registerSituationReplyAndResume(ctx)` | WIRED | worker.ts:399 |
| `employee-row.tsx` | `ReplyInPlace` | import `../_shared/reply-in-place.tsx` | WIRED | employee-row.tsx:43, used at line 399-412 |
| `live-blocker-panel.tsx` | `ReplyInPlace` | import `../_shared/reply-in-place.tsx` | WIRED | live-blocker-panel.tsx:34, used at lines 300-317 |
| `blocked-backlog-expander.tsx` | `ReplyInPlace` | import `../_shared/reply-in-place.tsx` | WIRED | blocked-backlog-expander.tsx:25, used at lines 104-117 |
| `reply-in-place.tsx` | `situation.replyAndResume` dispatch | `usePluginAction('situation.replyAndResume')` | WIRED | reply-in-place.tsx:122 |
| `build-employees-rollup.ts` | `needsDurabilityFlip` emitted | `leafStatus === 'blocked'` | WIRED | build-employees-rollup.ts:448 |
| `org-blocked-backlog.ts` | `needsDurabilityFlip` emitted | `leafStatus === 'blocked'` | WIRED | org-blocked-backlog.ts:535 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `reply-in-place.tsx` | `reachable` | Passed by surface via `isReplyReachable(terminalKind)` — terminalKind from worker rollup | Yes — derived from real engine terminal classification | FLOWING |
| `reply-in-place.tsx` | `needsDurabilityFlip` | Passed by surface from `chain.needsDurabilityFlip` / `row.needsDurabilityFlip` — set from real leaf.status | Yes — derived from real leaf issue status | FLOWING |
| `reply-in-place.tsx` | `decisionOptions` | SR: `row.actionCard?.decisionOptions` from Phase-13 worker; Reader: hardcoded null; Backlog: null | SR gets real Phase-13 data; others intentionally null this phase | FLOWING (SR) / STATIC null (Reader/Backlog — by design) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript type-check passes | `npx tsc --noEmit` | Clean exit, no output | PASS |
| Worker bundle builds | `node scripts/build-worker.mjs` | `dist/worker.js 2.5mb` in 268ms | PASS |
| UI bundle builds | `node scripts/build-ui.mjs` | `dist/ui/index.js 732.9kb` in 342ms | PASS |
| Handler + repo + reachable tests | `node --test test/worker/handlers/situation-reply-and-resume.test.mjs test/worker/db/reply-resume-repo.test.mjs test/shared/reply-reachable.test.mjs` | 28/28 pass | PASS |
| ReplyInPlace UI test | `node --test test/ui/surfaces/_shared/reply-in-place.test.mjs` | 13/13 pass | PASS |
| Three-surface mount tests | `node --test test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs test/ui/surfaces/reader/live-blocker-panel-reply-in-place.test.mjs test/ui/surfaces/situation-room/blocked-backlog-reply-in-place.test.mjs` | 38/38 pass | PASS |
| NO_UUID_LEAK render-scan | `node --test test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs` | 10/10 + 5/5 pass | PASS |
| blocker-chain determinism + AI guard | `node --test test/shared/blocker-chain.test.mjs` | 21/21 pass | PASS |
| Migration DDL validators | `node --test test/migrations/ddl-prefix-validator.test.mjs test/migrations/no-procedural-blocks.test.mjs` | 30/30 pass | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DO-01 | 14-01 | Operator reply posts as canonical comment + unblocks+resumes | SATISFIED | Handler at situation-reply-and-resume.ts; Test 3+4 pass |
| DO-02 | 14-01 / 14-02 | Quick-decision chips on clean binary | SATISFIED (code complete; REQUIREMENTS.md checkbox stale) | reply-in-place.tsx hasChips branch; employee-row passes decisionOptions; test chip-dispatch passes |
| DO-04 | 14-02 / 14-03 | Reply-in-place on SR + Reader panel + backlog | SATISFIED | All three surfaces import same primitive; 38 mount tests pass |
| DO-05 | 14-02 / 14-03 | Out-of-system → named action + Open↗, no dead Send | SATISFIED | isReplyReachable AWAITING_HUMAN-only; Open↗ branch in reply-in-place.tsx:199-215 |

**Note on DO-02 REQUIREMENTS.md checkbox:** `DO-02` is marked `[ ]` (unchecked) in `.planning/REQUIREMENTS.md` but the implementation is complete and tested. The checkbox is a stale tracking artifact from before Plan 14-02/14-03 landed the chips. Code evidence: `reply-in-place.tsx` lines 221-239, `employee-row.tsx` line 404, 13 chip-specific tests pass. This is a documentation gap, not a code gap.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `employee-row.tsx` | 133, 343 | Stale comment "NOT rendered as chips this phase (Phase 14)" — written during Phase 13, predates Phase 14 wiring | Info | No functional impact — chips ARE rendered via `<ReplyInPlace>` at line 404. Comment is a Phase-13 context note that was not updated. |

No TBD/FIXME/XXX/placeholder markers found in Phase 14 modified files.

### Human Verification Required

### 1. Live BEAAA End-to-End Reply-Posts-and-Resumes Drill

**Test:** On the live BEAAA Situation Room, find a Needs-you row with an AWAITING_HUMAN blocker. Type a reply in the reply-in-place input and click Send.
**Expected:** Toast "Replied to \<party\> · BEAAA-NN" appears. The awaited agent posts a new comment in the issue thread within one heartbeat cycle (proving Shape A / Shape B native wake per the Phase-10 spike). The row leaves the Needs-you list after the onActed callback triggers a snapshot refetch.
**Why human:** The mutation path (`ctx.issues.createComment` + optional `ctx.issues.update`) only resolves against the live BEAAA host. No local mock captures the end-to-end heartbeat-wake behavior the Phase-10 spike proved.

### 2. Live BEAAA Quick-Decision Chip Drill (DO-02 End-to-End)

**Test:** On the live BEAAA Situation Room, find a row with a binary blocker (actionCard.decisionOptions non-null). Verify chips render. Tap Approve or Reject.
**Expected:** Chip renders inline on the row. Tapping it dispatches "Approved." or "Rejected." as the reply body via the same situation.replyAndResume path; the same toast + agent-resume path as free-text reply applies.
**Why human:** Chips render conditionally on live Phase-13 data (`actionCard.decisionOptions` populated by the Editor-Agent). Cannot reproduce locally without a live instance running the Editor-Agent compilation.

---

### Gaps Summary

No gaps. All 5 success criteria are VERIFIED in source code, tests, and builds. The REQUIREMENTS.md `DO-02` checkbox is a stale tracking artifact (chips are implemented and tested). The two pre-existing failures in `test/phases/04.1-traceability.test.mjs` (CTT-01..CTT-08 REQUIREMENTS.md rows) predate Phase 14 (committed 2026-05-21 in phase 4.1, git commit b705e39) and are explicitly out of scope per the verification brief.

**Phase 14 Plan 14-01 SUMMARY.md is absent** (ROADMAP marks plan 14-01 as `[ ]`). All 14-01 artifacts exist and all 14-01 tests pass; the plan was executed without filing a SUMMARY. This is a documentation-only gap, not a code gap, and does not block the phase goal.

The live BEAAA reply-posts-and-resumes drill is a **separate deploy-time gate** — the phase is not failed for the absence of a local live run (there is no live Paperclip model locally, per the verification brief).

---

*Verified: 2026-06-03*
*Verifier: Claude (gsd-verifier)*
