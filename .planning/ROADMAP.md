# Roadmap: Clarity Pack

**Created:** 2026-05-07
**Core Value:** Zero rabbit-holes — every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

## Milestones

- ✅ **v1.0.0 — v1 Final Internal** — Phases 1–9 (shipped 2026-06-01, final version v1.3.0 live on BEAAA)
- ▶ **v1.4.0 — Truthful Situation Room** — Phases 10–15 (active; continues phase numbering)

## Phases

<details>
<summary>✅ v1.0.0 v1 Final Internal (Phases 1–9, incl. 4.1 / 4.2 / 6.1) — SHIPPED 2026-06-01</summary>

Full phase details archived at [`milestones/v1.0.0-ROADMAP.md`](milestones/v1.0.0-ROADMAP.md). Requirements at [`milestones/v1.0.0-REQUIREMENTS.md`](milestones/v1.0.0-REQUIREMENTS.md).

- [x] **Phase 1: Pre-Install Safety** — snapshot/restore/smoke-test CLI + rehearsed restore drill. CLOSED 2026-05-13 (Countermoves rehearsal PASS).
- [x] **Phase 2: Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In** — installable plugin, opt-in gate, shared primitives, two on-demand surfaces, Editor-Agent skeleton. CLOSED 2026-05-15.
- [x] **Phase 3: Daily Bulletin** — DST-safe 06:30-ET two-pass compile, decision inbox, lineage threads, errata, failed-compile banner. CLOSED 2026-05-18 (v0.6.6).
- [x] **Phase 4: Employee Chat** — hybrid real-time chat persisting as issue comments; coexistence proven (907 comments survive disable). CLOSED 2026-05-19.
- [x] **Phase 4.1: Chat → True Task** — operator-initiated assigned/tracked true-task creation from chat. CLOSED 2026-05-22 (v0.8.4).
- [x] **Phase 4.2: Reader↔Chat Bridge** — deterministic issue-lineage routing + bidirectional issue↔conversation graph. CLOSED 2026-05-24 (v1.0.0-rc.2).
- [x] **Phase 5: Distribution & Polish** — full-fidelity previewers (xlsx/pdf/md/png), event-derived AC auto-status, lockfile/a11y CI gates. CLOSED 2026-05-25.
- [x] **Phase 6.1: Situation Room spec-complete** — owner-resolution at the Critical Path leaf (`agent.takeOwnership`) + inline 24h artifact chips + `+ Create task`. CLOSED 2026-05-27 (rc.8); v1.0.0 ship gate cleared.
- [x] **Phase 7: Clarity-surfaces quality & portability** — instance-agnostic ref-resolver, TL;DR cleanup, Situation Room blocked-backlog, bulletin lineage. CLOSED 2026-05-29 (v1.0.0).
- [x] **Phase 8: Situation Room people-first cockpit** — per-employee row strip, idle-loud sort, always-visible needs-you banner. CLOSED 2026-05-30 (v1.2.0; 6/6 live PASS).
- [x] **Phase 9: Situation Room actionable cockpit** — hero Assign-owner mutates the real Paperclip issue (`situation.assignOwner`); three-group people view; un-frozen banner; stand-down/resume. CLOSED 2026-06-01 (v1.3.0; R3 leaf-UUID gap fixed in 09-04 + re-verified live). One minor follow-on: `R3-self-assign-one-assignee`.

</details>

### ▶ v1.4.0 — Truthful Situation Room (Phases 10–15)

Make the Situation Room the one screen that truthfully tells Eric what's going on — and lets him do what needs him, in place. Hybrid architecture: a **deterministic engine** guaranteeing honesty + degrade-safety, with an **Editor-Agent** supplying the named human sentence on top. The two halves stay visibly separate (no AI in `blocker-chain.ts`).

- [x] **Phase 10: Unblock-Resume Spike** — prove that answering an agent (a comment) actually unblocks + resumes it against the live Paperclip model, or determine the required status transition. Gates all action UI. (completed 2026-06-02)
- [x] **Phase 11: Honest Blocker Taxonomy (engine)** — deterministic terminal classification recognizing agent ownership, flattening transitively to the human at the end, degrade-safe per row. (4/4 plans built; verification 2026-06-02 found gaps — CR-01 NO_UUID_LEAK breach on Reader panel; gap closure required) (completed 2026-06-02)
- [ ] **Phase 12: Needs-You Triage** — "Needs you" lists only human-actionable items, ranked by leverage; Assign-owner suppressed except on genuinely-unowned / stuck-agent rows.
- [ ] **Phase 13: Editor-Agent Named Action** — grounded plain-English named action + party + estimate, with a stale→degrade guardrail and no manufactured urgency.
- [ ] **Phase 14: Do-It-Here Action Loop** — reply-in-place + quick-decision chips that unblock+resume the agent, across three surfaces; "Open ↗" for out-of-system humans.
- [ ] **Phase 15: Cockpit IA Redesign** — Pulse header + Needs-you / In-motion / Watch tiers consuming the engine verdict + Editor-Agent cards.

## Phase Details

### Phase 10: Unblock-Resume Spike
**Goal**: De-risk the make-or-break feasibility question before any action UI exists — does posting a comment to an agent's thread actually unblock and resume that agent, or is a status transition also required?
**Depends on**: Nothing (opening phase; continues numbering from Phase 9)
**Requirements**: DO-03
**Success Criteria** (what must be TRUE):
  1. Against the live Paperclip model, it is proven whether a comment alone resumes a blocked agent, or whether a status/blocker transition must accompany it — with the exact required transition documented.
  2. The verified unblock-resume recipe (comment-write path + any required state transition + when the agent consumes it on heartbeat) is captured as a written contract the action loop (Phase 14) will implement against.
  3. The spike confirms the path works without violating Editor-Agent / agent governance parity (standard caps, pause/terminate, audit) and touches no non-additive schema.
  4. A negative or partial result is recorded honestly with its implication for DO-03 scope, so the action loop is not built on an unproven assumption.
**Plans**: 3 plans
- [x] 10-01-PLAN.md — Build the unblock-resume probe harness + Wave-0 dry-confirm (A1 blocked-settable / A3 agent-mint) + D-02 read-only fidelity, bookended by DO-droplet backup
- [x] 10-02-PLAN.md — Three-shape live run (A awaiting-answer / B status=blocked / C blockedByIssueIds) with the D-08 ladder + three-signal PASS judging
- [ ] 10-03-PLAN.md — Write the 10-03-SPIKE-FINDINGS unblock-resume contract (DO-03 gate) + commit the probe

### Phase 11: Honest Blocker Taxonomy (engine)
**Goal**: Replace the binary owned-vs-unowned classification with a deterministic, agent-aware terminal taxonomy that is the single source of truth every surface reads from.
**Depends on**: Phase 10 (spike informs whether "stuck-agent" terminals need a resume hint), but engine work can proceed in parallel since it is read-only classification
**Requirements**: TAX-01, TAX-02, TAX-03
**Success Criteria** (what must be TRUE):
  1. Each blocked item is classified into exactly one honest terminal kind — awaiting-human / agent-working / agent-stuck / self-resolving / external / cycle / genuinely-unowned — using agent ownership (`assigneeAgentId`) and heartbeat liveness, not just user ownership.
  2. A chain waiting on another agent flattens transitively to the human-actionable end; no mid-chain "poke the agent" terminal is ever surfaced.
  3. A row whose chain cannot be built or classified shows an honest deterministic fallback line, never a false "assign owner."
  4. `blocker-chain.ts` stays pure and deterministic — its determinism test and AI-token grep guard pass (no AI/LLM call introduced into the engine file).
  5. The engine hands every consuming surface (Situation Room, org-blocked backlog, Reader blocker panel) the same structured per-row verdict.
**Plans**: 7 plans (4 shipped + 3 gap-closure for CR-01 / WR-01..06 / IN-01..04)
- [x] 11-01-PLAN.md — Pure engine contract: 8-variant Terminal union + enriched verdict + D-07 cascade + classifyVerdict() + scrub; __unowned__ removed (wave 1)
- [x] 11-02-PLAN.md — Worker agent-ownership/liveness capture in both BFS builders + graceful()→UNCLASSIFIED degrade (wave 2)
- [x] 11-03-PLAN.md — Rollup re-triage off the verdict + split-identity + UNCLASSIFIED-on-throw + humanize-snapshot compile-gate (wave 3)
- [x] 11-04-PLAN.md — UI surfaces render off the verdict; assign gated to UNOWNED; all 8 kinds render; full-repo green gate (wave 4)
- [x] 11-05-PLAN.md — Engine/shared hardening: WR-03 cadence>0 guard, WR-04 narrow return, WR-05 EXTERNAL label, IN-02 renumber, IN-04 makeDegradedResult, blocker-free 'none' (wave 1)
- [x] 11-06-PLAN.md — [BLOCKER] CR-01 scrub flatten-blocker-chain success label; WR-01 noBlockers→'none'; WR-03 call sites; WR-06 single-source viewer; IN-03 shared projection (wave 2)
- [x] 11-07-PLAN.md — Reader panel renders scrubbed awaitedPartyLabel; WR-02 no dead button; IN-01 comment; NO_UUID_LEAK render-scan UUID-pattern guard (wave 3)

### Phase 12: Needs-You Triage
**Goal**: Use the new terminal taxonomy so "Needs you" tells the truth — only human-actionable items, ranked by what they unblock, with Assign-owner shown only when assignment is genuinely the answer.
**Depends on**: Phase 11
**Requirements**: NY-01, NY-02, NY-03
**Success Criteria** (what must be TRUE):
  1. "Needs you" lists only human-actionable items (awaiting-human + genuinely-unowned); agent-working and self-resolving items are excluded and routed elsewhere.
  2. "Needs you" rows are ordered by leverage (what each unblocks), not by age alone.
  3. The "Assign owner" affordance appears only on genuinely-unowned or stuck-agent rows — never on an item awaiting a named party.
  4. Triage keys off the engine's terminal kind, not a string match like `ownerName === 'Unassigned'`.
**Plans**: TBD
**UI hint**: yes

### Phase 13: Editor-Agent Named Action
**Goal**: Layer the human sentence on top of the honest engine — the Editor-Agent writes a grounded named action (+ party + estimate) for each human-actionable row, with a guardrail that degrades rather than fabricates.
**Depends on**: Phase 11 (only annotates rows the engine flagged)
**Requirements**: ACT-01, ACT-02, ACT-03
**Success Criteria** (what must be TRUE):
  1. Each human-actionable row shows a grounded plain-English named single action + the awaited party + a time estimate, generated by the Editor-Agent and carrying its source issue.
  2. When the Editor-Agent output is stale or absent, the row degrades to the deterministic line (e.g. "waiting on you — Founder ruling, BEAAA-NN") and never blanks or invents urgency.
  3. The Editor-Agent only annotates rows the engine already flagged as human-actionable; yes/no decision options appear only when the source issue poses a binary.
  4. Action cards are cached in the additive plugin namespace and refreshed on the Editor-Agent heartbeat + the existing 60s on-view recompute, reusing the existing grounded-summary (TL;DR/bulletin) pattern under standard governance parity.
**Plans**: TBD

### Phase 14: Do-It-Here Action Loop
**Goal**: Let the operator act in place — reply-in-place + quick-decision chips that post to the awaited agent and actually unblock+resume it, available across all three blocker surfaces, with an honest escape hatch for out-of-system humans.
**Depends on**: Phase 10 (proven unblock recipe), Phase 11 (taxonomy), Phase 13 (action card / decision options)
**Requirements**: DO-01, DO-02, DO-04, DO-05
**Success Criteria** (what must be TRUE):
  1. The operator can reply in place on a human-actionable row and the reply posts to the awaited agent's thread as a canonical `public.issue_comments` comment, then unblocks+resumes the agent using the Phase 10 recipe.
  2. Quick-decision chips (Approve / Reject / pick-one) are offered when the blocker is a clean yes/no and complete the same unblock+resume path.
  3. The reply-in-place + quick-decision primitive is available on the Situation Room, the Reader-view blocker panel, and the org-blocked backlog — the same shared primitive, not three copies.
  4. When a chain terminates on an out-of-system human (not reachable via comment), the row surfaces the named action + "Open ↗" instead of a Send affordance — no dead Send button.
  5. UUIDs are never rendered as text (NO_UUID_LEAK); the mutation carries the UUID while the display stays human-readable.
**Plans**: TBD
**UI hint**: yes

### Phase 15: Cockpit IA Redesign
**Goal**: Redesign the whole Situation Room screen around "is it mine," loudest-on-top — one Pulse glance answers "how's the company?", then Needs-you / In-motion / Watch tiers answer "what needs me?".
**Depends on**: Phase 12 (triage), Phase 13 (action cards), Phase 14 (reply-in-place lives here first)
**Requirements**: COCK-01, COCK-02
**Success Criteria** (what must be TRUE):
  1. A Pulse header states company status in one plain-English sentence + four vital signs (need-you / in-motion / stuck / self-clearing counts), answering "how's the company?" before any list.
  2. The screen is organized into Needs-you → In-motion → Watch tiers, loudest-on-top: Needs-you carries the named actions + reply-in-place; In-motion is calm with clearly-legible "what each agent is working on" text; Watch holds stuck-agent / external / cycle / overflow items.
  3. The cockpit consumes the engine verdict (Phase 11/12) and Editor-Agent cards (Phase 13) directly — no re-derivation of ownership in the view layer.
  4. Rows stay degrade-safe and instance-agnostic (no company-prefix literals); the screen renders honestly when the Editor-Agent is down.
**Plans**: TBD
**UI hint**: yes

## Progress

| Milestone | Phases | Status | Shipped |
|-----------|--------|--------|---------|
| v1.0.0 — v1 Final Internal | 1–9 (11 incl. decimals) | ✅ Complete | 2026-06-01 (v1.3.0) |
| v1.4.0 — Truthful Situation Room | 10–15 | ▶ Active | — |

### v1.4.0 phase tracking

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Unblock-Resume Spike | 2/3 | Complete    | 2026-06-02 |
| 11. Honest Blocker Taxonomy | 7/7 | Complete   | 2026-06-02 |
| 12. Needs-You Triage | 0/0 | Not started | - |
| 13. Editor-Agent Named Action | 0/0 | Not started | - |
| 14. Do-It-Here Action Loop | 0/0 | Not started | - |
| 15. Cockpit IA Redesign | 0/0 | Not started | - |

---
*Roadmap defined: 2026-05-07 · v1.0.0 milestone archived: 2026-06-01 · v1.4.0 milestone added: 2026-06-01 (Phases 10–15)*
