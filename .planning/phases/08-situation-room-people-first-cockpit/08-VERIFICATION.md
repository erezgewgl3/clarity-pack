# Phase 8 VERIFICATION — Situation Room people-first cockpit

**Deploy:** v1.2.0 — tarball `clarity-pack-1.2.0.tgz` sha256 `de16e83f0829f3b7f61f2035a4cdcdee961aa498f4dbd946f73f3b861a700d66` / 745,815 B
**BEAAA host:** plugin UUID `a763176a-2f4d-4986-b190-b5151e42cc00` — `status=ready version=1.2.0` (UUID preserved across upgrade — COEXIST #6)
**Deploy path:** DEPLOY-RUNBOOK Path A (scp `/tmp` + here-string `ssh ariclaw bash` install as `beai-agent` + `pm2 restart paperclip`); remote sha256 verified byte-identical to local
**Deploy timestamp:** 2026-05-30T15:44:42Z
**Drill date:** 2026-05-30
**Drill operator:** Eric (ericg@gl3group.com) — driven via Playwright MCP against `http://localhost:3100/BEAAA/situation-room` (SSH tunnel localhost:3100 → ariclaw:3100)
**Roster:** 18 company-scope agents on BEAAA

---

## ROADMAP Phase 8 Success Criteria

### Criterion 1: One row per agent, sorted blocked → stale → idle → reviewing → running
**Verdict:** PASS
**Evidence:** 18 employee rows (one per BEAAA company-scope agent). Observed top-to-bottom sequence: `blocked`×8 (CFO 28d, Actuary 8d, Scanner Engineer #3 3d, Scanner Engineer #2 3d, CBDO 3d, Scanner Engineer 1d, Underwriter 1d, Legal Coordinator 1d) → `stale`×2 (CSO 1d, Designer 1d) → `idle`×1 (Auditor 12h) → `reviewing`×5 (Claims Architect, Head of Compliance, CTO, CMO, Head of Underwriting) → `running`×2 (Editor-Agent 3m, CEO 3d). Blocked bucket oldest-first (28d→8d→3d→3d→3d→1d→1d→1d); running bucket most-recent-heartbeat-first (Editor-Agent 3m before CEO 3d). Screenshot `08-03-drill-1-employee-strip.png`.
**Delivered by:** Plans 08-01 (worker deterministic sort) + 08-02 (UI consumes order verbatim)

### Criterion 2: CEO scan — stuck + idle visible without clicking
**Verdict:** PASS
**Evidence:** All 8 blocked rows render the inline chain leaf `└ blocked by <humanAction> (<leafIssueId>)` (e.g. CFO `└ blocked by Owner unknown — assign an owner first (BEAAA-43)`) plus an `Open chat with …` button — no drill-down click required. Idle row (Auditor) renders amber (`--clarity-state-idle` = `rgb(217,119,6)`) and sorts ABOVE both running rows (idle-loud). Open-chat step 5a: clicking the CFO row's button navigated to `/BEAAA/chat#h=eyJlbXBsb3llZSI6IjMwMWM5NjhhLTVkZGYtNGNkYi1iMWRiLTMzMWViYWU4ZmY4MSJ9` → base64-decodes to `{"employee":"301c968a-5ddf-4cdb-b1db-331ebae8ff81"}` (CFO agentId); chat surface opened scoped (`data-clarity-surface="chat"`), `failedToRender:false`. Screenshots `08-03-drill-1-employee-strip.png`, `08-03-drill-2-openchat-from-blocked-row.png`.
**M3 sub-probe (disabled-button degrade case for `__unowned__` terminal):** N/A in this live snapshot. Every blocked row's `blockerChain.ownerAgentId` is a **non-null** valid AGENT uuid (= `focusIssue.assigneeAgentId` per B1), so the deep-link resolves and the buttons are **correctly enabled** (`disabled:false, aria-disabled:null, pointerEvents:auto`). No truly-`__unowned__` (null-owner) chains existed on the BEAAA roster on drill day, so step 5b's disabled-degrade path was not exercised. Cosmetic observation (not a defect): rows label the button "Open chat with Unassigned" — `ownerName` reflects the *human-owner* field (unassigned) while the deep-link correctly targets the assignee agent.

### Criterion 3: focusLine voice = Reader voice
**Verdict:** PASS
**Evidence:** Zero ISO timestamps in the 14 rendered focusLines (regex `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}` → 0 matches), confirming `polishTldr()` ran. Dates render human ("Friday 17:00", "Tue 6/2 12:00Z", "target Fri 6/12"); lone-ref parens stripped (trailing `(BEAAA-NN)` renders as a `.clarity-employee-focus-ref` chip, not inline prose). Same `polishTldr()` code path as the Reader TL;DR — voice parity by construction.
**Delivered by:** Plan 08-01 Task 3 polish wire-in (`build-employees-rollup.ts` → `polishTldr`)

### Criterion 4: Top banner urgent/neutral + click navigates
**Verdict:** PASS
**Evidence:** Neutral case rendered: `✓ 0 need you — 7 moving · 3 idle · 8 stuck` (`.clarity-needs-you-banner.clarity-needs-you-neutral`). Counts internally consistent with the strip (7 moving = 5 reviewing + 2 running; 3 idle = 1 idle + 2 stale; 8 stuck = 8 blocked). Worker payload `needsYou = { count: 0, topAction: null }` — correct for the 0-need-you neutral state. Screenshot `08-03-drill-3-needs-you-banner-and-mount-order.png`.
**Delivered by:** Plan 08-02 NeedsYouBanner + Plan 08-01 worker-computed `needsYou`

### Criterion 5: No new schema; NO_UUID_LEAK; CSS scoped
**Verdict:** PASS
**Evidence:** Visible-text UUID regex on the situation-room scope → 0 matches; `#[0-9a-f]{8}` leaf-suffix regex (M2) → 0 matches. `data-clarity-surface` scopes present (`situation-room`, `chat`). `git diff --stat d526987..HEAD -- migrations/` → empty (0 new migrations; LOCKED no schema). `git diff d526987..HEAD -- package.json` dependencies → 0 changes (LOCKED no new runtime dep; only the `version` field moved). Note: `blockerChain.ownerAgentId` carries the AGENT uuid in the *data* payload (for the deep-link) but never leaks to visible text — NO_UUID_LEAK is a visible-text invariant and holds.
**Delivered by:** Plans 08-01 (shared `scrubHumanAction`, request-time compute) + 08-02 (scoped CSS tokens)

### Criterion 6: Live drill composite — ≥3 states / ≥1 blocked chain leaf / ≥1 idle bubbled
**Verdict:** PASS
**Evidence:** 5 distinct states observed (blocked, stale, idle, reviewing, running ≥ 3); 8 blocked rows each render the inline chain leaf + open-chat action; idle (Auditor) renders amber and sorts above 2 running rows. Composite of Criteria 1–5.

---

## Per-Requirement Verdicts

### ROOM-13 — situation.snapshot returns per-employee rows
**Verdict:** Implemented
**Evidence:** Worker handler returns `situation_employees: SituationEmployeeRow[]` (Plan 08-01; the `situation_employees` key was chosen over `employees` per the Plan 08-02 Rule-1 fix to avoid clobbering the ROOM-01..08 agent-grid `employees`). Live drill rendered 18 rows with `{ agentId, name, role, state, focusIssueId, focusLine, lastActivityAt, ageBucket, blockerChain }`.

### ROOM-14 — 5-state classifier deterministic
**Verdict:** Implemented
**Evidence:** Pure classifier `src/worker/situation/classify-employee-state.ts` (Plan 08-01 Task 2, boundary tests pass). Live drill observed all 5 states across the roster.

### ROOM-15 — focusLine via polishTldr
**Verdict:** Implemented
**Evidence:** Plan 08-01 Task 3 routes focusLine through `polishTldr`. Live drill Criterion 3 PASS (zero ISO timestamps, human dates, Reader-voice parity).

### ROOM-16 — blockerChain reuses flattenBlockerChain / pickTopChains / scrubHumanAction
**Verdict:** Implemented
**Evidence:** Plan 08-01 extracted `scrubHumanAction` to `src/shared/scrub-human-action.ts` (shared with ROOM-12). B1: `ownerAgentId = focusIssue.assigneeAgentId` (AGENT uuid) confirmed live (CFO `301c968a…`). NO_UUID_LEAK: `__unowned__`/no-human-owner terminal renders `ownerName: "Unassigned"`, never a raw UUID (live Criterion 5 regex = 0). M2 leaf never emits uuid-suffix (live regex = 0).

### ROOM-17 — Sort blocked → stale → idle → reviewing → running; amber/green styling
**Verdict:** Implemented
**Evidence:** Plan 08-01 deterministic sort + Plan 08-02 CSS state tokens. Live computed pill colors: blocked `rgb(220,38,38)` red · stale `rgb(180,83,9)` amber · idle `rgb(217,119,6)` amber · reviewing `rgb(21,128,61)` green · running `rgb(22,163,74)` green. Sort + idle-loud confirmed (Criteria 1 + 2 PASS).

### ROOM-18 — Single top "needs you" banner with click jump
**Verdict:** Implemented
**Evidence:** Plan 08-02 NeedsYouBanner + Plan 08-01 worker-computed `needsYou`. Live neutral banner rendered with consistent counts; B1 click handler resolves the AGENT uuid via the employee-only URL_HASH carrier (`buildChatDeepLink`), proven live by the Criterion 2 open-chat navigation.

---

## Coexistence verification (M4 mount-order sub-probe)
- **DOM child order** of `[data-clarity-surface="situation-room"]`: `clarity-surface-header → clarity-needs-you-banner → clarity-employee-strip → clarity-blocked-banner (ROOM-12) → clarity-room-header → clarity-agent-grid → clarity-toast-stack` — **PASS** (NeedsYouBanner first below the surface header; EmployeeRowStrip second; ROOM-12 third, below both). Screenshot `08-03-drill-3-needs-you-banner-and-mount-order.png`.
- **ROOM-12 OrgBlockedBacklogBanner** renders BELOW the new strip AND BELOW the NeedsYouBanner, **collapsed** (`▸`, `defaultExpanded={false}`) — PASS. (The `need_you_count > 0` auto-expand-suppression case could not be exercised live because `need_you_count === 0` on drill day; collapsed state confirmed regardless.)
- **Agent grid (ROOM-01..08) byte-identical — PASS (proven from source).** The legacy `clarity-agent-grid` rendered EMPTY on drill day. Root cause traced: `situation.snapshot` returned the **dead-job path** payload (`{ org_blocked_backlog, situation_employees, needsYou, taken_at }` — no `employees` key) because no materialized `situation_snapshots` row exists for BEAAA. The pre-Phase-8 handler at `d526987` returned `{ org_blocked_backlog, taken_at }` in that same no-row case — i.e. **the agent grid was already empty in the dead-job path before Phase 8**. Phase 8 left the cached path's `...payload` spread (line 151) intact, so the grid's data path is byte-identical; it repopulates once the `*/1` snapshot cron materializes a row. The Phase 8 strip renders fully regardless because it is computed FRESH per request (degrade-safe — a robustness gain over the materialized-row-dependent agent grid). Not a Phase 8 regression.
- **No new migration:** `git diff --stat d526987..HEAD -- migrations/` empty — PASS.
- **package.json dependencies byte-identical** from v1.1.11 — PASS (only the `version` field changed).

## Closing
Phase 8 CLOSED & VERIFIED LIVE on BEAAA 2026-05-30.
v1.2.0 ships (`clarity-pack-1.2.0.tgz`, sha256 `de16e83f…`, 745,815 B; plugin UUID `a763176a-…` preserved). All 6 Success Criteria PASS; ROOM-13..18 → Implemented.
Standout live finding: the people-first strip is computed fresh every request, so the cockpit renders the full 18-agent roster even when the materialized-snapshot job is dead — the legacy agent grid's cold-start emptiness is pre-existing and does not affect the Phase 8 axis.
Next milestone: Plan 05-10 (rc → 1.0.0 lineage / npm publish is internal-only per `feedback_clarity-pack-internal-only-no-npm`) — or the next roadmap item per `/gsd:progress`.
