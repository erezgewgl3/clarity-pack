---
phase: 17-structured-human-wait-truthful-verdicts-centerpiece
plan: 03
subsystem: structured-human-wait
tags: [wait-01, wait-02, editor-agent, producer, high-precision, d-03, d-04, d-05, d-06, op-issue-delivery, no-storm, phase-16.1-governance]
requires:
  - "17-01 contracts: upsertClarityHumanWait / deleteClarityHumanWait / listClarityHumanWaitsForCompany (clarity-human-wait-repo.ts)"
  - "17-01: resolveFounderUserId(ctx, companyId) (founder-resolution.ts) — null = degrade-safe skip"
  - "Existing op-issue delivery: startAgentTask / pollAgentTaskResult + isResultComment (agent-task-delivery.ts)"
  - "Existing voice/parse helpers: polishTldr + tldrContentHash (compile-tldr.ts), extractJsonObject (bulletin/compile-pass-1.ts)"
  - "Phase 16.1 governance wrapping handleEditorHeartbeat: wake-governor + opt-in gate + self-loop filter + isOwnOperationIssue guard"
provides:
  - "detectAndPersistHumanWait(ctx, { agentId, companyId, issueId, issue, comments }) — the producer (human-wait-detect.ts)"
  - "buildHumanWaitDetectionPrompt / parseHumanWaitDetection / voiceOneLiner — testable detection sub-steps"
  - "human-wait-detect added to the OperationKind union + an isResultComment readback branch (agent-task-delivery.ts)"
  - "the sibling detection call in handleEditorHeartbeat's per-issue loop (editor.ts) — writes the rows 17-02's three merge sites consume"
affects:
  - src/worker/agents/human-wait-detect.ts (NEW — prompt + delivery + parse + upsert/delete)
  - src/worker/agents/editor.ts (one sibling call in the heartbeat loop + the import)
  - src/worker/agents/agent-task-delivery.ts (OperationKind union member + readback branch — Rule 3 enabling change)
  - "downstream 17-05 (full cross-surface matrix) verifies the verdict the populated rows now produce end-to-end"
tech-stack:
  added: []
  patterns:
    - "producer/consumer split: the ONLY AI in the structured-wait path; the engine (17-01) stays pure (SC4)"
    - "op-issue LLM delivery reuse — new operationKind in the existing plugin:clarity-pack:operation:* namespace (auto-excluded by isOwnOperationIssue)"
    - "new operationKind MUST get an isResultComment branch (GOTCHA 1) or the readback hangs on the BulletinDraft validator"
    - "content_hash idempotency short-circuit (mirrors prepareTldrCompile cache-hit) — unchanged inputs = no-op, no LLM call"
    - "D-04 self-clear: deleteClarityHumanWait on non-blocked status OR negative/ambiguous detection (one live row per issue)"
    - "D-03 high-precision default-false-on-ambiguity defensive parse; D-05 polishTldr + truncate <=80 before persist"
    - "degrade-safe: not-ready poll / null founder / Editor down -> no row written -> conservative engine floor"
    - "no-storm: sibling rides the existing heartbeat pull + Phase-16.1 governance; NO new wake path / schedule / subscription"
key-files:
  created:
    - src/worker/agents/human-wait-detect.ts
  modified:
    - src/worker/agents/editor.ts
    - src/worker/agents/agent-task-delivery.ts
decisions:
  - "D-03 high precision: prompt fires isHumanWait only when a decision is clearly addressed to a specific person; parse defaults to false on ANY ambiguity/parse-failure"
  - "D-04 self-clear: delete on non-blocked status (precondition, before any LLM call) AND on negative detection; one live row per (company, issue)"
  - "Idempotency: skip the LLM op-issue handoff when the persisted row's content_hash already matches the current comment-input set"
  - "GOTCHA 1 (carried from action-cards): a new OperationKind without its own isResultComment branch falls through to the BulletinDraft validator and the poll hangs forever — added the branch"
  - "human-wait content_hash uses scopeId `human-wait-${issueId}` to keep its hash namespace distinct from the issue TL;DR hash over the same inputs"
metrics:
  duration: ~35m
  tasks_completed: 2
  files_created: 1
  files_modified: 2
  tests_passing: 57
  completed: 2026-06-11
---

# Phase 17 Plan 03: Structured human-wait producer (Editor-Agent detect + upsert/self-clear) Summary

Built the PRODUCER half of the structured-human-wait split: the Editor-Agent now reads the comments it already fetches per issue, runs a HIGH-PRECISION "blocked on a human decision" detection through the existing op-issue LLM delivery layer, and upserts (or self-clears) the `clarity_human_waits` row that 17-02's three SC5 merge sites consume — all riding the existing Phase-16.1 heartbeat governance with NO new wake path. This is the only AI in the structured-wait path; the engine (17-01) stays pure. With this plan, a real human decision now surfaces as a founder-owned needs-you instead of being parked in Watch — the live half of the BEAAA-972 deep fix.

## What Was Built

### Task 1 — human-wait-detect.ts: detect, voice, upsert/self-clear (commit d8ab989)
- `src/worker/agents/human-wait-detect.ts` (NEW): `detectAndPersistHumanWait(ctx, { agentId, companyId, issueId, issue, comments })`, plus three exported, individually-testable sub-steps:
  - `buildHumanWaitDetectionPrompt(body, comments)` — the HIGH-PRECISION prompt (D-03). Sets `isHumanWait` true ONLY when a concrete decision/question is clearly addressed to a SPECIFIC person, the wait is open, and it is not an agent-to-agent handoff; defaults false on ambiguity. Returns strict JSON `{ isHumanWait, decisionOneLiner }`.
  - `parseHumanWaitDetection(raw)` — defensive parse via `extractJsonObject`. ANY parse failure, non-object, or `isHumanWait !== true` collapses to a NEGATIVE result (the degrade-safe, high-precision default). Never throws.
  - `voiceOneLiner(oneLiner)` — `polishTldr` then truncate `<=80` chars with `…` (the `build-employees-rollup.ts:384-389` usage model) — D-05 voice parity by construction.
- Flow of `detectAndPersistHumanWait`:
  1. **Self-clear precondition (D-04):** issue not `blocked` → `deleteClarityHumanWait` + return (before any LLM call).
  2. **Idempotency short-circuit:** `tldrContentHash` over `{ body, comments }` (scopeId `human-wait-${issueId}`); if the persisted row's `content_hash` matches, return (no LLM call) — mirrors the `prepareTldrCompile` cache-hit.
  3. **Op-issue delivery:** `startAgentTask` with the NEW `operationKind: 'human-wait-detect'` (operationId `human-wait-${issueId}`) + `pollAgentTaskResult`. A not-ready poll returns without writing (the drainer / next heartbeat re-evaluates).
  4. **Negative/ambiguous** → `deleteClarityHumanWait` (self-clear) + return.
  5. **Positive** → `resolveFounderUserId`; null → SKIP the write (degrade-safe); else voice the one-liner and `upsertClarityHumanWait` with the founder owner, content_hash, `generated_at` now-ISO, and `compiled_by_agent_id`.
- `src/worker/agents/agent-task-delivery.ts` (Rule 3 enabling change): added `'human-wait-detect'` to the `OperationKind` union, and an `isResultComment` branch that accepts a sane-sized JSON object body — mirroring the `bulletin-gloss` / `action-cards` branches. **Without this branch the readback would fall through to the `bulletin-compile` BulletinDraft validator and hang forever (`status:'pending'`)** — the GOTCHA 1 trap documented in-repo for action-cards.

### Task 2 — sibling call in the heartbeat loop (commit faae261)
- `src/worker/agents/editor.ts`: imported `detectAndPersistHumanWait` and added ONE sibling call in `handleEditorHeartbeat`'s per-issue loop, AFTER the TL;DR compile block, reusing the SAME `comments` already fetched (no second `listComments`). It is the LAST statement in the per-issue `try`, so a detection throw is caught by the existing per-issue `catch` and logged WITHOUT aborting the loop or undoing the already-completed TL;DR compile.
- **No-storm:** the change adds NO `requestWakeup`, `jobs.schedule`, `events.subscribe`, or `setInterval`. Detection rides the existing heartbeat pull + wake-governor + opt-in gate + self-loop filter (Phase 16.1). The `isOwnOperationIssue` guard already covers the new `human-wait-detect` op kind (same `plugin:clarity-pack:operation:*` namespace) — no recursion.

## Verification Results
- `npx tsc --noEmit` clean across the whole project after each task. (The plan's `node --check src/...ts` is unusable on Node 24, which does not type-strip under `--check`; `tsc --noEmit` is the project's `typecheck` and the correct stronger equivalent — same substitution 17-02 documented.)
- Task 1 greps: `detectAndPersistHumanWait`, `deleteClarityHumanWait`, `polishTldr`, `extractJsonObject`, `resolveFounderUserId`, and `operationKind: 'human-wait-detect'` all present in `human-wait-detect.ts`.
- Task 1 name-literal guard: `grep -niE 'prepareForName|companyPrefix|BEAAA|Eric' human-wait-detect.ts` → CLEAN (after rewording two `gen-eric` substring false positives, the same trap 17-01 hit).
- Task 2 greps: `detectAndPersistHumanWait` present in `editor.ts`; the diff adds NO `listComments(` call and NO new wake path / subscription / timer (verified against `git diff` of the additions only — the pre-existing `requestWakeup`/`jobs.schedule` matches are all comments/types).
- Tests: `agent-task-delivery.test.mjs` + `editor-heartbeat-recursion.test.mjs` + `bounded-warm.test.mjs` → 31/31 (the recursion guard + W-3 no-wake assertions green). Combined with the 17-01 engine verdict test + the shared blocker-chain determinism/AI-token-purity guards + the parity test → 57/57 pass. `blocker-chain.ts` is untouched here; its purity guards stay green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] New `OperationKind` member + readback branch in agent-task-delivery.ts (outside `files_modified`)**
- **Found during:** Task 1 (the `startAgentTask` call requires `'human-wait-detect'` to be a member of the closed `OperationKind` union, and the readback requires a matching `isResultComment` branch).
- **Issue:** `OperationKind` is a closed union; the plan's `operationKind: 'human-wait-detect'` would not type-check without adding the member. More critically, an unknown operationKind falls through `isResultComment` to the `bulletin-compile` BulletinDraft validator, which throws on a non-draft body → `pollAgentTaskResult` never returns `'ready'` → the readback HANGS forever (the exact GOTCHA 1 trap the in-repo action-cards comment warns about).
- **Fix:** Added `'human-wait-detect'` to the union and an `isResultComment` branch that accepts any sane-sized JSON object body (mirrors `bulletin-gloss` / `action-cards`). `detectAndPersistHumanWait` re-parses defensively, so a garbage body simply reads as a negative detection (self-clear).
- **Files modified:** `src/worker/agents/agent-task-delivery.ts`
- **Commit:** d8ab989 (committed with Task 1 — it is the enabling prerequisite for the new op kind).

**2. [Rule 1 — Bug] `gen-eric` substring false positive in the name-literal acceptance grep**
- **Found during:** Task 1 verification.
- **Issue:** The plan's `grep -niE '...|Eric'` is case-insensitive and unbounded; the prompt/comment words "generic"/"Voice-parity ... a generic phrase" matched on the `eric` substring, falsely flagging an operator-name literal where none existed.
- **Fix:** Reworded "generic" → "vague" / "plain" in the two flagged spots. No code-path change. Same precedent 17-01 recorded.
- **Files modified:** `src/worker/agents/human-wait-detect.ts`
- **Commit:** d8ab989

**3. [Method substitution] `node --check` → `tsc --noEmit`**
- The plan's `<automated>` verify uses `node --check src/...ts`, unusable on Node 24 (no type-strip under `--check`). Used `npx tsc --noEmit` (the project `typecheck`) + `node --test` for the suite, exactly as 17-02 documented. All acceptance greps run verbatim. No code-path change.

Otherwise: plan executed as written. No architectural changes (Rule 4), no auth gates, no checkpoints (fully autonomous plan).

## Threat Model Compliance
- **T-17-07 (Spoofing — prose-injection fabricating a needs-you):** mitigated — HIGH-PRECISION detection (D-03) defaults false on ambiguity; the row self-clears each compile when the wait no longer holds; the Editor's existing Phase-16.1 governance caps bound abuse.
- **T-17-08 (Tampering — one-liner into clarity_human_waits):** mitigated — persistence uses the 17-01 parameterized repo ($N binds, `text[]` via cast); no string interpolation of comment content into SQL. The one-liner is additionally passed through `polishTldr` + truncate before persist.
- **T-17-09 (EoP/DoS — new detection wake path):** mitigated — NO new wake path / schedule / subscription; detection rides the existing wake-governor + opt-in gate + self-loop filter (verified by the Task 2 grep gate and the green W-3 no-wake + recursion-guard tests).
- **T-17-10 (Info disclosure — founder resolution):** mitigated — `resolveFounderUserId` reads only `WHERE company_id=$1` owners (17-01); null → skip. No cross-company leak.
- **T-17-SC (installs):** N/A — zero packages installed this plan; detection is hand-written per 17-RESEARCH's Don't-Hand-Roll guidance.

## Known Stubs
None. `detectAndPersistHumanWait` is fully wired into the live heartbeat and writes/clears real rows. The idempotency short-circuit issues a per-issue `listClarityHumanWaitsForCompany` read; this is correct but slightly redundant with the SR prefetch's company-scoped read — a future optimization could pass the prefetched `waitMap` into the populator. Not a stub: the per-issue read is bounded and degrade-safe, and the producer must work on the Reader/heartbeat path independent of the SR prefetch.

## Notes for Downstream Plans
- **17-05 (full cross-surface matrix):** the rows this populator writes are what make the `structured-human-wait → AWAITING_HUMAN` matrix case assertable end-to-end (prose → row → engine verdict). The matrix test itself can stay synthetic (inject a row directly), but a live drill in 17-06 should confirm a real blocked-issue comment produces a founder-owned needs-you and self-clears when the human replies.
- **17-06 (deploy + drill):** the high-precision prompt wording is this module's discretion (D-03). The first live drill is the right place to tune precision if a false positive appears on BEAAA — adjust `buildHumanWaitDetectionPrompt`, not the engine.
- **GOTCHA carried forward:** any FUTURE new `OperationKind` MUST get its own `isResultComment` branch or its readback hangs on the BulletinDraft validator. This is now true for `human-wait-detect` as well as `action-cards` / `bulletin-gloss`.
- The content_hash uses scopeId `human-wait-${issueId}` (distinct from the TL;DR hash over the same inputs) so the two idempotency namespaces never collide.

## Self-Check: PASSED
- src/worker/agents/human-wait-detect.ts — FOUND
- src/worker/agents/editor.ts (modified) — FOUND
- src/worker/agents/agent-task-delivery.ts (modified) — FOUND
- Commit d8ab989 — FOUND
- Commit faae261 — FOUND
