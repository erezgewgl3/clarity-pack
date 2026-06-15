# Requirements: Clarity Pack — v1.6.0 Stuck-Agent Reply-In-Place

**Defined:** 2026-06-15
**Core Value:** Zero rabbit-holes — Eric should never have to click through three levels of unresolved task references to find out what one of his agents is stuck on (and, now, to unstick it without leaving the cockpit).

## v1 Requirements

Requirements for this milestone. Each maps to exactly one roadmap phase.

### Stuck-Agent Reply-In-Place

- [x] **STUCK-01**: Operator sees a reply-in-place affordance on `AWAITING_AGENT_STUCK` rows in the Situation Room employee row (Phase-15 Watch tier)
- [x] **STUCK-02**: Operator sees the same reply-in-place affordance on `AWAITING_AGENT_STUCK` rows in the Reader live-blocker panel
- [x] **STUCK-03**: Submitting a reply on a stuck row posts a comment that resumes the stuck agent via `situation.replyAndResume` (worker accepts a STUCK leaf and resumes it)
- [x] **STUCK-04**: A stuck agent is never resumed by merely viewing or loading a row — resume happens only on an explicit operator reply (Phase-13/14 no-auto-resume rule preserved)
- [x] **STUCK-05**: Reply copy is appropriate to the stuck context ("nudge / reply to unstick"), distinct from the human-decision wording used on `AWAITING_HUMAN` rows
- [x] **STUCK-06**: Every new render and resume path is degrade-safe and NO_UUID_LEAK clean — no raw agent ids/UUIDs surface in the affordance, its prose, or the resumed comment

## v2 Requirements

Deferred to future milestones. Tracked but not in this roadmap.

(None — v1.6.0 is a single targeted action-loop extension.)

## Out of Scope

Explicitly excluded for v1.6.0. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Per-user opt-in toggle UI / multi-user | Eric explicitly dropped it ("not even needed"); server-side opt-in already ships (Phase 2) |
| Phase-4.2 power features (archive full-view, paused-agent banner, ref-chip peek cards, storage-pin, cold-task-from-global) | Eric explicitly dropped them from v1.6.0 scope |
| `R3-self-assign-one-assignee` | Eric explicitly dropped it; minor host "one assignee" edge case tracked in `phases/09-.../09-VERIFICATION.md` |
| New Postgres migration | Likely unnecessary — v1.6.0 is a UI/handler gate over the existing `situation.replyAndResume` handler; `blocker-chain.ts` engine stays untouched and AI-free |
| Changes to blocker-chain classification | Engine already classifies `AWAITING_AGENT_STUCK`; v1.6.0 only consumes the existing verdict — no new terminal kind |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STUCK-01 | Phase 21 | Complete |
| STUCK-02 | Phase 21 | Complete |
| STUCK-03 | Phase 21 | Complete |
| STUCK-04 | Phase 21 | Complete |
| STUCK-05 | Phase 21 | Complete |
| STUCK-06 | Phase 21 | Complete |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6 (filled by roadmapper)
- Unmapped: 0

---
*Requirements defined: 2026-06-15*
*Last updated: 2026-06-15 after initial definition*
