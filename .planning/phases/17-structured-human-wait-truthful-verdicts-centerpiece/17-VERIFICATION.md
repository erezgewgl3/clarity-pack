---
phase: 17-structured-human-wait-truthful-verdicts-centerpiece
verified: 2026-06-11T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live-positive structured-wait demonstration on BEAAA: a real blocked-on-human issue reads needs-you consistently across all four surfaces (Reader, Situation Room, Bulletin, Chat), and self-clears when the human replies."
    expected: "From Eric's opted-in browser session, an issue genuinely blocked on his decision shows AWAITING_HUMAN (needs-you) on every surface with the polished decision one-liner, and the breadcrumb (D-12 link) + ref-card (D-13 plain-word status) render correctly; replying clears the row on the next compile."
    why_human: "Requires (a) a current real awaiting-decision issue on the live org (the canonical BEAAA-972 has moved out of blocked-awaiting state), (b) an opted-in operator session (per-user opt-in gate, coexistence guarantee #1; editor.pause-status returns OPT_IN_REQUIRED for the pseudo-user), and (c) a 16.1-governed Editor-Agent wake. Code-proven by the 17-05 4x8 SC5 matrix (16/16) but the live prose→row→verdict→render end-to-end cannot be exercised by the synthetic suite or by a headless probe."
---

# Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE) Verification Report

**Phase Goal:** Give agents a structured, machine-readable way to declare "blocked on a human decision X" so the deterministic engine honestly classifies it as AWAITING_HUMAN (needs-you) instead of conservatively parking it in Watch — the deep fix behind the BEAAA-972 confusion — and prove every blocked-no-edge class is classified truthfully across a full surface × terminal-kind matrix.

**Verified:** 2026-06-11
**Status:** human_needed (all four requirements code-delivered and verified; one live-positive observation rider deferred by environmental constraint, not a code gap)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to WAIT-01..04 / ROADMAP SC1-SC4)

| # | Requirement / Truth | Status | Evidence |
|---|---------------------|--------|----------|
| 1 | **WAIT-01 / SC1** — Agent declares a human-wait through a STRUCTURED, machine-readable signal, captured additively in the plugin namespace | ✓ VERIFIED | `migrations/0018_structured_human_wait.sql:49-60` creates `plugin_clarity_pack_cdd6bda4bd.clarity_human_waits` (additive, inline `UNIQUE(company_id, issue_id)`, DDL-only, no `public.`). Repo `src/worker/db/clarity-human-wait-repo.ts:66-130` provides parameterized `upsertClarityHumanWait` (`ON CONFLICT (company_id, issue_id) DO UPDATE`), `listClarityHumanWaitsForCompany` (`WHERE company_id=$1`), `deleteClarityHumanWait`. Producer `src/worker/agents/human-wait-detect.ts:205-292` detects + upserts the structured row; wired into the Editor heartbeat at `src/worker/agents/editor.ts:348`. Op-delivery readback branch present `src/worker/agents/agent-task-delivery.ts:121,295-306` (prevents the documented hang). |
| 2 | **WAIT-02 / SC2** — Deterministic engine classifies a structured human-wait as AWAITING_HUMAN (needs-you), not parked in Watch | ✓ VERIFIED | `src/shared/blocker-chain.ts:321-330` — priority-0 leaf branch: `if (meta?.structuredWaitOwnerUserId != null)` emits `AWAITING_HUMAN` BEFORE the native `status==='awaiting'` branch (line 334) and BEFORE the agent-ownership branch (line 356). nodeMeta fields declared at `blocker-chain.ts:44,47`. Reuses existing `AWAITING_HUMAN` kind (D-08, no 9th kind). Test `test/worker/structured-human-wait-verdict.test.mjs` D-08 case proves `needsYou:true` / reply affordance with no `classifyVerdict` change. |
| 3 | **WAIT-03 / SC3** — Every blocked-no-edge class classifies truthfully: blocked+agent-owned, blocked+human-owned, blocked+unowned, structured-human-wait | ✓ VERIFIED | Engine leaf cascade `blocker-chain.ts:321-386`: structured-wait→AWAITING_HUMAN (321), native human-owned→AWAITING_HUMAN (334/344), agent-owned→AWAITING_AGENT_WORKING/STUCK (356), unowned→UNOWNED (382). `test/worker/blocked-no-edge-verdict-consistency.test.mjs` 4 MATRIX cases incl. "D-07 structured wait wins over a present agent assignee" and "wins over native status===awaiting + ownerUserId" — both PASS. |
| 4 | **WAIT-04 / SC4** — SC5 guard extended into a FULL surface × terminal-kind matrix (one consistent verdict); blocker-chain.ts stays pure (determinism + AI-token guards pass) | ✓ VERIFIED | `test/worker/blocked-no-edge-verdict-consistency.test.mjs` — full 4 surfaces (reader/sr/bulletin/chat) × 8 terminal kinds matrix, all cells assert one consistent verdict (8/8 SC5 matrix tests PASS). Three-site merge via the single shared `applyStructuredWait` helper (Reader `flatten-blocker-chain.ts:411`, SR rollup `build-employees-rollup.ts:467`, SR backlog `org-blocked-backlog.ts:470`); waitMap built once per company `situation-room.ts:356-367` (degrade-safe to empty). Purity: `grep -i 'openai\|anthropic\|claude_local\|llm\|gpt\|completion'` on `blocker-chain.ts` → NONE; determinism guard (100-run JSON.stringify equality) + AI-token grep guard in `test/shared/blocker-chain.test.mjs` → 21/21 PASS. |

**Score:** 4/4 truths verified (WAIT-01..04)

### Operator-seeded Reader fold-ins (in-scope, not a separate requirement)

| Item | Status | Evidence |
|------|--------|----------|
| D-11 breadcrumb — drop the mission-paragraph goal segment | ✓ VERIFIED | `src/worker/handlers/issue-reader.ts:88-101` (`ANCESTRY_LABEL_MAX=80`, `isMissionDumpTitle`, `shortLabel`); `:448-461` drops the goal segment entirely when title is a mission dump (leaves `ancestry.milestone` null), short-labels otherwise. Instance-agnostic (no prefix literal in worker). |
| D-12 breadcrumb — link-only-routable, prefix in UI, zero 404 | ✓ VERIFIED | `issue-reader.ts:403-430` emits `routable:true` only for the issue/parent segment (prefix-less identifier), `routable:false` for project/goal. `src/ui/surfaces/reader/breadcrumb.tsx:53-67` branches `<a>` (linkable) vs plain `<span>`, prepends `/<companyPrefix>/issues/` via `extractCompanyPrefixFromPathname` + `useHostNavigation().linkProps` (no raw `<a href>`). |
| D-13 ref-card — lead plain-English, demote machine codes, plain-word status | ✓ VERIFIED | `src/ui/surfaces/reader/ref-card.tsx:33` `statusToWords` replaces the `Stuck`/`Standby` code-chip vocabulary; `:91` `data-ref-id` retained (recoverable); `:96` id demoted to recessed mono tag; title leads. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0018_structured_human_wait.sql` | Additive plugin-namespace table | ✓ VERIFIED | Substantive (60 lines), correct namespace, inline UNIQUE, packaged via `package.json files:[migrations/]` |
| `src/worker/db/clarity-human-wait-repo.ts` | upsert/list/delete repo | ✓ VERIFIED | 130 lines, parameterized binds, company-scoped, wired into producer + prefetch |
| `src/shared/blocker-chain.ts` | nodeMeta fields + priority-0 branch | ✓ VERIFIED | Fields lines 44/47, branch 321-330; pure (no AI tokens) |
| `src/worker/situation/founder-resolution.ts` | instance-agnostic founder resolver | ✓ VERIFIED | `resolveFounderUserId` reuses `listClarityAgentOwnersForCompany`, deterministic tie-break, null degrade-safe, no name/prefix literals |
| `src/worker/situation/apply-structured-wait.ts` | single SC5 merge primitive | ✓ VERIFIED | Pure helper; consumed identically at all 3 sites (grep confirms 1 def + 3 call sites, no inline dup) |
| `src/worker/agents/human-wait-detect.ts` | high-precision producer | ✓ VERIFIED | 292 lines; prompt, defensive parse, voiceOneLiner, upsert/self-clear, degrade-safe; D-03/D-04/D-05/D-06 |
| `src/worker/agents/editor.ts` | sibling call in heartbeat loop | ✓ VERIFIED | `detectAndPersistHumanWait` imported (59) + called (348), no new wake path |
| `src/ui/surfaces/reader/breadcrumb.tsx` | conditional link vs plain | ✓ VERIFIED | Substantive branch, instance-agnostic prefix |
| `src/ui/surfaces/reader/ref-card.tsx` | title-first, plain-word status | ✓ VERIFIED | statusToWords + demoted id |
| `test/worker/blocked-no-edge-verdict-consistency.test.mjs` | 4×8 matrix + D-07 wins | ✓ VERIFIED | 16/16 pass incl. structured-wait-wins-over-agent on both Reader + SR paths |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `blocker-chain.ts` leaf cascade | `nodeMeta.structuredWaitOwnerUserId` | priority-0 branch before status==='awaiting' | ✓ WIRED (line 321, ranks above native awaiting + agent) |
| `clarity-human-wait-repo.ts` | `plugin_clarity_pack_cdd6bda4bd.clarity_human_waits` | `ON CONFLICT (company_id, issue_id) DO UPDATE` | ✓ WIRED |
| `human-wait-detect.ts` (producer) | `clarity_human_waits` row | upsert/delete in heartbeat sibling | ✓ WIRED (editor.ts:348) |
| `situation-room.ts` prefetch | both SR builders' ctx.waitMap | `buildSnapshotPrefetch` → sharedPrefetch spread | ✓ WIRED (line 517) |
| Reader / SR-rollup / SR-backlog | `nodeMeta[rootId]` | single `applyStructuredWait` helper | ✓ WIRED (3 call sites, 1 def — SC5 by construction) |
| `agent-task-delivery.ts` | human-wait readback | `isResultComment` branch for `'human-wait-detect'` | ✓ WIRED (line 295, prevents hang) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Engine classifies structured wait as AWAITING_HUMAN, wins over agent | `node --test structured-human-wait-verdict.test.mjs` | 7/7 pass | ✓ PASS |
| Full 4×8 SC5 matrix one consistent verdict + D-07 wins | `node --test blocked-no-edge-verdict-consistency.test.mjs` | 16/16 pass | ✓ PASS |
| Engine determinism (100-run) + AI-token purity guard | `node --test test/shared/blocker-chain.test.mjs` | 21/21 pass | ✓ PASS |
| Two nodeMeta shapes stay equal (parity, anti-divergence) | `node --test flatten-blocker-chain-parity.test.mjs` | 4/4 pass | ✓ PASS |
| Version bump in BOTH sources (two-source rule) | grep package.json + src/manifest.ts | both 1.6.0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WAIT-01 | 17-01, 17-03 | Structured machine-readable human-wait signal, additive capture | ✓ SATISFIED | migration 0018 + repo + producer |
| WAIT-02 | 17-01, 17-02, 17-04 | Engine classifies structured wait as AWAITING_HUMAN | ✓ SATISFIED | blocker-chain.ts:321 priority-0 branch + 3-site merge |
| WAIT-03 | 17-01, 17-05 | All four blocked-no-edge classes truthful | ✓ SATISFIED | leaf cascade + matrix tests |
| WAIT-04 | 17-05 | SC5 full surface × terminal-kind matrix | ✓ SATISFIED | 4×8 matrix test, engine purity green |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No debt markers (TBD/FIXME/XXX) introduced; no stub returns; no hollow props | — | All Known-Stubs sections report None; producer/consumer empty-waitMap is intentional degrade-safe floor, not a stub |

### Pre-existing test failures (NOT attributed to Phase 17)

The full suite reports **2720 pass / 7 fail**. The 7 failures are in `test/phases/04-traceability.test.mjs` and `test/phases/04.1-traceability.test.mjs`, asserting legacy `CHAT-*` / `CTT-*` requirement rows.

Verified pre-existing and NOT a Phase 17 regression:
- `grep -c 'CHAT-0\|CTT-0' .planning/REQUIREMENTS.md` → **0** at HEAD.
- `git show d420706:.planning/REQUIREMENTS.md | grep -c 'CHAT-0\|CTT-0'` → **0** at the pre-phase commit. Identical failure both before and after Phase 17.
- `git log d420706..HEAD -- test/phases/04-traceability.test.mjs test/phases/04.1-traceability.test.mjs` → **no commits** (Phase 17 did not touch these test files).
- These are explicitly assigned to **Phase 20, HYG-02** in REQUIREMENTS.md ("re-point the test at the archive or formally accept") — a deferred, planned item, not a Phase 17 gap.

### Human Verification Required

**1. Live-positive structured-wait demonstration (deferred rider)**

- **Test:** From Eric's opted-in BEAAA browser session, point at a current issue genuinely blocked on his decision (or authorize seeding one). Confirm the issue reads needs-you on Reader / Situation Room / Bulletin / Chat with the polished decision one-liner, that the breadcrumb (D-12 routable link) and ref-card (D-13 plain-word status) render, and that replying clears the row on the next Editor-Agent compile.
- **Expected:** Consistent AWAITING_HUMAN across all four surfaces; self-clear on reply.
- **Why human:** Gated on (a) a live awaiting-decision issue (the historical BEAAA-972 has moved out of blocked-awaiting state), (b) a per-user opt-in session (coexistence guarantee #1; `editor.pause-status` returns OPT_IN_REQUIRED for the pseudo-user), and (c) a 16.1-governed Editor-Agent wake. The 17-06 live drill verified the other four checks live (no-storm PASS, no-false-positive PASS, Reader fold-ins worker-side PASS, engine+SC5 snapshot consistent). The positive path is code-proven by the 17-05 4×8 matrix (16/16) but the prose→row→verdict→render end-to-end is not observable without these three live conditions.

### Gaps Summary

No code gaps. All four requirements (WAIT-01..04) and both operator-seeded Reader fold-ins (D-11/D-12/D-13) are delivered, substantive, and wired in the codebase, with green targeted suites and a green full suite except the 7 pre-existing CHAT/CTT traceability failures (confirmed pre-existing at d420706, untouched by Phase 17, owned by Phase 20 HYG-02).

The centerpiece — a structured "blocked on a human decision" signal that reads needs-you consistently across all four surfaces by construction (single shared `applyStructuredWait` helper fed by one per-company waitMap, anti-regressed by the 4×8 SC5 matrix) — is the deep, durable BEAAA-972 fix and is fully present in code. The producer (high-precision Editor-Agent detection, degrade-safe), the consumer (pure priority-0 engine branch reusing AWAITING_HUMAN), and the founder-owner resolution (D-06 single-operator, instance-agnostic) are all real.

The only outstanding item is the **live-positive observation rider** — surfaced as a human-verification item per the verifier decision tree because it cannot be observed programmatically (live awaiting-decision issue + opt-in session + governed wake). It is a deferred verification observation, not a failure: v1.6.0 is live on BEAAA (`status=ready`, migration 0018 accepted) and the live drill PASSed no-storm / no-false-positive / Reader-foldins(worker) / engine+SC5-snapshot.

**Overall verdict:** verified-with-rider. All WAIT-01..04 are code-delivered and verified (4/4). One human-verification rider (live-positive demo) remains, which sets the reportable status to `human_needed`.

---

_Verified: 2026-06-11_
_Verifier: Claude (gsd-verifier)_
