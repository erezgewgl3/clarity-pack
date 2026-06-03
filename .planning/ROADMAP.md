# Roadmap: Clarity Pack

**Created:** 2026-05-07
**Core Value:** Zero rabbit-holes — every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

## Milestones

- ✅ **v1.0.0 — v1 Final Internal** — Phases 1–9 (shipped 2026-06-01, final version v1.3.0 live on BEAAA)
- ✅ **v1.4.0 — Truthful Situation Room** — Phases 10–15 (shipped v1.4.2, live-verified BEAAA 2026-06-03)
- ▶ **v1.5.0 — Truthful & Legible Situation Room** — Phases 16–18 (active; continues phase numbering)

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

<details>
<summary>✅ v1.4.0 Truthful Situation Room (Phases 10–15) — SHIPPED v1.4.2, live-verified BEAAA 2026-06-03</summary>

Make the Situation Room the one screen that truthfully tells Eric what's going on — and lets him do what needs him, in place. Hybrid architecture: a **deterministic engine** guaranteeing honesty + degrade-safety, with an **Editor-Agent** supplying the named human sentence on top. The two halves stay visibly separate (no AI in `blocker-chain.ts`). Full phase details below under "Phase Details (v1.4.0)".

- [x] **Phase 10: Unblock-Resume Spike** — prove a comment unblocks + resumes a live agent (or the required transition). CLOSED 2026-06-02.
- [x] **Phase 11: Honest Blocker Taxonomy (engine)** — deterministic 8-kind terminal classification, flattened transitively to the human, degrade-safe; single `verdict` source. CLOSED 2026-06-02.
- [x] **Phase 12: Needs-You Triage** — "Needs you" = human-actionable only, ranked by leverage; assign-owner suppressed except on unowned / stuck-agent rows. CLOSED 2026-06-02.
- [x] **Phase 13: Editor-Agent Named Action** — grounded named action + party + estimate; stale→degrade; no manufactured urgency. CLOSED 2026-06-02.
- [x] **Phase 14: Do-It-Here Action Loop** — reply-in-place + decision chips that unblock+resume across three surfaces; "Open ↗" for out-of-system humans. CLOSED 2026-06-03.
- [x] **Phase 15: Cockpit IA Redesign** — Pulse header + Needs-you / In-motion / Watch tiers consuming engine verdict + Editor-Agent cards. CLOSED 2026-06-03. SC5 one-verdict-everywhere divergence (BEAAA-972) fixed in v1.4.2, live-verified 2026-06-03.

</details>

### ▶ v1.5.0 — Truthful & Legible Situation Room (Phases 16–18)

Make every Clarity surface legible to a non-builder — plain English everywhere, zero raw agent/UUID identifiers — and make the Editor-Agent's *truthful* named-action prose actually live in production, via a safe off-request (flag-gated) compile path that keeps the snapshot fast. Builds directly on the v1.4.0 deterministic engine + Editor-Agent layer: legibility first, prose live on top, then the off-request re-architecture that lets the prose layer run safely without blowing the 30s snapshot cliff.

**Live driver (2026-06-03):** with action-cards gated OFF (v1.4.1 hotfix), the room no longer 502s (6/6 snapshot calls 200) but cold snapshot recompute is **25.7s** — within ~4s of the 30s host-timeout cliff. Re-enabling action-cards synchronously is what previously blocked the snapshot >30s and triggered the BEAAA-2092 notification storm. The PERF phase (sequenced LAST, flag-gated) makes re-enable safe.

- [ ] **Phase 16: Legibility / No-Raw-Identifiers Pass** — plain English everywhere; kill partial agent-id hashes + bare UUIDs across all four surfaces; extend NO_UUID_LEAK to partial-hash labels; enrich focus line from `tldr_cache`; verdict-wording parity across Reader + Situation Room.
- [ ] **Phase 17: Editor-Agent Prose Live** — Pulse-header prose enrichment (deferred D-03) + grounded named-action row prose in production, with the stale→degrade floor intact (never blanks, never fabricates urgency).
- [ ] **Phase 18: Off-Request Snapshot + Action-Card Re-Arch (flag-gated, LAST)** — move the heavy recompute off the request path to kill the 25.7s cold near-cliff; re-enable `ACTION_CARDS_ENABLED` safely with no notification storm; flag toggleable at runtime for continuous BEAAA deploy.

## Phase Details (v1.5.0)

### Phase 16: Legibility / No-Raw-Identifiers Pass
**Goal**: Every Clarity surface reads as plain English for a non-builder — no raw or partial machine identifiers, no enum/code tokens surfaced as text, and the same blocked item reads with the same wording everywhere.
**Depends on**: Nothing new (opening phase of v1.5.0; continues numbering from Phase 15). Builds on the v1.4.0 engine verdict + NO_UUID_LEAK render-scan already in place.
**Requirements**: LEG-01, LEG-02, LEG-03, LEG-04, LEG-05
**Success Criteria** (what must be TRUE):
  1. A non-builder reading any surface (Reader, Situation Room, Bulletin, Chat) never sees a raw or partial agent identifier (e.g. `agent#04fcac7c`), a bare UUID, or a machine token — every agent reference shows a human name or role.
  2. The NO_UUID_LEAK render-scan guard fails the build when a partial-hash agent label or short hex id fragment would render, proven by a named regression test (extends the v1.4.x UUID-pattern guard).
  3. Blocker-chain verdict / terminal lines read as plain-English sentences — no enum or code token (e.g. `AWAITING_AGENT_STUCK`) is ever shown as user-visible text.
  4. The Situation Room focus line shows the plain-English TL;DR-cache summary when available, falling back to the polished issue title — never the bare/raw title.
  5. The same blocked item reads with the same plain-English verdict wording on the Reader blocker panel and in the Situation Room (legibility parity, extending the v1.4.2 one-verdict-everywhere fix to surfaced wording).
**Plans**: TBD
**UI hint**: yes

### Phase 17: Editor-Agent Prose Live
**Goal**: Make the Editor-Agent's truthful named-action prose actually render in production — Pulse-header company-status prose and grounded named-action row prose — on top of the deterministic floor, which always still renders when prose is absent, stale, or ungrounded.
**Depends on**: Phase 16 (consumes the legibility primitives — plain-English focus lines, scrubbed identifiers, verdict wording — so the prose layer is legible and identifier-clean by construction).
**Requirements**: PROSE-01, PROSE-02, PROSE-03
**Success Criteria** (what must be TRUE):
  1. The Pulse header displays Editor-Agent-compiled plain-English company-status prose above the deterministic floor; when that prose is absent or stale, the deterministic floor sentence renders instead and the header never blanks.
  2. Needs-you / actionable rows display the Editor-Agent's grounded named action (what unblocks this + who + ~when) in production; when stale or ungrounded, the row degrades to the deterministic line with no fabricated urgency.
  3. Every piece of Editor-Agent prose is grounded against real issue data — no hallucinated references or identifiers — and the grounding + stale→degrade guardrails are enforced by a named test.
  4. The prose layer stays within Editor-Agent governance parity (standard caps, pause/terminate, audit) and the deterministic floor has zero AI dependency, so the surfaces render honestly when the Editor-Agent is down.
**Plans**: TBD
**UI hint**: yes

### Phase 18: Off-Request Snapshot + Action-Card Re-Arch (flag-gated, LAST)
**Goal**: Move the heavy Situation Room recompute off the request path so a cold view returns well under the 30s host-timeout cliff, then re-enable the Editor-Agent action-card compile safely behind `ACTION_CARDS_ENABLED` with no operation-issue notification storm.
**Depends on**: Phase 16 (legibility) + Phase 17 (prose live). This is the LAST phase by operator lock — the prose/legibility work must land first so the off-request path is re-architecting a known-good, legible surface; re-enabling action-cards is what previously caused the 502 + BEAAA-2092 storm.
**Requirements**: PERF-01, PERF-02, PERF-03
**Success Criteria** (what must be TRUE):
  1. The Situation Room snapshot recompute runs off the request path (precomputed / cached); a cold view returns well under the 30s host timeout (target p95 < ~5s, down from the live 25.7s near-cliff) and never 502s.
  2. The Editor-Agent action-card compile runs off the snapshot request path and writes no operation-issue notification storm (no recurrence of BEAAA-2092).
  3. `ACTION_CARDS_ENABLED` is safely toggleable at runtime: OFF degrades to the deterministic floor and the room still works; ON yields no snapshot 502 and no notification storm — both states ship via continuous flag-gated BEAAA deploy.
**Plans**: TBD
**UI hint**: yes

## Phase Details (v1.4.0)

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
**Plans**: 3 plans
- [ ] 12-01-PLAN.md — Engine D-05 edit: classifyVerdict AWAITING_AGENT_STUCK → actionAffordance 'assign' (tier/needsYou unchanged); determinism + AI-token guards gate the edit (wave 1)
- [ ] 12-02-PLAN.md — Worker triage: needsYou-keyed membership (D-11), leverage rank + per-leaf dedup (D-01/02/03, no new fetch), banner topAction → highest-leverage (D-12) (wave 2)
- [ ] 12-03-PLAN.md — Assign-gating on all three surfaces (D-09): OrgBlockedRow carries actionAffordance; backlog/Reader/SR gate assign off the engine verdict only (wave 2)
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
**Plans**: 3 plans
- [x] 13-01-PLAN.md — Foundation: additive action_cards migration (0015) + shared ActionCard type + cache repo (wave 1)
- [x] 13-02-PLAN.md — driveActionCardsStep (gloss-mirror) + action-cards OperationKind + situation.snapshot/heartbeat wiring; anti-fabrication + dual-arm staleness, never-throw (wave 2)
- [x] 13-03-PLAN.md — Render the cached named-action sentence + party + estimate on the needs-you row with deterministic degrade + NO_UUID_LEAK render-scan (wave 3)

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
**Plans**: 4 plans
- [ ] 14-01-PLAN.md — Additive dedup migration 0016 + situation.replyAndResume handler (comment-write + conditional Shape-B {status:'in_progress'} flip driven by a REAL needsDurabilityFlip + messageUuid idempotency incl. wake idempotencyKey + opt-in guard) (wave 1)
- [x] 14-04-PLAN.md — Data-model foundation: emit worker needsDurabilityFlip (from leaf status) + terminalKind on the rollup blockerChain + employee-row mirror; widen OrgBlockedRow with awaitedPartyLabel/targetAgentUuid/decisionOptions/leafIssueUuid/needsDurabilityFlip (wave 1)
- [x] 14-02-PLAN.md — Pure isReplyReachable(terminalKind) predicate (AWAITING_HUMAN only; AWAITING_AGENT_STUCK deferred) + the ONE shared <ReplyInPlace> primitive (free-text reply + decision chips off decisionOptions + Open↗ + await-confirm) (wave 2)
- [x] 14-03-PLAN.md — Wire <ReplyInPlace> into all three surfaces (employee-row / live-blocker-panel / blocked-backlog-expander) — same import no copies, reachable off terminalKind, real needsDurabilityFlip, no duplicate blockerLine; full-suite green gate (wave 3)
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
**Plans**: 3 plans
- [x] 15-01-PLAN.md — Worker pulse summary aggregation (four vital-sign counts over existing verdicts; additive snapshot field, no migration) — COMPLETE (wave 1)
- [x] 15-02-PLAN.md — PulseHeader (deterministic status sentence + four vital-sign chips; banner folded in; NO_UUID_LEAK render-scan) — COMPLETE 2026-06-03 (component + buildPulseSentence + scoped CSS + render-scan; page wiring is 15-03)
- [x] 15-03-PLAN.md — Tier IA (Needs-you -> In-motion -> Watch by engine verdict tier; EmployeeRow reused + calm variant; backlog -> Watch; degrade-safe wiring)

## Progress

| Milestone | Phases | Status | Shipped |
|-----------|--------|--------|---------|
| v1.0.0 — v1 Final Internal | 1–9 (11 incl. decimals) | ✅ Complete | 2026-06-01 (v1.3.0) |
| v1.4.0 — Truthful Situation Room | 10–15 | ✅ Complete | 2026-06-03 (v1.4.2) |
| v1.5.0 — Truthful & Legible Situation Room | 16–18 | ▶ Active | — |

### v1.5.0 phase tracking

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 16. Legibility / No-Raw-Identifiers Pass | 0/TBD | Not started | - |
| 17. Editor-Agent Prose Live | 0/TBD | Not started | - |
| 18. Off-Request Snapshot + Action-Card Re-Arch | 0/TBD | Not started | - |

### v1.4.0 phase tracking

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Unblock-Resume Spike | 2/3 | Complete    | 2026-06-02 |
| 11. Honest Blocker Taxonomy | 7/7 | Complete    | 2026-06-02 |
| 12. Needs-You Triage | 3/3 | Complete    | 2026-06-02 |
| 13. Editor-Agent Named Action | 3/3 | Complete   | 2026-06-02 |
| 14. Do-It-Here Action Loop | 4/4 | Complete | 2026-06-03 |
| 15. Cockpit IA Redesign | 3/3 | Complete | 2026-06-03 |

---
*Roadmap defined: 2026-05-07 · v1.0.0 milestone archived: 2026-06-01 · v1.4.0 milestone added 2026-06-01, shipped v1.4.2 2026-06-03 · v1.5.0 milestone added 2026-06-03 (Phases 16–18)*
