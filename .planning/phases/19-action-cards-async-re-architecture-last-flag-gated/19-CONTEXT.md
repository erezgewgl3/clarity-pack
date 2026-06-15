# Phase 19: Action-cards async re-architecture (LAST, flag-gated) - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Move the Editor-Agent action-card compile OFF the snapshot request path and onto the
governed, non-notifying operation-issue / heartbeat path, then re-enable the existing
(Phase-13-built, currently gated-off) action-card generation behind a runtime flag once
proven — bringing the grounded named-action prose (what unblocks this + who + ~when) live
on needs-you rows without the snapshot 502 or the BEAAA-2092 notification storm.

This is the operator-LOCKED LAST feature phase of v1.5.0 and is slip-safe to v1.6 if it
cannot land cleanly. The action-card *generation* code already exists
(`src/worker/agents/action-cards.ts`, 689 lines, a structural mirror of the bulletin-gloss
step). This phase is mostly **subtraction** (remove the on-request compile site) + a
**careful, reversible flag flip** — NOT new invention.

Out of scope: changing the deterministic engine (`src/shared/blocker-chain.ts` stays
AI-free), the named-action prose content/quality rules (locked in Phase 13: D-07..D-15),
or the 16.1 wake-governor mechanics (reused as-is).
</domain>

<decisions>
## Implementation Decisions

### Flag mechanism (CARD-02, CARD-03)
- **D-01:** Promote `ACTION_CARDS_ENABLED` from a compile-time `const = false`
  (`action-cards.ts:131`) to a **runtime kill-switch backed by a DB row**, mirroring the
  Phase-16.1 `wake_kill_switch` pattern (additive plugin-namespace table). The flag must be
  flippable OFF **live on BEAAA without a redeploy** the instant a storm or 502 is observed.
- **D-02:** Default state is **OFF** (deterministic floor; room unchanged). Reads of the
  flag are cached/cheap and degrade-safe — if the flag row can't be read, treat as OFF.
- **D-03:** The flag is checked at BOTH the compile decision (heartbeat/op-issue: don't
  generate when OFF) AND the render/attach decision (snapshot read: attach cards only when
  ON). OFF at either point → deterministic floor.

### Request-path removal & freshness (CARD-01)
- **D-04:** The `situation.snapshot` DATA handler becomes **read-cached-only** for action
  cards — it READS cached cards from the `action_cards` table and NEVER calls
  `driveActionCardsStep`. Remove the on-request compile site at
  `situation-room.ts:606`. This is the core of CARD-01 (no AI work on the HTTP request path).
- **D-05:** ALL action-card compilation moves to the **governed heartbeat / bounded-warm
  path** already present at `editor.ts:387`, routed through the 16.1 wake-governor
  (`checkAndRecordWake`). No new cron, no new wake path (the cron path is dead — PR #6547).
- **D-06:** Freshness is accepted as **degrade-safe by design**: a brand-new needs-you row
  shows the deterministic floor line until the next governed heartbeat compiles its card.
  No on-request warm compile (rejected — that is exactly the 502 cause). Reuse the
  Phase-16.1 bounded-warm (`<=5` stale rows per heartbeat) cadence so the queue can't storm.

### Non-notifying op-issues (CARD-01)
- **D-07:** Action-card compile op-issues MUST reuse the EXACT Phase-16.1 non-notifying
  provenance path (`own_operation_issues` + governed `checkAndRecordWake` + status-only /
  non-notifying writes) — the same mechanism that made TL;DR compiles quiet. No "Someone
  updated" notification may fire from an action-card op-issue. Verify against the 16.1
  storm-safety guarantees; do not invent a second op-issue path.

### Enablement sequence (CARD-02, CARD-03) — operator-locked
- **D-08:** **Two-step, reversible enablement.** Step 1: ship the re-architecture with the
  flag **OFF** (deterministic floor, room unchanged), deploy to BEAAA bookended by the DO
  backup, and confirm quiet (no storm, snapshot healthy, worker CPU ~0%). Step 2: flip the
  flag **ON via the runtime kill-switch** in a monitored window with the kill-switch armed,
  and watch for storm/502. The two steps are SEPARATE — never couple the unproven re-arch
  with live enablement. The BEAAA-2092 storm history mandates this.

### Surface scope when ON (operator override)
- **D-09:** When ON, the named-action prose renders on needs-you rows across **all four
  surfaces** (Situation Room, Reader, Bulletin, Chat) — NOT Situation-Room-only.
  *(Operator explicitly chose the wider scope over the recommended SR-only.)* Each surface
  keeps its existing deterministic-floor fallback when a card is stale/absent or the flag is
  OFF, so the wider scope does not weaken degrade-safety — it only widens where a FRESH card
  may appear. Planning must confirm each surface's read path attaches the cached card and
  falls back cleanly.

### Carried invariants (every plan must hold)
- **D-10:** Degrade-safe deterministic floor — no AI dependency; `blocker-chain.ts`
  untouched; determinism + AI-token grep guards stay green. NO_UUID_LEAK render-scans extend
  to any new card-render path.
- **D-11:** Additive-only plugin-namespace schema (the kill-switch table); disable/uninstall
  preserves data. Instance-agnostic (no company-prefix literals).
- **D-12:** Two-source version bump (package.json AND src/manifest.ts) per the DEPLOY-RUNBOOK;
  the host reads dist/manifest.js.

### Claude's Discretion
- Exact kill-switch table/column names and repo shape (follow the 16.1 wake_kill_switch repo
  as the template).
- Whether the flag read is per-snapshot or memoized with a short TTL (degrade-safe either way).
- Test structure for the storm-safety + flag-OFF-floor + flag-ON-no-storm assertions.
</decisions>

<specifics>
## Specific Ideas

- "Mirror the 16.1 wake_kill_switch" — the runtime kill-switch is the proven safety primitive;
  reuse its table/repo/degrade-to-safe pattern rather than inventing a new flag system.
- The whole point of the two-step is: if action-cards misbehave live, Eric flips ONE DB row
  and the room is back to the (known-good) deterministic floor with zero deploy latency.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 19 requirements
- `.planning/REQUIREMENTS.md` — CARD-01, CARD-02, CARD-03 (full text + traceability rows)
- `.planning/ROADMAP.md` §"Phase 19" — goal, depends-on, operator-lock-LAST + slip-safe note

### Existing action-card machinery (the code being re-architected)
- `src/worker/agents/action-cards.ts` — the Editor-Agent action-card generation step
  (Phase 13; D-03..D-15 anti-fabrication/degrade rules); `ACTION_CARDS_ENABLED` const at :131
- `src/worker/db/action-cards-repo.ts` — the per-leaf action_cards cache repo
- `src/worker/handlers/situation-room.ts` §585-627 — the on-request compile site to REMOVE
  (:606) + the per-row actionCard attach (read path to KEEP)
- `src/worker/agents/editor.ts` §378-414 — the heartbeat action-card trigger (the off-request
  path to KEEP/route through the governor)

### The safety primitives to reuse (Phase 16.1)
- `.planning/phases/16.1-editor-agent-loop-elimination-wake-governor/16.1-SPEC.md` — wake
  governor + kill-switch + non-notifying op-issue provenance contract
- `src/worker/agents/wake-governor.ts` — `checkAndRecordWake` (governed wake path)
- 16.1 migration (own_operation_issues + wake_ledger + wake_kill_switch) — the kill-switch
  table pattern to mirror for D-01

### Deploy
- DEPLOY-RUNBOOK (two-source version bump; bookended DO backup) — referenced in CLAUDE.md +
  memory `plugin-version-bump-two-sources`, `beaaa-deploy-mechanics`
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `driveActionCardsStep` (action-cards.ts): the full generation step already exists and never
  throws — only the call sites and the enable flag change.
- `wake-governor.ts` `checkAndRecordWake`: the governed wake the heartbeat already uses.
- 16.1 `wake_kill_switch` table + repo: the template for the runtime action-cards kill-switch.
- The per-row `actionCard` attach in situation-room.ts (:621-627) and each surface's
  deterministic-floor fallback already exist — the read paths mostly stand.

### Established Patterns
- Flag-OFF → `cardsBySource = {}` → every row degrades to `blockerChain.humanAction` /
  `awaitedPartyLabel` (the deterministic line). Degrade-safety is already structural.
- Non-notifying op-issue writes via 16.1 provenance — the proven quiet-write path.

### Integration Points
- Snapshot read path (situation-room.ts) — becomes read-only on cards.
- Editor heartbeat (editor.ts:387) — the sole compile trigger, governed.
- The kill-switch repo — new additive table, read at compile + attach decisions.
- Reader / Bulletin / Chat surface read paths — confirm card attach + floor fallback (D-09).
</code_context>

<deferred>
## Deferred Ideas

- Per-surface card-quality tuning / richer decision-option chips beyond Phase 13's
  conservative binary — out of scope; Phase 13 rules stand.
- Any change to the deterministic engine classification — explicitly NOT this phase.

None block planning — scope stayed within CARD-01/02/03.
</deferred>

---

*Phase: 19-action-cards-async-re-architecture-last-flag-gated*
*Context gathered: 2026-06-15*
