# Phase 20: Hygiene & honestly-green CI - Context

**Gathered:** 2026-06-15 (auto-defaults — hygiene phase, no design gray areas)
**Status:** Ready for planning

<domain>
## Phase Boundary

Make CI honestly green and the deploy bookend confirmed — the SC5 full surface × terminal-kind
matrix runs in CI, the known test-debt (the chat-watchdog timing flake + the env-dependent
safety-CLI harness failures + the Phase-17 snapshot-prefetch count drift) is resolved, the stale
version label is refreshed, and automated DO backups are confirmed ON as the continuous-deploy
bookend prerequisite. This is the milestone's closing hygiene phase.

In scope: HYG-01 (SC5 matrix in CI), HYG-03 (chat-watchdog flake), HYG-04 (version label + DO
backup confirmation), and the test-debt surfaced during Phases 17/19 that keeps the full sweep
from being honestly green. Out of scope: any new feature behavior; the deterministic engine
(blocker-chain.ts) stays untouched; Phase 19's live ON-flip (that is Phase 19's own deferred step).
</domain>

<decisions>
## Implementation Decisions

### Already-satisfied requirements (do NOT redo)
- **D-01:** HYG-02 is ALREADY COMPLETE (REQUIREMENTS.md marks it `[x]`, 2026-06-15): the 7
  CHAT/CTT traceability failures were resolved by re-pointing `test/phases/04-traceability.test.mjs`
  + `04.1-traceability.test.mjs` at `.planning/milestones/v1.0.0-REQUIREMENTS.md` (9/9 green). The
  plan must NOT re-touch this; just cite it as satisfied in verification.
- **D-02:** HYG-04's version-label arm is ALREADY SATISFIED by construction — Phase 19 bumped both
  sources to v1.8.0. The remaining HYG-04 work is ONLY the automated-DO-backup confirmation (an
  operator-gated live check), which is BATCHED into the single end-of-milestone operator window
  alongside Phase 19's live deploy. The plan captures it as an autonomous:false checkpoint, NOT a
  blocker on the autonomous CI work.

### HYG-01 — SC5 full-matrix in CI
- **D-03:** Add the SC5 full surface × terminal-kind matrix (the 4 surfaces × 8 terminal kinds
  table-driven coverage from Phase 17's `test/worker/blocked-no-edge-verdict-consistency.test.mjs`)
  to the CI test run so the one-verdict-everywhere guarantee is continuously enforced, not just
  asserted once. Confirm the existing matrix test is included in the CI glob; if CI uses a narrower
  glob, widen it or add the file explicitly. Honest-green means the matrix actually executes in CI.

### HYG-03 — chat-watchdog flake
- **D-04:** Stabilize the `U7 WATCHDOG-FIRE-AND-FORGET` chat-watchdog timing flake in
  `test/worker/chat/topic-watchdog.test.mjs` to be CONDITION-BASED (poll/await the observable
  state transition), NOT a wall-clock sleep threshold. The flake is load-dependent; the fix removes
  the timing dependency so it passes deterministically under CI load.

### Test-debt surfaced during Phases 17/19 (blocks honest-green CI)
- **D-05:** The Phase-17 `snapshot-prefetch` count drift (`test/worker/situation/snapshot-prefetch.test.mjs`
  — asserts "exactly TWO db.query calls", builder now issues 3) is a LEGITIMATE count change: Phase
  17 added the structured-wait (`waitMap`) prefetch SELECT. The fix is to UPDATE the assertion to the
  correct current count (3) with a comment naming the third SELECT, after verifying the third query is
  the intended waitMap prefetch and NOT an accidental N+1 regression. Do not loosen the test to "<=N";
  keep it exact so a future real regression is caught.
- **D-06:** The 7 env-dependent safety-CLI harness failures (`scripts/safety/test/*` —
  gate/restore/restore-tar-cve/snapshot/snapshot-pglite/snapshot-postgres-mock/verify) must be made
  honestly-green: investigate whether they fail only because the pglite/postgres mock harness env is
  absent. If env-only, make CI either (a) provide the harness env so they pass, or (b) explicitly
  SKIP them with a documented `it.skip`/reason AND surface the skip in the CI summary — never let
  them silently red. Prefer fixing the harness if cheap; otherwise an explicit, logged skip is the
  honest-green floor (no silent truncation — per the no-silent-caps invariant).

### Carried invariants
- **D-07:** blocker-chain.ts untouched; determinism + AI-token grep guards stay green. Additive-only;
  instance-agnostic. No new feature behavior — this phase only touches tests, CI config, and the
  version label (already done).

### Claude's Discretion
- Exact CI config file/glob edits (match the existing CI runner structure under test/ci/ or the
  package.json test script).
- Whether the safety-CLI env is provisioned in CI vs documented-skip — pick per cost/feasibility
  found during research.
- The precise condition predicate for the watchdog test's await.
</decisions>

<specifics>
## Specific Ideas

- "Honestly green" is the bar: a green checkmark must mean the matrix actually ran and nothing is
  silently skipped without a logged reason. An explicit, surfaced skip is honest; a silent red or a
  loosened assertion is not.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 20 requirements
- `.planning/REQUIREMENTS.md` — HYG-01, HYG-03, HYG-04 (HYG-02 already `[x]` — satisfied)
- `.planning/ROADMAP.md` §"Phase 20" — goal + depends-on (Phase 17's SC5 matrix)

### Test-debt sources
- `.planning/phases/19-action-cards-async-re-architecture-last-flag-gated/deferred-items.md` — the
  18-subtest sweep failures: 7 safety-CLI harness + 1 Phase-17 prefetch drift, with parent-commit proof
- `test/worker/situation/snapshot-prefetch.test.mjs` — the count-drift assertion (2→3, D-05)
- `test/worker/chat/topic-watchdog.test.mjs` — the U7 watchdog flake (HYG-03)
- `test/worker/blocked-no-edge-verdict-consistency.test.mjs` — the SC5 matrix to wire into CI (HYG-01)
- `scripts/safety/test/*` — the 7 env-dependent safety-CLI harness tests (D-06)

### CI + deploy
- The CI runner config (test/ci/ or package.json `test` script) — where the SC5 matrix glob lives
- DEPLOY-RUNBOOK / memory `beaaa-deploy-mechanics` — the DO-backup-bookend confirmation (HYG-04, batched)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 17's `blocked-no-edge-verdict-consistency.test.mjs` already implements the SC5 4×8 matrix —
  HYG-01 is wiring it into CI, not writing it.
- The traceability re-point pattern (HYG-02) is already shipped — the model for "point the test at the
  right source-of-truth doc."

### Established Patterns
- Condition-based test waits exist elsewhere in the suite (the storm-safety / heartbeat tests poll
  observable state) — the analog for the HYG-03 watchdog fix.
- `deferred-items.md` SCOPE BOUNDARY logging — the surfaced debt is already catalogued with proof.

### Integration Points
- CI runner glob/config — add/confirm the SC5 matrix + ensure the safety-CLI env or documented skip.
- The version label is already 1.8.0 (Phase 19) — HYG-04 only needs the live DO-backup confirmation.
</code_context>

<deferred>
## Deferred Ideas

- The automated DO-backup confirmation (HYG-04 live arm) and Phase 19's live ON-flip are BATCHED into
  one end-of-milestone operator window — captured as an autonomous:false checkpoint, not autonomous work.
- Any deeper safety-CLI harness rewrite beyond making CI honest — out of scope; explicit skip suffices.

None block the autonomous CI/test-debt work.
</deferred>

---

*Phase: 20-hygiene-honestly-green-ci*
*Context gathered: 2026-06-15*
