# Requirements: Clarity Pack — v1.5.0 Truthful & Legible Situation Room

**Defined:** 2026-06-03 (re-aligned to the locked-scope memory `v150-scope-locked` after the initial roadmap mis-scoped 16-18; the locked scope is 16-20 with a structured-human-wait centerpiece).
**Core Value:** Zero rabbit-holes — every blocker chain transitively flattened to a single named human action the operator can act on, in plain English a non-builder understands.

**Milestone goal:** Make the Situation Room load instantly and tell the truth a non-builder can read — agents declare human-waits *structurally* (so the engine honestly classifies needs-you), every surface routes to plain-English Reader views with zero raw ids, and the Editor named-action prose goes live via a safe off-request (flag-gated) action-card path.

**Locked decisions (from `v150-scope-locked`):** "usable for everyone" = LEGIBLE-for-non-builders, NOT multi-operator (keep the existing Phase-2 opt-in toggle; no multi-operator/onboarding investment). Action-cards: IN, re-architected (off-request, non-notifying op-issues), sequenced LAST, behind the flag, slip-safe to v1.6. Deploy: continuous to BEAAA, risky features flag-gated; PREREQUISITE = automated DO backups ON (the bookend for no-downtime continuous deploy).

**Carried invariants (all phases):** additive-only plugin-namespace schema; degrade-safe deterministic floor (no AI dependency); instance-agnostic (no company-prefix literals); Editor-Agent governance parity; `blocker-chain.ts` purity (determinism + AI-token guards).

**Already partially delivered by the v1.4.3 incident hotfix (2026-06-03):** PERF — removed ~4,192 fake-ref 404 DB lookups + the dead-scope bulletin churn (helps SNAP but does not fix the 25.7s cold recompute); LEG — the prefix-gate kills fake-ref id leakage (partial NO-RAW-IDS); HYG — version label refreshed to 1.4.3, the chat-watchdog timing flake is now a known item.

## v1 Requirements

### Snapshot performance & honest loading (Phase 16)

- [x] **SNAP-01**: The Situation Room cockpit loads fast — the snapshot returns well under the 30s host timeout (target p95 < ~5s) and never 502s, including a cold cache.
- [x] **SNAP-02**: The cold snapshot recompute no longer approaches the 30s cliff (the live 25.7s near-miss is eliminated); the employees rollup is degrade-safe (a slow/failed sub-read floors to the deterministic line, never blocks the view).
- [x] **SNAP-03**: Confirm-first step — verify whether the room still 502s now that action-cards are gated, and record the cold/warm snapshot timings as the phase baseline. (Done 2026-06-03: no 502, 6/6 snapshot calls 200, cold 25.7s — drives SNAP-01/02.)

### Editor-Agent loop elimination & wake governor — URGENT make-safe (Phase 16.1)

- [x] **LOOP-01**: Event handlers perform NO agent wakeups — observe-only ingress. Every agent run originates from the agent's own heartbeat/cron pulling a durable queue, not from a `requestWakeup`/dispatch fired inside an event handler.
- [x] **LOOP-02**: The loop is broken by construction — a Clarity-authored "operation" can never re-enter and re-trigger Clarity's own event-reactive compilation, with provenance that survives a worker restart (no in-memory-only guard as the primary defense).
- [x] **LOOP-03**: A durable, env-controlled GLOBAL wake-rate governor + kill-switch bounds agent wakeups by THROUGHPUT (max N/min), trips on volume (not just consecutive failures), and survives restart.
- [x] **LOOP-04**: Event ingress is gated on opt-in / active-company scope at the subscription, before any host call or work — "default OFF" actually throttles the worker, not just the UI.
- [x] **LOOP-05**: Falsifiable storm-safety test — a simulated burst of issue/comment events (including the plugin's own op-issue + agent result writes) across a simulated worker restart asserts bounded agent-wakes/min and zero self-trigger recursion.
- [x] **LOOP-06**: The read-time "zero rabbit-holes" guarantee is regression-proofed — inline ref resolution, blocker-chain flatten, and deliverable preview remain fully functional and untouched by the loop fix.
- [x] **LOOP-07**: Live make-safe verification — the corrected build is reinstalled on BEAAA (bookended by a verified DO snapshot) and a live drill proves that creating/changing an issue and dispatching an agent task does NOT produce a CPU storm or multi-agent wake cascade (Clarity worker stays near-idle; wakes stay within the governor ceiling; no 502).

### Structured human-wait + truthful verdicts — CENTERPIECE (Phase 17)

- [x] **WAIT-01**: Agents have a STRUCTURED way to declare "blocked on a human decision X" (a machine-readable signal, not free prose the engine cannot parse).
- [x] **WAIT-02**: The deterministic engine classifies a structured human-wait as AWAITING_HUMAN (needs-you), instead of conservatively parking it in Watch — the deep fix behind the BEAAA-972 confusion.
- [x] **WAIT-03**: Every blocked-no-edge class is classified truthfully (the BEAAA-972 family: blocked+agent-owned, blocked+human-owned, blocked+unowned, structured-human-wait).
- [x] **WAIT-04**: The SC5 cross-surface consistency guard is extended into a FULL matrix (every surface × every terminal kind reads one consistent verdict).

### No rabbit-holes & plain-English (Phase 18)

- [x] **LEG-01**: "Open ↗" routes to the Clarity Reader view (inline-resolved, plain-English), never the raw classic Paperclip issue page (the wall of unresolved inline references).
- [x] **LEG-02**: ZERO raw or partial agent/UUID identifiers in any human-facing text on any surface; every agent reference shows a human name/role (extends NO_UUID_LEAK; the v1.4.3 prefix-gate is the partial start).
- [x] **LEG-03**: A "Looks done — close it?" affordance appears when the AI TL;DR reads done but the deterministic engine still classifies the item as blocked (honest divergence surfaced as an action, not hidden).

### Action-cards async re-architecture — LAST, flag-gated (Phase 19)

- [x] **CARD-01**: Action-card compile runs OFF the request path (not in the snapshot RPC) and writes non-notifying op-issues (no "Someone updated" storm).
- [x] **CARD-02**: `ACTION_CARDS_ENABLED` is re-enabled behind the flag once proven; the Editor named-action prose (what unblocks this + who + ~when) goes live on needs-you rows, stale→degrade intact.
- [x] **CARD-03**: The flag is runtime-safe and slip-safe — OFF degrades to the deterministic floor (room still works); ON yields no snapshot 502 and no notification storm.

### Hygiene & honestly-green CI (Phase 20)

- [x] **HYG-01**: The SC5 full-matrix coverage runs in CI (every surface × every terminal kind).
- [x] **HYG-02**: The 7 CHAT/CTT REQUIREMENTS traceability test failures are resolved (2026-06-15: re-pointed `test/phases/04-traceability.test.mjs` + `04.1-traceability.test.mjs` at `.planning/milestones/v1.0.0-REQUIREMENTS.md`, where the CHAT-01..11 / CTT-01..08 rows live + are marked Implemented; 9/9 green). The active v1.5.0 milestone doc stays free of closed-phase rows.
- [x] **HYG-03**: The load-dependent chat-watchdog timing flake (`U7 WATCHDOG-FIRE-AND-FORGET`) is stabilized (condition-based, not a wall-clock threshold).
- [ ] **HYG-04**: The stale plugin-list version label is refreshed and automated DO backups are confirmed ON (the continuous-deploy bookend prerequisite).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-operator / onboarding / opt-in toggle UI | Locked: "usable for everyone" = legible-for-non-builders, NOT multi-operator. BEAAA is effectively solo; keep the existing Phase-2 opt-in. |
| Re-enabling action-cards without re-architecting | Locked: action-cards must be rebuilt off-request + non-notifying before the flag flips (v1.4.1 gated them for exactly the storm/timeout reasons). |
| Host-side Postgres / agent-concurrency tuning | The BEAAA CPU bursts are host/company-agent driven (v1.4.3 incident finding), a Paperclip-instance concern, not a Clarity milestone. |
| Replacing/forking the Paperclip UI/core; non-additive schema | Coexistence guarantees. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SNAP-01 | Phase 16 | Complete |
| SNAP-02 | Phase 16 | Complete |
| SNAP-03 | Phase 16 | Complete |
| LOOP-01 | Phase 16.1 | Complete |
| LOOP-02 | Phase 16.1 | Complete |
| LOOP-03 | Phase 16.1 | Complete |
| LOOP-04 | Phase 16.1 | Complete |
| LOOP-05 | Phase 16.1 | Complete |
| LOOP-06 | Phase 16.1 | Complete |
| LOOP-07 | Phase 16.1 | Complete |
| WAIT-01 | Phase 17 | Complete |
| WAIT-02 | Phase 17 | Complete |
| WAIT-03 | Phase 17 | Complete |
| WAIT-04 | Phase 17 | Complete |
| LEG-01 | Phase 18 | Complete |
| LEG-02 | Phase 18 | Complete |
| LEG-03 | Phase 18 | Complete |
| CARD-01 | Phase 19 | Complete |
| CARD-02 | Phase 19 | Complete |
| CARD-03 | Phase 19 | Complete |
| HYG-01 | Phase 20 | Complete |
| HYG-02 | Phase 20 | Pending |
| HYG-03 | Phase 20 | Complete |
| HYG-04 | Phase 20 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17 ✓ (16-20)
- Unmapped: 0

---
*Requirements defined: 2026-06-03*
*Last updated: 2026-06-03 — re-aligned to locked-scope memory (16-20, structured-human-wait centerpiece); supersedes the initial 16-18 (LEG/PROSE/PERF) mis-scope.*
