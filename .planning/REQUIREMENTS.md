# Requirements: Clarity Pack — v1.4.0 Truthful Situation Room

**Defined:** 2026-06-01
**Core Value:** Zero rabbit-holes — every blocker chain transitively flattened to a single named human action the operator can act on.

## v1.4.0 Requirements

Requirements for the Truthful Situation Room milestone. Each maps to a roadmap phase (continues numbering from Phase 10).

### Honest Blocker Taxonomy (engine)

- [x] **TAX-01**: The blocker-chain engine classifies each blocked item into one honest terminal kind — awaiting-human / agent-working / agent-stuck / self-resolving / external / cycle / genuinely-unowned — recognizing **agent** ownership (`assigneeAgentId`), not just user ownership.
- [x] **TAX-02**: A chain waiting on another agent flattens transitively to the human-actionable end; no mid-chain "poke the agent" terminal is surfaced.
- [x] **TAX-03**: Degrade-safe — a row whose chain can't be built or classified shows an honest fallback, never a false "assign owner."

### Needs-You Triage

- [ ] **NY-01**: "Needs you" lists only human-actionable items (awaiting-human + genuinely-unowned); agent-working and self-resolving items are excluded.
- [ ] **NY-02**: "Needs you" rows are ranked by what each unblocks (leverage), not age alone.
- [ ] **NY-03**: The "Assign owner" affordance appears only on genuinely-unowned or stuck-agent rows — never on items awaiting a named party.

### Editor-Agent Named Action

- [x] **ACT-01**: Each human-actionable row shows a grounded, plain-English named single action + the awaited party + a time estimate (Editor-Agent generated).
- [x] **ACT-02**: Stale or absent Editor-Agent output degrades to the deterministic line (e.g. "waiting on you — Founder ruling, BEAAA-NN"); the row never blanks or fabricates.
- [x] **ACT-03**: The Editor-Agent only annotates rows the engine already flagged as human-actionable (it cannot manufacture urgency); yes/no decision options appear only when the source issue poses a binary.

### Do-It-Here Action

- [ ] **DO-01**: The operator can reply in place on a human-actionable row; the reply posts to the awaited agent's thread (canonical issue comment).
- [ ] **DO-02**: Quick-decision chips (Approve / Reject / pick-one) are offered when the blocker is a clean yes/no.
- [x] **DO-03**: Completing the action actually **unblocks and resumes** the agent — verified end-to-end against the live Paperclip model. *(De-risked first by the opening-phase spike: comment alone vs. comment + status transition.)*
- [ ] **DO-04**: The reply-in-place + quick-decision loop is available on the **Situation Room**, the **Reader-view blocker panel**, and the **org-blocked backlog** — not just the cockpit.
- [ ] **DO-05**: When a chain terminates on an out-of-system human (not reachable via comment), the row surfaces the named action + "Open ↗" instead of a Send affordance — no dead Send button.

### Cockpit Information Architecture

- [ ] **COCK-01**: A Pulse header states company status in one plain-English sentence + vital signs (need-you / in-motion / stuck / self-clearing counts).
- [ ] **COCK-02**: The Situation Room is organized into Needs-you → In-motion → Watch tiers, loudest-on-top; In-motion is calm with legible "what each agent is working on" text; Watch holds stuck-agent / external / cycle / overflow items.

## Future Requirements

- **R3-SELF-01** (minor, may fold in while reworking the action layer): "Take it myself" must not trip the host "one assignee" rule on already-agent-owned rows (clear-then-assign, or "already owned by <agent>" messaging).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Reworking the Daily Bulletin's existing "Requires Your Decision" inbox | Separate surface with its own Approve/Decline loop; not part of the Situation-Room/Reader/backlog action work. |
| Non-additive schema / mutating Paperclip core tables | Forbidden by coexistence guarantee #3. New state is added via additive plugin-namespace migrations only (any number, as needed) — listed here to prevent scope creep, not a functional cap. |
| Changing Paperclip's same-origin trust model | Not a plugin-level choice; it's a Paperclip-core posture inherited as-is. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DO-03 | Phase 10 | Complete |
| TAX-01 | Phase 11 | Complete |
| TAX-02 | Phase 11 | Complete |
| TAX-03 | Phase 11 | Complete |
| NY-01 | Phase 12 | Pending |
| NY-02 | Phase 12 | Pending |
| NY-03 | Phase 12 | Pending |
| ACT-01 | Phase 13 | Complete |
| ACT-02 | Phase 13 | Complete |
| ACT-03 | Phase 13 | Complete |
| DO-01 | Phase 14 | Pending |
| DO-02 | Phase 14 | Pending |
| DO-04 | Phase 14 | Pending |
| DO-05 | Phase 14 | Pending |
| COCK-01 | Phase 15 | Pending |
| COCK-02 | Phase 15 | Pending |

**Coverage:**
- v1.4.0 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0 ✓

Note: DO-03 is mapped to Phase 10 (the gating spike that proves the unblock/resume path). Its UI realization rides along in Phase 14 (DO-01/02/04/05), which is gated by the Phase 10 result.

---
*Requirements defined: 2026-06-01*
*Last updated: 2026-06-01 — roadmap created; all 16 requirements mapped to Phases 10–15.*
