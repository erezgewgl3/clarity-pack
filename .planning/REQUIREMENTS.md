# Requirements: Clarity Pack — v1.5.0 Truthful & Legible Situation Room

**Defined:** 2026-06-03
**Core Value:** Zero rabbit-holes — every blocker chain transitively flattened to a single named human action the operator can act on, in plain English a non-builder understands.

**Milestone goal:** Make every Clarity surface legible to a non-builder — plain English everywhere, zero raw agent/UUID identifiers — and make the Editor-Agent's *truthful* named-action prose actually live in production, via a safe off-request (flag-gated) compile path that keeps the snapshot fast.

**Carried invariants (all phases):** additive-only plugin-namespace schema (disable/uninstall preserves data); degrade-safe rows (no AI dependency in the deterministic floor); instance-agnostic (no company-prefix literals); Editor-Agent governance parity; continuous flag-gated deploy to BEAAA (bookend = DO droplet backup).

## v1 Requirements

Requirements for this milestone. Each maps to exactly one roadmap phase.

### Legibility — plain English, no raw identifiers

- [ ] **LEG-01**: No raw or partial agent identifiers (e.g. `agent#04fcac7c`), bare UUIDs, or machine tokens are ever rendered as user-visible text on any surface (Reader, Situation Room, Bulletin, Chat); every agent reference shows a human name or role.
- [ ] **LEG-02**: The NO_UUID_LEAK render-scan guard is extended to fail on partial-hash agent labels and short hex id fragments, with a named regression test.
- [ ] **LEG-03**: Blocker-chain verdict / terminal lines render as plain-English sentences a non-builder understands — no enum or code tokens (e.g. `AWAITING_AGENT_STUCK`) surfaced as user-visible text.
- [ ] **LEG-04**: The Situation Room focus line is enriched from the TL;DR cache (plain-English summary) when available, falling back to the polished issue title.
- [ ] **LEG-05**: The same blocked item reads with the same plain-English verdict wording across Reader and Situation Room (legibility parity — extends the v1.4.2 one-verdict-everywhere fix to the surfaced wording).

### Editor-Agent prose live in production

- [ ] **PROSE-01**: The Pulse header displays Editor-Agent-compiled plain-English company-status prose above the deterministic floor; when prose is absent or stale, the deterministic floor renders (never blanks).
- [ ] **PROSE-02**: Needs-you / actionable rows display the Editor-Agent's grounded named action (what unblocks this + who + ~when) in production; when stale or ungrounded, the row degrades to the deterministic line with no fabricated urgency.
- [ ] **PROSE-03**: All Editor-Agent prose is grounded against real issue data (no hallucinated references or identifiers) and passes the grounding + stale→degrade guardrails with a named test.

### Off-request snapshot + action-card re-architecture (flag-gated, sequenced LAST)

- [ ] **PERF-01**: The Situation Room snapshot recompute runs off the request path (precomputed / cached); a cold view returns well under the 30s host timeout (target p95 < ~5s) and never 502s.
- [ ] **PERF-02**: Action-card compile runs off the snapshot request path and writes no operation-issue notification storm; it is re-enabled behind `ACTION_CARDS_ENABLED`.
- [ ] **PERF-03**: `ACTION_CARDS_ENABLED` is safely toggleable at runtime — OFF degrades to the deterministic floor (room still works); ON yields no snapshot 502 and no notification storm; both states are flag-gated for continuous BEAAA deploy.

## Future Requirements

Acknowledged but deferred — not in this roadmap.

### Usable for everyone (multi-user)

- **OPTIN-01**: Per-user opt-in toggle UI under Settings → Clarity Pack (server-side opt-in already ships; this is the toggle surface).
- **MULTI-01**: Multi-operator support (remove single-operator assumptions: silent auto-unarchive, assignee picker).

### Do-it-here completeness

- **DOIT-06**: Reply-in-place for AWAITING_AGENT_STUCK rows (Phase 14 shipped AWAITING_HUMAN only).

## Out of Scope

Explicitly excluded for v1.5.0. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Per-user opt-in toggle UI / multi-user | v1.5.0 is legible-for-non-builders, not multi-user; server-side opt-in already ships. Deferred to a future milestone. |
| Reply-in-place for stuck-agent rows | Legibility + truthful prose is the focus; the do-it-here surface is feature-complete enough for now. |
| `R3-self-assign-one-assignee` fix | Not legibility/prose; fold in only if cheap during the action-layer rework. |
| Replacing or forking the Paperclip UI/core | Coexistence guarantee — all work stays inside the plugin manifest contribution surface. |
| New non-additive schema | Coexistence guarantee #3 — additive plugin-namespace migrations only. |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LEG-01 | Phase 16 | Pending |
| LEG-02 | Phase 16 | Pending |
| LEG-03 | Phase 16 | Pending |
| LEG-04 | Phase 16 | Pending |
| LEG-05 | Phase 16 | Pending |
| PROSE-01 | Phase 17 | Pending |
| PROSE-02 | Phase 17 | Pending |
| PROSE-03 | Phase 17 | Pending |
| PERF-01 | Phase 18 | Pending |
| PERF-02 | Phase 18 | Pending |
| PERF-03 | Phase 18 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11 ✓
- Unmapped: 0

**Phase rollup:**
- Phase 16 — Legibility / No-Raw-Identifiers Pass: LEG-01, LEG-02, LEG-03, LEG-04, LEG-05 (5)
- Phase 17 — Editor-Agent Prose Live: PROSE-01, PROSE-02, PROSE-03 (3)
- Phase 18 — Off-Request Snapshot + Action-Card Re-Arch (flag-gated, LAST): PERF-01, PERF-02, PERF-03 (3)

---
*Requirements defined: 2026-06-03*
*Last updated: 2026-06-03 — roadmap created; 11/11 requirements mapped to Phases 16–18, no orphans*
