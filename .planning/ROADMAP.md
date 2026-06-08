# Roadmap: Clarity Pack

**Created:** 2026-05-07
**Core Value:** Zero rabbit-holes — every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place.

## Milestones

- ✅ **v1.0.0 — v1 Final Internal** — Phases 1–9 (shipped 2026-06-01, final version v1.3.0 live on BEAAA)
- ✅ **v1.4.0 — Truthful Situation Room** — Phases 10–15 (shipped v1.4.2, live-verified BEAAA 2026-06-03)
- ▶ **v1.5.0 — Truthful & Legible Situation Room** — Phases 16–20 (active; continues phase numbering)

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

### ▶ v1.5.0 — Truthful & Legible Situation Room (Phases 16–20)

Make the Situation Room load instantly and tell the truth a non-builder can read. The Situation Room must (1) load fast and honestly before truthful verdicts can matter, (2) let agents declare human-waits *structurally* so the deterministic engine honestly classifies needs-you (the deep BEAAA-972 fix — the milestone centerpiece), (3) route every surface to plain-English Reader views with zero raw ids, then (4) ship the Editor-Agent named-action prose live via a safe off-request (flag-gated) action-card path, with (5) honestly-green CI behind it.

**Sequence is operator-LOCKED: 16 → 17 → 18 → 19 → 20.** Snapshot perf first (the cockpit must load fast/honestly before truthful verdicts matter); the structured-human-wait centerpiece next (it depends on the honest rollup); plain-English surfaces consume those truthful verdicts; the action-card re-architecture comes LAST and flag-gated (slip-safe to v1.6); hygiene/CI closes the full SC5 matrix and may run alongside.

**Live driver (2026-06-03):** with action-cards gated OFF (v1.4.1 hotfix), the room no longer 502s (6/6 snapshot calls 200) but cold snapshot recompute is **25.7s** — within ~4s of the 30s host-timeout cliff. The confirm-first step is already done (no 502, cold 25.7s) → Phase 16 targets the 25.7s cold recompute + degrade-safety. The BEAAA-972 confusion (agents expressing human-waits as free prose the engine cannot parse, so they park in Watch instead of Needs-you) → Phase 17 centerpiece.

**Partially delivered by the v1.4.3 incident hotfix (2026-06-03):** Phase 16 (removed ~4,192 fake-ref 404 DB lookups + dead-scope bulletin churn — helps load but does NOT fix the 25.7s cold recompute), Phase 18 (prefix-gate kills fake-ref id leakage — partial NO-RAW-IDS), Phase 20 (version label refreshed to 1.4.3; the chat-watchdog timing flake is a known HYG-03 item). These are noted in the relevant success criteria so they are not re-done wholesale.

**Reusable input:** `.planning/phases/_superseded-legibility-16-18-misscope/` holds the OLD 16-18 mis-scope's research / patterns / plans (verdict-wording shared helper, focusLine-from-tldr enrichment, chat-chip humanization). That work is sound legibility/prose input — Phases 17 and 18 should mine it rather than start from scratch.

- [x] **Phase 16: Snapshot performance & honest loading** — cockpit loads fast (snapshot well under the 30s timeout, target p95 < ~5s, never 502s); eliminate the 25.7s cold recompute near-cliff; employees rollup degrade-safe. Confirm-first baseline already recorded. FIRST. (completed 2026-06-03)
- [ ] **Phase 16.1: Editor-Agent loop elimination & wake governor (URGENT — make Clarity safe to run)** — INSERTED 2026-06-04 after a production incident: installing Clarity made the live BEAAA instance unusable (every issue/agent/task change drove CPU up + woke 4-5 agents). Root cause = a closed positive-feedback loop (event-reactive op-issue creation + `requestWakeup` whose own writes re-enter the instance-wide event subscription). Eliminate the loop by construction, add a durable throughput wake-governor + kill-switch, and gate ingress on opt-in/scope — while leaving the read-time "zero rabbit-holes" guarantee untouched. Hard prerequisite to reinstalling Clarity on BEAAA; blocks 17–20.
- [ ] **Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE)** — a machine-readable "blocked on a human decision X" signal so the deterministic engine classifies AWAITING_HUMAN instead of parking in Watch (the deep BEAAA-972 fix); every blocked-no-edge class classified truthfully; SC5 extended to a full surface × terminal-kind matrix.
- [ ] **Phase 18: No rabbit-holes & plain-English** — "Open ↗" routes to the Clarity Reader (not the raw classic page); ZERO raw/partial agent/UUID ids in human-facing text everywhere; "Looks done — close it?" affordance when the AI TL;DR reads done but the engine still says blocked.
- [ ] **Phase 19: Action-cards async re-architecture (LAST, flag-gated)** — action-card compile off the request path writing non-notifying op-issues; re-enable `ACTION_CARDS_ENABLED` behind the flag once proven; Editor named-action prose live on needs-you rows; runtime-safe + slip-safe to v1.6.
- [ ] **Phase 20: Hygiene & honestly-green CI** — SC5 full-matrix in CI; fix the 7 CHAT/CTT traceability failures; stabilize the chat-watchdog timing flake; refresh the version label; confirm automated DO backups (the continuous-deploy bookend).

## Phase Details (v1.5.0)

### Phase 16: Snapshot performance & honest loading
**Goal**: The Situation Room cockpit loads fast and honestly — the snapshot returns well under the 30s host timeout even on a cold cache, never 502s, and a slow or failed sub-read floors to the deterministic line rather than blocking the whole view.
**Depends on**: Nothing new (opening phase of v1.5.0; continues numbering from Phase 15). Builds on the v1.4.0 deterministic engine + rollup already in place. Confirm-first baseline (SNAP-03) already recorded 2026-06-03.
**Requirements**: SNAP-01, SNAP-02, SNAP-03
**Success Criteria** (what must be TRUE):
  1. A cold-cache Situation Room view returns well under the 30s host timeout (target p95 < ~5s) and never 502s — the live 25.7s cold-recompute near-cliff is eliminated.
  2. The employees rollup is degrade-safe per row: a slow or failed sub-read floors to the deterministic line and never blocks or blanks the view.
  3. The confirm-first baseline is recorded as the phase's starting point (done 2026-06-03: no 502, 6/6 snapshot calls 200, cold 25.7s) and drives the SNAP-01/02 targets — the v1.4.3 hotfix's removal of ~4,192 fake-ref 404 lookups + dead-scope bulletin churn is acknowledged as a partial contribution, NOT a fix for the 25.7s cold recompute.
  4. The fix is instance-agnostic (no company-prefix literals) and additive-only (plugin-namespace schema; disable/uninstall preserves data), shipped via continuous flag-gated BEAAA deploy bookended by the automated DO backup.
**Plans**: 4 plans
- [x] 16-01-PLAN.md — Wave-0: lock live snake_case columns + relations.get timeoutMs reachability; ship the hand-rolled mapBounded pool + withDeadline floor (+ tests)
- [x] 16-02-PLAN.md — Wave A: collapse the N+1 fan-out — SQL-prefetch the blocked list/roster/names + compute the blocker BFS once shared across both builders; per-stage timing
- [x] 16-03-PLAN.md — Wave B: bound the irreducible relations.get with mapBounded + per-call deadline floor + overall snapshot budget; floor slow/hung rows to the deterministic UNCLASSIFIED line (degrade-safe, DoS-resistant)
- [x] 16-04-PLAN.md — Wave C: serve-last-good SWR via the existing situation_snapshots table (viewer-invariant slice, per-call needsYou recompute, no cross-viewer leak) + the bookended live BEAAA cold/warm drill vs the 25.7s baseline
**UI hint**: yes

### Phase 16.1: Editor-Agent loop elimination & wake governor (URGENT — make Clarity safe to run)
**Goal**: Make Clarity Pack safe to run on the live instance by eliminating the event-amplification feedback loop that made BEAAA unusable — so that installing Clarity and changing/creating any issue, agent, or task does NOT drive a self-sustaining storm of agent wakeups.
**Depends on**: Phase 16 (reuses the SWR serve-last-good cache so the shift from push-reactive to pull/lazy compilation has near-zero user-visible latency cost).
**Why now**: Production incident 2026-06-04 — Clarity uninstalled because every change spun 4-5 agents and pinned host CPU. Same storm class recurred across v0.6.5 / v1.4.1 (BEAAA-2092) / bulletin 2-min runaway / v1.4.4 despite repeated filter hardening → strategy shifts from mitigate-with-filters to eliminate-the-loop-by-construction. This is a hard prerequisite to reinstalling Clarity; 17–20 cannot ship onto a plugin that bricks the box.
**Locked value boundary**: the read-time "zero rabbit-holes" guarantee (inline ref resolution, blocker-chain flatten, deliverable preview) is synchronous/local and MUST remain untouched. The fix targets only the PROACTIVE COMPILATION machinery (TL;DR/bulletin/action-cards): proactive compile must be PULL-based + SCOPED + SWR-served, never PUSH-based + instance-wide. KEEP scheduled proactivity (daily bulletin cron + bounded warm-on-heartbeat for awaiting-you rows). Action-cards stays gated OFF (its re-enable remains Phase 19).
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06
**UI hint**: no (worker-tier architecture; no new surfaces)
**Plans**: 6 plans
Plans:
- [x] 16.1-01-PLAN.md — Wave 1: additive migration 0017 (own_operation_issues + wake_ledger + wake_kill_switch) + three durable repos
- [x] 16.1-02-PLAN.md — Wave 2: wake-governor (throughput + kill-switch) + durable provenance write + requestWakeup removal in the delivery path
- [x] 16.1-03-PLAN.md — Wave 3: observe-only ingress + opt-in/active-company scope gate + lazy company seed + company.created/chat-bridge dispositions + dispatcher disposition
- [x] 16.1-04-PLAN.md — Wave 4: bounded warm-on-heartbeat (<=5 SWR-stale awaiting-you TL;DRs) + scope-gated/governed bulletin cron
- [ ] 16.1-05-PLAN.md — Wave 5: storm-safety CI test + no-wake static gate + opt-in-ingress test + LOOP-06 read-time no-touch regression guard
- [ ] 16.1-06-PLAN.md — Wave 6: two-source version bump + rebuild + bookended live BEAAA reinstall & no-storm drill (LOOP-07)

### Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE)
**Goal**: Give agents a structured, machine-readable way to declare "blocked on a human decision X" so the deterministic engine honestly classifies it as AWAITING_HUMAN (needs-you) instead of conservatively parking it in Watch — the deep fix behind the BEAAA-972 confusion — and prove every blocked-no-edge class is classified truthfully across a full surface × terminal-kind matrix.
**Depends on**: Phase 16 (consumes the honest, degrade-safe rollup — the structured-wait verdict must surface in a snapshot that actually loads). Reuses the superseded 16-18 verdict-wording shared-helper input where it informs the classification surface.
**Requirements**: WAIT-01, WAIT-02, WAIT-03, WAIT-04
**Success Criteria** (what must be TRUE):
  1. An agent can declare a human-wait through a STRUCTURED, machine-readable signal (not free prose the engine cannot parse) — the structured declaration is captured additively in the plugin namespace.
  2. The deterministic engine classifies a structured human-wait as AWAITING_HUMAN (needs-you) and it surfaces in the Needs-you tier, no longer parked conservatively in Watch — the BEAAA-972 row reads needs-you everywhere.
  3. Every blocked-no-edge class in the BEAAA-972 family is classified truthfully: blocked+agent-owned, blocked+human-owned, blocked+unowned, and structured-human-wait each resolve to their honest terminal kind.
  4. The SC5 cross-surface consistency guard is extended into a FULL matrix — every surface × every terminal kind reads one consistent verdict — and `blocker-chain.ts` stays pure (determinism + AI-token grep guards pass; no AI introduced into the engine).
**Plans**: TBD
**UI hint**: yes

### Phase 18: No rabbit-holes & plain-English
**Goal**: Make every Clarity surface legible to a non-builder consuming Phase 17's truthful verdicts — "Open ↗" routes to the plain-English Clarity Reader instead of the raw classic page, no raw or partial machine identifier ever renders in human-facing text, and the honest divergence between the AI TL;DR and the engine verdict is surfaced as a "Looks done — close it?" action rather than hidden.
**Depends on**: Phase 17 (consumes the truthful per-row verdicts so the plain-English surfaces and the "looks-done vs blocked" divergence read off honest classification). Reuses the superseded 16-18 input (focusLine-from-tldr enrichment, chat-chip humanization, verdict-wording helper).
**Requirements**: LEG-01, LEG-02, LEG-03
**Success Criteria** (what must be TRUE):
  1. "Open ↗" routes to the Clarity Reader view (inline-resolved, plain-English) on every surface — never the raw classic Paperclip issue page (the wall of unresolved inline references).
  2. ZERO raw or partial agent/UUID identifiers appear in any human-facing text on any of the four surfaces; every agent reference shows a human name or role. This extends NO_UUID_LEAK to partial-hash labels and builds on the v1.4.3 prefix-gate (the partial start) — the gate's contribution is acknowledged, not re-done wholesale, and a named regression guard fails the build on a partial-hash/short-hex leak.
  3. A "Looks done — close it?" affordance appears whenever the AI TL;DR reads done but the deterministic engine still classifies the item as blocked — the divergence is surfaced as an explicit action, never silently hidden.
  4. The legibility work stays degrade-safe and instance-agnostic (no company-prefix literals); enum/code tokens (e.g. `AWAITING_AGENT_STUCK`) are never shown as user-visible text.
**Plans**: TBD
**UI hint**: yes

### Phase 19: Action-cards async re-architecture (LAST, flag-gated)
**Goal**: Move the Editor-Agent action-card compile off the snapshot request path and onto non-notifying operation-issues, then re-enable `ACTION_CARDS_ENABLED` behind a runtime flag once proven — bringing the grounded named-action prose (what unblocks this + who + ~when) live on needs-you rows without the snapshot 502 or the BEAAA-2092 notification storm.
**Depends on**: Phases 16–18. By operator lock this is the LAST feature phase: snapshot perf (16), the truthful structured-wait engine (17), and the legible surfaces (18) must land first so the action-card re-arch targets a known-good, fast, legible surface. Slip-safe to v1.6 if it cannot land cleanly.
**Requirements**: CARD-01, CARD-02, CARD-03
**Success Criteria** (what must be TRUE):
  1. The action-card compile runs OFF the request path (not inside the snapshot RPC) and writes non-notifying operation-issues — no "Someone updated" notification storm (no recurrence of BEAAA-2092).
  2. `ACTION_CARDS_ENABLED` is re-enabled behind the flag once proven, and the Editor-Agent's grounded named-action prose (what unblocks this + who + ~when) renders live on needs-you rows with the stale→degrade floor intact.
  3. The flag is runtime-safe and slip-safe: OFF degrades to the deterministic floor (the room still works); ON yields no snapshot 502 and no notification storm — both states ship via continuous flag-gated BEAAA deploy bookended by the automated DO backup.
  4. The Editor-Agent stays within governance parity (standard caps, pause/terminate, audit) and the deterministic floor keeps zero AI dependency, so the surfaces render honestly when the Editor-Agent is down.
**Plans**: TBD
**UI hint**: yes

### Phase 20: Hygiene & honestly-green CI
**Goal**: Make CI honestly green and the deploy bookend confirmed — the SC5 full-matrix coverage runs in CI, the known test-debt (7 CHAT/CTT traceability failures + the chat-watchdog timing flake) is resolved, the stale version label is refreshed, and automated DO backups are confirmed ON as the continuous-deploy bookend prerequisite.
**Depends on**: Phase 17 (the SC5 full surface × terminal-kind matrix it codifies in CI). May run alongside the later feature phases; closes the milestone's test-debt and deploy-bookend gates.
**Requirements**: HYG-01, HYG-02, HYG-03, HYG-04
**Success Criteria** (what must be TRUE):
  1. The SC5 full-matrix coverage (every surface × every terminal kind reads one consistent verdict) runs in CI as a standing guard.
  2. The 7 CHAT/CTT REQUIREMENTS traceability test failures are resolved — re-pointed at the v1.0.0-REQUIREMENTS.md archive (the rows were archived there) or formally accepted — so the suite is honestly green, not green-by-skip.
  3. The load-dependent chat-watchdog timing flake (`U7 WATCHDOG-FIRE-AND-FORGET`) is stabilized to a condition-based assertion (not a wall-clock threshold) — the known HYG-03 item flagged by the v1.4.3 hotfix.
  4. The stale plugin-list version label is refreshed (continuing the v1.4.3 partial refresh) and automated DO backups are confirmed ON — the bookend that makes continuous flag-gated BEAAA deploy safe (version-bump BOTH package.json AND src/manifest.ts per DEPLOY-RUNBOOK).
**Plans**: TBD

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
| v1.5.0 — Truthful & Legible Situation Room | 16–20 | ▶ Active | — |

### v1.5.0 phase tracking

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 16. Snapshot performance & honest loading | 4/4 | Complete   | 2026-06-03 |
| 16.1 Editor-Agent loop elimination & wake governor (URGENT) | 4/6 | In Progress|  |
| 17. Structured human-wait + truthful verdicts | 0/TBD | Not started | - |
| 18. No rabbit-holes & plain-English | 0/TBD | Not started | - |
| 19. Action-cards async re-architecture | 0/TBD | Not started | - |
| 20. Hygiene & honestly-green CI | 0/TBD | Not started | - |

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
*Roadmap defined: 2026-05-07 · v1.0.0 milestone archived: 2026-06-01 · v1.4.0 milestone added 2026-06-01, shipped v1.4.2 2026-06-03 · v1.5.0 milestone added 2026-06-03; re-roadmapped 2026-06-03 from a 3-phase (16-18 LEG/PROSE/PERF) mis-scope to the locked 5-phase 16-20 structure (SNAP/WAIT/LEG/CARD/HYG) with the structured-human-wait centerpiece*
