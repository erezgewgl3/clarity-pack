# Phase 19: Action-cards async re-architecture (LAST, flag-gated) - Research

**Researched:** 2026-06-15
**Domain:** Worker-tier re-architecture — move action-card AI compile off the HTTP request path onto the governed heartbeat; promote a compile-time const to a runtime DB-backed kill-switch; four-surface read/attach.
**Confidence:** HIGH (every claim below is grounded in the shipped codebase, read this session; the only MEDIUM items are the two-step live-enable drill outcomes, which are inherently empirical).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Promote `ACTION_CARDS_ENABLED` from compile-time `const = false` (`action-cards.ts:131`) to a **runtime kill-switch backed by a DB row**, mirroring the Phase-16.1 `wake_kill_switch` pattern (additive plugin-namespace table). Flippable OFF **live on BEAAA without a redeploy**.
- **D-02:** Default state **OFF** (deterministic floor; room unchanged). Flag reads cached/cheap and **degrade-safe — unreadable flag row ⇒ treat as OFF.**
- **D-03:** Flag checked at BOTH the **compile decision** (heartbeat/op-issue: don't generate when OFF) AND the **render/attach decision** (snapshot read: attach cards only when ON). OFF at either point → deterministic floor.
- **D-04:** `situation.snapshot` DATA handler becomes **read-cached-only** for action cards — READS cached cards from `action_cards`, NEVER calls `driveActionCardsStep`. Remove the on-request compile site at `situation-room.ts:606`. Core of CARD-01.
- **D-05:** ALL compilation moves to the **governed heartbeat / bounded-warm path** at `editor.ts:387`, routed through the 16.1 wake-governor (`checkAndRecordWake`). No new cron, no new wake path (cron is dead — PR #6547).
- **D-06:** Freshness **degrade-safe by design** — a brand-new needs-you row shows the deterministic floor until the next governed heartbeat compiles its card. No on-request warm compile (rejected — that is the 502 cause). Reuse 16.1 bounded-warm (`<=5` stale rows per heartbeat) cadence.
- **D-07:** Action-card compile op-issues MUST reuse the EXACT Phase-16.1 non-notifying provenance path (`own_operation_issues` + governed `checkAndRecordWake` + status-only/non-notifying writes). No "Someone updated" notification.
- **D-08:** **Two-step, reversible enablement.** Step 1: ship re-arch with flag OFF, deploy, confirm quiet. Step 2: flip ON via runtime kill-switch in a monitored window. Steps are SEPARATE.
- **D-09:** When ON, named-action prose renders on needs-you rows across **all four surfaces** (Situation Room, Reader, Bulletin, Chat), each keeping its deterministic-floor fallback.
- **D-10:** Degrade-safe deterministic floor; `blocker-chain.ts` untouched; determinism + AI-token grep guards green; NO_UUID_LEAK render-scans extend to any new card-render path.
- **D-11:** Additive-only plugin-namespace schema (kill-switch table); disable/uninstall preserves data. Instance-agnostic.
- **D-12:** Two-source version bump (package.json AND src/manifest.ts); host reads dist/manifest.js.

### Claude's Discretion
- Exact kill-switch table/column names and repo shape (follow 16.1 `wake_kill_switch` template).
- Whether the flag read is per-snapshot or memoized with a short TTL (degrade-safe either way).
- Test structure for storm-safety + flag-OFF-floor + flag-ON-no-storm assertions.

### Deferred Ideas (OUT OF SCOPE)
- Per-surface card-quality tuning / richer decision-option chips beyond Phase 13's conservative binary — Phase 13 rules stand.
- Any change to the deterministic engine classification — explicitly NOT this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CARD-01 | Action-card compile runs OFF the request path (not in the snapshot RPC) and writes non-notifying op-issues (no "Someone updated" storm). | §2 (request-path removal: delete the `ACTION_CARDS_ENABLED && …driveActionCardsStep` block at `situation-room.ts:606`); §4 (non-notifying path already shared — `startAgentTask` records `own_operation_issues` + governed wake). Landmine: the `ctx.issues.update(op.id,{status:'done'})` writes at action-cards.ts:510/680 are the notification vector to verify quiet. |
| CARD-02 | `ACTION_CARDS_ENABLED` re-enabled behind the flag once proven; Editor named-action prose live on needs-you rows; stale→degrade intact. | §1 (runtime kill-switch repo, mirror of `wake-kill-switch-repo.ts`); §3 (governed compile at editor.ts:387 — already routes through `startAgentTask`→`checkAndRecordWake`); §5 (four-surface attach). Staleness rule already implemented: `isActionCardFresh` (content-hash + 10-min liveness, action-cards.ts:184). |
| CARD-03 | Flag runtime-safe + slip-safe — OFF→floor (room works); ON→no 502, no notification storm. | §1 (degrade-safe flag read fails to OFF); §6 (storm-safety harness reuse — `test/loop/storm-safety.test.mjs`); §7 (two-step deploy/drill). |
</phase_requirements>

## Summary

The action-card *generation* machinery already exists, is fully unit-tested, and never throws (`driveActionCardsStep`, `action-cards.ts`, 689 lines). Phase 19 is **mostly subtraction plus one new tiny repo + table**, exactly as CONTEXT.md states. The single biggest finding: **the action-card op-issue path is ALREADY the non-notifying 16.1 provenance path.** `driveActionCardsStep` dispatches via `startAgentTask` (`agent-task-delivery.ts:426`), which writes `recordOwnOperationIssue` (durable provenance) and gates its single wake through `checkAndRecordWake`. So D-07 is *already wired* — the work is to (a) confirm no second op-issue path exists (it doesn't), and (b) verify the `ctx.issues.update(opId,{status:'done'})` mark-done writes don't raise host notifications (the BEAAA-2092 vector).

The runtime kill-switch is a near-verbatim clone of `wake-kill-switch-repo.ts` + the `wake_kill_switch` table block in `0017_loop_governor.sql`. The next migration number is **0019** (highest on disk is 0018). The flag is read at two points: the **compile decision** (editor.ts heartbeat trigger, replacing the `if (!ACTION_CARDS_ENABLED) return` at editor.ts:387) and the **attach decision** (`situation-room.ts` slice build, replacing the `if (ACTION_CARDS_ENABLED && …)` compile block — which gets *deleted*, leaving only the read-cached attach).

The four-surface attach (D-09) is the **only genuinely new code beyond the flag**: today the `actionCard` is read/attached and rendered **only in the Situation Room** (`situation-room.ts:621-627` attach; `employee-row.tsx:374-404` render). The Reader live-blocker-panel uses the *deterministic* `blockerLine(data)` as its `namedAction`; Bulletin and Chat read no action card at all. D-09 requires a shared **batch** cached read (the repo today only exposes single-row `getActionCardBySource`) wired into the Reader, Bulletin, and Chat data handlers, each with its existing deterministic fallback.

**Primary recommendation:** Ship in this shape — (1) new migration `0019` + `action-cards-flag-repo.ts` (clone of `wake-kill-switch-repo.ts`, degrade-to-OFF read); (2) delete the on-request compile block at `situation-room.ts:584-619`, keep the read-cached attach, add a flag gate to the attach; (3) replace `ACTION_CARDS_ENABLED` const reads at `editor.ts:387` and `action-cards.ts` call sites with the runtime flag (compile decision); (4) add a batch `getActionCardsByCompany`/`getActionCardsBySources` repo read and wire it into the three other surfaces' handlers; (5) reuse `test/loop/storm-safety.test.mjs` harness for CARD-03; (6) two-step deploy at **v1.8.0** (feature minor; current shipped version is **1.7.5**, not 1.7.4 as the older memory says).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Runtime flag persistence | Database / plugin namespace | Worker repo | A redeploy-free live kill-switch must be durable + restart-safe — exactly what 16.1's `wake_kill_switch` proved. |
| Flag read (compile + attach decisions) | Worker (heartbeat + snapshot handler) | — | Both decisions are worker-side; the UI never reads the flag (a stale card simply renders or doesn't). |
| Action-card AI compile | Worker (Editor-Agent heartbeat) | Editor-Agent (managed agent) | D-05 moves ALL compile to the governed pull path; the agent does the LLM work via the op-issue handoff. |
| Card cache read/attach | Worker (each surface's data handler) | Database (`action_cards` SELECT) | Read-cached-only (D-04): every surface attaches from the table, never compiles. |
| Card render + deterministic fallback | Browser / Client (React surfaces) | — | Each surface renders the attached card or falls back to the deterministic line it already renders. |

## Standard Stack

No new external packages. This phase is entirely internal worker + UI code against the already-pinned stack (`@paperclipai/plugin-sdk@2026.512.0`, TS 5.7.3, React 19 peer, Node 20). The only "new" artifacts are one SQL migration file and one TS repo module, both clones of existing in-repo patterns.

**Package Legitimacy Audit:** N/A — Phase 19 installs **zero** external packages. No registry verification required.

## Architecture Patterns

### System Architecture Diagram (target state)

```
                       ┌──────────────────────────────────────────┐
   Editor-Agent        │  editor.ts heartbeat (governed pull)      │
   heartbeat  ───────▶ │   1. read action-cards flag (runtime DB)  │
   (per opted-in co.)  │      ── OFF ⇒ skip compile (return)       │
                       │   2. buildEmployeesRollup → needsYou rows  │
                       │   3. driveActionCardsStep(...)             │
                       └───────────────┬──────────────────────────┘
                                       │ (cache miss rows only)
                                       ▼
                       ┌──────────────────────────────────────────┐
                       │ startAgentTask  (agent-task-delivery.ts)  │
                       │   • create op-issue (plugin_operation,     │
                       │     OFF the human board)                   │
                       │   • recordOwnOperationIssue  ◀── D-07 prov │
                       │   • checkAndRecordWake (gated wake)        │
                       └───────────────┬──────────────────────────┘
                                       ▼  agent files compile-result doc
                       ┌──────────────────────────────────────────┐
                       │ finalizeBody → upsertActionCard            │
                       │   → plugin_clarity_pack…action_cards table │  ◀── the cache
                       └──────────────────────────────────────────┘

   HTTP request path (NO AI WORK — D-04/CARD-01):
   ┌────────────────────────┐   ┌────────────────────────────────┐   ┌────────────────────┐
   │ situation.snapshot RPC │   │ issue-reader / flatten RPC      │   │ bulletin / chat RPC│
   │  read flag ─ OFF⇒{}    │   │  read flag ─ OFF⇒{}             │   │  read flag ─ OFF⇒{}│
   │  ON ⇒ batch SELECT      │   │  ON ⇒ batch SELECT action_cards │   │  ON ⇒ SELECT card  │
   │  action_cards → attach  │   │  → attach to blocker panel       │   │  → attach          │
   │  → cached in SWR slice  │   │                                  │   │                    │
   └──────────┬─────────────┘   └──────────────┬──────────────────┘   └─────────┬──────────┘
              ▼                                 ▼                                ▼
        SR employee-row              Reader live-blocker-panel          Bulletin / Chat rows
        (card ?? deterministic)      (card ?? blockerLine)              (card ?? deterministic)
```

### Pattern 1: Runtime DB-backed flag (mirror `wake_kill_switch`)
**What:** A one-row-per-company boolean in the plugin namespace, read degrade-to-safe.
**Why this shape:** 16.1 already proved durable + version-scoped + operator-clear-only is the right safety primitive, and `wake-kill-switch-repo.ts` is the template CONTEXT.md D-01 names explicitly.
**Key inversion vs. wake_kill_switch:** the wake switch defaults to *permissive* (no row = allowed) and trips to *suppress*. The action-cards flag defaults to *OFF/safe* (no row OR unreadable = OFF = deterministic floor) and an operator turns it *ON*. So the read predicate is "a row exists AND enabled = true", and the catch block returns **false** (OFF), matching `isEngaged`'s fail-open logic but with inverted polarity.
```ts
// Source: pattern from src/worker/db/wake-kill-switch-repo.ts:52-68 (this session)
export async function isActionCardsEnabled(ctx, companyId): Promise<boolean> {
  try {
    const rows = await ctx.db.query<{ enabled: boolean }>(
      `SELECT enabled FROM plugin_clarity_pack_cdd6bda4bd.action_cards_flag
       WHERE company_id = $1 LIMIT 1`,
      [companyId],
    );
    return !!rows[0]?.enabled;     // no row ⇒ OFF (D-02 default)
  } catch {
    return false;                  // unreadable ⇒ OFF (D-02 degrade-safe)
  }
}
```
**Version-scope decision (Open Q):** `wake_kill_switch` is version-scoped (`plugin_version`) so a pre-fix tripped row doesn't DOA a corrected build. For the action-cards flag the operator *wants* the ON state to **survive** version bumps (Eric flips ON once; a v1.8.1 hotfix should not silently revert to OFF). Recommend **NOT** version-scoping the flag read — the opposite of the wake switch. Document this divergence explicitly in the repo header. (Flagged in Open Questions.)

### Pattern 2: Read-cached-only attach (D-04 / CARD-01)
**What:** The snapshot handler SELECTs from `action_cards` and attaches; it never calls `driveActionCardsStep`.
**Today:** `situation-room.ts:584-619` builds `needsYouRows` then conditionally calls `driveActionCardsStep` (gated off by the const). The fix DELETES that whole block. The attach at `:621-627` already reads from a `cardsBySource` map — repoint that map to a **batch cached read** instead of the step result.
```ts
// Target — replace the compile block with a batch cached read (flag-gated):
let cardsBySource: Record<string, ActionCard> = {};
if (await isActionCardsEnabled(ctx, companyId)) {
  const leafUuids = employees
    .filter(e => e.blockerChain?.needsYou)
    .map(e => e.blockerChain!.targetIssueUuid ?? e.blockerChain!.leafIssueUuid)
    .filter((x): x is string => !!x);
  cardsBySource = await getActionCardsBySources(ctx, companyId, leafUuids); // NEW batch read
}
// :621-627 attach stays unchanged.
```
**Freshness at read time:** the worker writes only fresh cards (the compile path already enforces `isActionCardFresh` before reuse and never persists a stale card). A degrade-safe read CAN additionally re-apply `isActionCardFresh` against a recomputed per-row hash + 10-min liveness so a long-idle Editor-Agent's stale card floors out. Recommend applying the liveness arm (age ≤ 10 min) on read for safety; the content-hash arm needs the row's recomputed hash which the snapshot already has the inputs for.

### Pattern 3: Governed compile = the existing path, flag-gated (D-05 / D-07)
**What:** No new wake path. The heartbeat trigger at `editor.ts:387` already calls `buildEmployeesRollup` → `driveActionCardsStep` → `startAgentTask`. `startAgentTask` (`agent-task-delivery.ts:498-549`) ALREADY does `recordOwnOperationIssue` (durable provenance) and `checkAndRecordWake` (governed wake). So flipping the const to a runtime read at editor.ts:387 *is* the compile-path change.
```ts
// editor.ts:387 — replace the const guard with the runtime flag:
if (!(await isActionCardsEnabled(ctx, payload.companyId))) return;   // was: if (!ACTION_CARDS_ENABLED) return;
```
**Bounded-warm cadence (D-06):** Phase 13's `driveActionCardsStep` compiles ALL stale needs-you rows in one shot (no `<=5` cap). 16.1's TL;DR warm path caps at `DEFAULT_WARM_MAX_ROWS = 5` (editor.ts:440). To honor D-06's "<=5 stale rows per heartbeat", the planner should cap `compileRows` (action-cards.ts:581) to the same `DEFAULT_WARM_MAX_ROWS` so a needs-you spike can't fan out into one giant compile. This is a small, additive change inside `driveActionCardsStep` or at its heartbeat caller.

### Anti-Patterns to Avoid
- **Re-introducing an on-request compile** (any `driveActionCardsStep` call inside a data handler). This is the exact 502 cause (action-cards.ts:116-130 header documents it). The snapshot handler must be read-only on cards.
- **A second op-issue path / a bespoke flag system.** D-01/D-07 forbid both — reuse `startAgentTask` and clone `wake-kill-switch-repo.ts`.
- **Version-scoping the ON flag** (would silently revert ON→OFF on every two-source bump). See Pattern 1.
- **Rendering `card.sourceIssueUuid`** on any new surface (NO_UUID_LEAK). The SR mirror already omits it by construction (employee-row.tsx:372); each new surface attach must do the same.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runtime flag persistence | A new env var / in-memory boolean / bespoke settings table | Clone `wake-kill-switch-repo.ts` + a `0019` table block copied from `0017_loop_governor.sql` | Durable, restart-safe, additive, validator-legal, operator-clear pattern is already proven and tested. In-memory reverts on restart (the exact 2026-06-04 failure mode). |
| Non-notifying op-issue write | A new "quiet write" mechanism | `startAgentTask` (already records `own_operation_issues` + governed wake; op-issues are `surfaceVisibility:'plugin_operation'` off the human board) | D-07 mandates the EXACT 16.1 path; it already exists and is what the action-cards step calls. |
| Throughput governance on the compile wake | A new rate limiter | `checkAndRecordWake` (already invoked inside `startAgentTask`) | One governed wake site; reuse it. |
| Storm-safety test | A new harness | `test/loop/storm-safety.test.mjs` `makeStormCtx()` | It already drives the REAL governor + provenance repo against a fake db keyed off SQL regex — extend it with an action-cards burst. |
| Staleness / freshness | A new TTL scheme | `isActionCardFresh` (content-hash + 10-min liveness, action-cards.ts:184) | Already pure + unit-tested; D-11-style staleness is solved. |

**Key insight:** Phase 19's safety primitives all already exist in the repo from Phase 13 (generation) and Phase 16.1 (governance). The phase is wiring + subtraction + a clone, not invention.

## Runtime State Inventory

> This is a worker-tier re-architecture + a flag flip on a LIVE instance (BEAAA). The runtime-state question matters for the two-step deploy.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `plugin_clarity_pack_cdd6bda4bd.action_cards` table already exists (migration 0015) and may hold rows compiled BEFORE the v1.4.1 gate-off. Any such rows are stale (>10 min old) and fail `isActionCardFresh` liveness on read. | None — staleness floors them automatically. Optionally a one-time `DELETE FROM action_cards` is NOT needed (degrade-safe by liveness). |
| Live service config | The NEW `action_cards_flag` row is the live config. Default OFF means **no row** (or `enabled=false`). Step 2 of the deploy flips it ON via a one-row UPSERT executed on the live box. | Step 2 = an operator-run SQL/handler UPSERT against the live plugin namespace; NO redeploy. Must be a documented, rehearsed gesture (like the wake-kill-switch clear). |
| OS-registered state | None — no cron/Task Scheduler/launchd registration. The dead Paperclip cron path (PR #6547) is explicitly NOT used (D-05). | None. Verified: the only triggers are the Editor-Agent native heartbeat + bounded-warm; no `setInterval`, no host cron. |
| Secrets/env vars | `CLARITY_WAKE_CEILING_PER_MIN` (governor ceiling, default 6/min) already governs the shared wake path the action-card compile rides. No NEW env var needed for the flag (it's a DB row, not env — that's the whole point of runtime-flippable). | None — confirm the existing ceiling is sane for the added compile wakes during the Step-2 window. |
| Build artifacts | `dist/manifest.js` is what the host reads; the two-source version bump (package.json + src/manifest.ts) regenerates it. `dist/worker.js` carries the new flag repo. | Two-source bump + rebuild + bookended reinstall (D-12). |

**The canonical question — after every file is updated, what runtime state still carries the old behavior?** The `ACTION_CARDS_ENABLED = false` const is compiled INTO `dist/worker.js`; promoting it to a DB read means the shipped Step-1 build defaults to OFF via an *absent flag row*, and Step-2 turns it on with NO new deploy. The pre-existing stale `action_cards` rows self-floor by liveness. Nothing else carries old behavior.

## Common Pitfalls

### Pitfall 1: The mark-done update is the real notification vector (BEAAA-2092)
**What goes wrong:** The header at action-cards.ts:116-130 attributes the BEAAA-2092 storm to "writing to the per-company operation issue on each recompute, generating a 'Someone updated <op-issue>' notification storm." The compile path issues `ctx.issues.update(op.id, {status:'done'})` at TWO sites (action-cards.ts:510 in `readBackExistingOp`, and :680 after a ready poll). Even though op-issues are `surfaceVisibility:'plugin_operation'`, a host `issues.update` may still emit an `issue.updated` event/notification.
**Why it happens:** moving compile off the request path removes the *per-poll* churn, but if the heartbeat compile still marks ops done frequently, the notification can recur.
**How to avoid:** During Step-1 (flag OFF) deploy verification, confirm the op-issue create/update writes raise no user-facing "Someone updated" notification. The 16.1 provenance gate already drops these as `isOwnOperationIssue` for *wake/ingress* purposes, but the planner must verify the *notification* surface specifically (it's a different host concern than the wake loop). This is the single most important CARD-01 acceptance check.
**Warning signs:** any "Someone updated" notification referencing an `action-cards-<companyId>` operation issue while the SR is open.

### Pitfall 2: D-09's four-surface attach is the only place new code can leak a UUID
**What goes wrong:** Adding card attach to Reader/Bulletin/Chat is NEW render surface; a careless attach could render `sourceIssueUuid` or an unscrubbed party.
**How to avoid:** Each new attach uses the same `rescrubPersisted(...)` read-time scrub the SR row uses (employee-row.tsx:383/385/438-439) and never passes `sourceIssueUuid` to a render node. Extend the NO_UUID_LEAK render-scan tests to the three new surfaces (D-10).

### Pitfall 3: The flag must gate BOTH decisions or the room half-works
**What goes wrong:** Gating only the compile (heartbeat) but not the attach (snapshot read) means stale cards from a prior ON window keep rendering after a panic OFF flip — defeating the "one DB row back to floor" guarantee (D-03).
**How to avoid:** Read the flag at the attach decision too; OFF ⇒ `cardsBySource = {}` ⇒ every surface floors immediately, even on cards already in the table.

### Pitfall 4: SWR cache bakes cards into the served slice
**What goes wrong:** `situation_employees` (with `actionCard` attached) is cached verbatim in `situation_snapshots` (situation-room.ts:705/737). A flag OFF flip won't instantly clear cards already in a FRESH cached slice — the slice is served as-is until it goes stale (FRESHNESS_MS).
**Why it matters for D-03:** "flip ONE row, room is back to floor with zero deploy latency" is slightly weakened by the SWR window.
**How to avoid:** Read the flag in the SWR **serve** path too (situation-room.ts:686-720) and strip `actionCard` from the served `situation_employees` when OFF, OR keep FRESHNESS_MS short enough that the panic-OFF latency is bounded and acceptable. Recommend the serve-path flag check (cheap; the flag read is a single indexed row). Flag this explicitly for the planner.

### Pitfall 5: Bounded-warm cap is not yet enforced in the action-card step
**What goes wrong:** `driveActionCardsStep` compiles every stale needs-you row at once; a spike fans out into one large op-issue/compile, not the `<=5`/heartbeat D-06 cadence.
**How to avoid:** Cap `compileRows` to `DEFAULT_WARM_MAX_ROWS` (5). The remaining rows compile on subsequent heartbeats — degrade-safe by design (D-06).

## Code Examples

### Migration 0019 (clone the wake_kill_switch block from 0017)
```sql
-- Source: pattern from migrations/0017_loop_governor.sql:84-95 (this session)
-- 0019_action_cards_flag.sql — additive plugin-namespace runtime flag.
-- Validator legality mirrors 0015/0016/0017: fully-qualified namespace literal,
-- CREATE TABLE IF NOT EXISTS, inline UNIQUE (no standalone create-index),
-- apostrophe-free COMMENT body.
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.action_cards_flag (
  id          bigserial PRIMARY KEY,
  company_id  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  set_at      timestamptz,
  set_by      text,
  UNIQUE (company_id)
);
COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.action_cards_flag IS
  'Runtime action-cards enablement flag (Phase 19 D-01). One row per company; default OFF (absent row or enabled=false). Operator flips ON live with no redeploy; read degrade-safe (unreadable ⇒ OFF). NOT version-scoped — the ON state survives a two-source version bump. Additive plugin-namespace table -- plugin disable leaves data intact.';
```

### Step-2 enable gesture (operator UPSERT — the redeploy-free flip)
```sql
-- Run on the live box in the Step-2 monitored window (mirror the kill-switch engage upsert):
INSERT INTO plugin_clarity_pack_cdd6bda4bd.action_cards_flag (company_id, enabled, set_at, set_by)
VALUES ($1, true, now(), 'eric-step2')
ON CONFLICT (company_id) DO UPDATE SET enabled = true, set_at = now(), set_by = 'eric-step2';
-- PANIC OFF (the whole point — one row back to the deterministic floor):
UPDATE plugin_clarity_pack_cdd6bda4bd.action_cards_flag SET enabled = false WHERE company_id = $1;
```
**Note (runbook):** BEAAA has **no `psql` on the box** (memory `beaaa-deploy-mechanics`). The flip must go through a worker handler (a tiny `set-action-cards-flag` data handler mirroring `set-opt-in.ts`) or the host's DB path, not a raw `psql`. The planner should add a flip handler so Step-2 is a UI/RPC gesture, not a shell command.

### Batch cached read (the new repo function for D-09)
```ts
// Add to src/worker/db/action-cards-repo.ts (alongside getActionCardBySource):
export async function getActionCardsBySources(
  ctx: ActionCardsCacheCtx, companyId: string, sourceIssueIds: string[],
): Promise<Record<string, ActionCardRow>> {
  if (sourceIssueIds.length === 0) return {};
  const rows = await ctx.db.query<ActionCardRow>(
    `SELECT DISTINCT ON (source_issue_id) company_id, source_issue_id, named_action,
       awaited_party, est_bucket, action_kind, decision_options, content_hash,
       generated_at, compiled_by_agent_id, source_revisions, tags
     FROM plugin_clarity_pack_cdd6bda4bd.action_cards
     WHERE company_id = $1 AND source_issue_id = ANY($2::text[])
     ORDER BY source_issue_id, generated_at DESC`,
    [companyId, toPgTextArrayLiteral(sourceIssueIds)],
  );
  const out: Record<string, ActionCardRow> = {};
  for (const r of rows) out[r.source_issue_id] = r;
  return out;
}
```
Caller maps `ActionCardRow → ActionCard` via the existing `rowToCard` shape and applies the liveness arm. (Confirm `= ANY($2::text[])` binding works through the host bridge the same way `toPgTextArrayLiteral` handles `text[]` for inserts — verify in Wave 0, see Validation Architecture.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ACTION_CARDS_ENABLED` compile-time `const = false` | Runtime DB-backed flag (`action_cards_flag`) | Phase 19 | Live OFF-flip with no redeploy. |
| Compile inside the snapshot RPC (on-view 60s recompute) | Compile only on the governed Editor-Agent heartbeat / bounded-warm | Phase 16.1 (warm) + Phase 19 (action cards) | No 502; no per-poll op-issue churn. |
| Action cards rendered Situation-Room only | Four-surface attach (SR + Reader + Bulletin + Chat) | Phase 19 (D-09 operator override) | Wider where a fresh card may appear; floor preserved everywhere. |
| `requestWakeup` removed (16.1-02 D-05) | Single governed `requestWakeup` re-added at op-issue creation (16.1-07) | Phase 16.1-07 | The action-card compile inherits this governed wake automatically (it goes through `startAgentTask`). |

**Deprecated/outdated:**
- The Paperclip cron path for proactive compile: **dead** (PR #6547 — host expires the invocation scope mid-poll). Do NOT add a cron (D-05).
- Memory note "current version 1.7.4": the on-disk version is **1.7.5** (package.json + src/manifest.ts both read `1.7.5` this session). Plan the bump from 1.7.5.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ctx.issues.update(opId,{status:'done'})` on a `plugin_operation` op-issue does not raise a user "Someone updated" notification (i.e. the BEAAA-2092 vector was the *per-poll request-path* frequency, now removed). | Pitfall 1 / CARD-01 | If host still notifies on plugin-op update, CARD-01 needs an additional non-notifying write flag or to skip the mark-done. MUST be verified empirically in Step-1 quiet-window. |
| A2 | `= ANY($2::text[])` binds correctly through the host `ctx.db.query` bridge (the bridge has a documented quirk for `text[]` on inserts — `toPgTextArrayLiteral`). | Code Examples (batch read) | If not, the batch read needs per-id queries or a different binding. Verify in Wave 0. |
| A3 | The four-surface render gap is real: only the SR reads/renders `actionCard` today (grep found `actionCard` render only in employee-row.tsx; Reader uses `blockerLine`, Bulletin/Chat none). | §5 / D-09 | If a surface already attaches, less work; low risk (grep was thorough). |
| A4 | Not version-scoping the flag (so ON survives a version bump) is the operator's intent. | Pattern 1 | If Eric wants ON to reset on every deploy (conservative), version-scope it like the wake switch. Confirm in discuss/plan. |

## Open Questions

1. **Flag version-scoping (A4).**
   - What we know: `wake_kill_switch` is version-scoped so a corrected build isn't DOA; the action-cards flag's *intent* is the opposite (ON should persist across hotfix bumps).
   - What's unclear: operator preference — persist ON across bumps, or re-confirm ON after each deploy.
   - Recommendation: do NOT version-scope (persist ON); document the divergence in the repo header. Confirm with Eric at plan time.

2. **Notification vector confirmation (A1).**
   - What we know: BEAAA-2092 header blames per-recompute op-issue writes; op-issues are off the human board (`plugin_operation`).
   - What's unclear: whether the host fires a notification on a `plugin_operation` `issues.update` at all.
   - Recommendation: make this the headline Step-1 quiet-window acceptance check; if it notifies, add a non-notifying write or drop the mark-done in favor of a status-only readback.

3. **SWR serve-path flag check (Pitfall 4).**
   - What we know: cards are baked into the cached slice; a panic OFF won't instantly clear a fresh cached slice.
   - Recommendation: add a flag check in the SWR serve path to strip `actionCard` when OFF — cheap, and it makes the "one row to floor" guarantee literal.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres (plugin namespace) | The new `action_cards_flag` table + `action_cards` cache | ✓ (live BEAAA) | host PG 17 | — |
| `@paperclipai/plugin-sdk` | All worker code | ✓ | 2026.512.0 (pinned) | — |
| `psql` on BEAAA box | The Step-2 flip, IF done by raw SQL | ✗ | — | **A worker flip handler** (`set-action-cards-flag`, mirror `set-opt-in.ts`) — recommended regardless |
| DO automated backup | Bookend for the two-step deploy (HYG-04 prerequisite) | ✓ (per locked scope) | — | Rehearsed Phase-1 restore |
| esbuild / tsc | Two-source build → `dist/manifest.js` + `dist/worker.js` | ✓ | 0.27.3 / 5.7.3 | — |

**Missing dependencies with fallback:** `psql` absent on BEAAA → ship a worker flip handler so Step-2 is an RPC, not a shell gesture. (Confirmed via memory `beaaa-deploy-mechanics`: "NO safety-CLI on box", `npx`-run host.)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in test runner (`node --test`, `.mjs` with type-stripping) |
| Config file | none — tests are `test/**/*.test.mjs`, run via the repo's `test` script |
| Quick run command | `node --test test/worker/agents/action-cards.test.mjs` |
| Full suite command | the repo's full `node --test` over `test/` (the 44/44-suite gate referenced in STATE) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CARD-01 | snapshot handler never calls `driveActionCardsStep`; op-issues are non-notifying provenance writes | unit + static-grep | `node --test test/worker/situation-room-handler.test.mjs` + a no-`driveActionCardsStep`-in-handler static gate | ❌ Wave 0 (static gate new; handler test exists) |
| CARD-01 | provenance write happens on op-issue create (16.1 path) | unit (extend storm harness) | `node --test test/loop/storm-safety.test.mjs` | ✅ extend |
| CARD-02 | flag ON ⇒ cards attach + render; stale ⇒ degrade | unit | `node --test test/worker/agents/action-cards.test.mjs` (freshness exists) + new flag-repo test | ⚠️ partial — `isActionCardFresh` tested; flag repo new |
| CARD-02 | four-surface attach + deterministic fallback | unit (UI render) | `node --test test/ui/surfaces/.../*-action-card.test.mjs` (SR exists; Reader/Bulletin/Chat new) | ❌ Wave 0 (3 new) |
| CARD-03 | flag OFF ⇒ deterministic floor (no cards anywhere) | unit | new flag-OFF-floor test per surface | ❌ Wave 0 |
| CARD-03 | flag ON ⇒ bounded wakes, no storm across simulated restart | unit (extend storm harness) | `node --test test/loop/storm-safety.test.mjs` | ✅ extend with action-cards burst |
| D-10 | NO_UUID_LEAK on each new render path | unit (render-scan) | extend `employee-row-no-uuid-leak.test.mjs` pattern to 3 surfaces | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the touched-surface test + `action-cards.test.mjs` + the flag-repo test (sub-30s).
- **Per wave merge:** full `node --test` over `test/` + the determinism + AI-token grep guards on `blocker-chain.ts` (must stay green — D-10).
- **Phase gate:** full suite green + the live two-step BEAAA drill (Step-1 quiet, Step-2 ON-no-storm).

### Wave 0 Gaps
- [ ] `src/worker/db/action-cards-flag-repo.ts` + `test/worker/db/action-cards-flag-repo.test.mjs` — degrade-to-OFF read, ON/OFF round-trip.
- [ ] `migrations/0019_action_cards_flag.sql` — validator-legal (run the existing ddl-prefix-validator regression test against it).
- [ ] Batch read `getActionCardsBySources` + its `= ANY($2::text[])` binding probe (A2).
- [ ] 3 new surface attach + render + NO_UUID_LEAK + flag-OFF-floor tests (Reader, Bulletin, Chat).
- [ ] A static gate: no `driveActionCardsStep` import/call inside any `src/worker/handlers/*` data handler (CARD-01 anti-regression — mirror the 16.1 no-wake static gate).
- [ ] Extend `test/loop/storm-safety.test.mjs` with an action-cards op-issue burst asserting bounded wakes + provenance suppression.

## Security Domain

> `security_enforcement` config not located; the project's standing invariants act as the security contract. ASVS framing below is the relevant subset for this worker/data phase.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `sanitizePromptInput` (action-cards.ts:243) already strips instruction-prefix overrides + caps length before issue-body text reaches the LLM prompt (prompt-injection floor). Reuse as-is. |
| V5 Output encoding | yes | `stripUuids` + `rescrubPersisted` (NO_UUID_LEAK) on every card display string, extended to the 3 new surfaces (D-10). |
| V6 Cryptography | no | No secrets handled in this phase. |
| V4 Access Control | yes | Op-issues stay `surfaceVisibility:'plugin_operation'` off the human board; the flag flip is operator-gated (the new flip handler must be opt-in/admin scoped like `set-opt-in.ts`). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM prompt injection via issue body into the action-card prompt | Tampering | `sanitizePromptInput` (deterministic strip + 500-char cap) — already shipped. |
| SQL injection in the flag/batch repo | Tampering | Parameterized queries only (`$1/$2`), `toPgTextArrayLiteral` for arrays — never identifier interpolation (16.1 T-161-01 discipline). |
| Self-trigger storm (op-issue write re-enters ingress → wake) | Denial of Service | `own_operation_issues` provenance gate + `checkAndRecordWake` ceiling + durable kill-switch — already in the path via `startAgentTask`. |
| UUID leak on a new render surface | Information disclosure | NO_UUID_LEAK render-scan extended to Reader/Bulletin/Chat (D-10). |

## Sources

### Primary (HIGH confidence) — all read this session
- `src/worker/agents/action-cards.ts` (689 lines) — `driveActionCardsStep`, `ACTION_CARDS_ENABLED` const :131, `isActionCardFresh` :184, freshness/staleness rules, mark-done writes :510/:680.
- `src/worker/db/action-cards-repo.ts` — `getActionCardBySource` (single-row only; no batch read today), `upsertActionCard`, `ActionCardRow` shape.
- `src/worker/handlers/situation-room.ts` — on-request compile block :584-619 (to delete), attach :621-627 (to keep + flag-gate), SWR serve path :686-752.
- `src/worker/agents/editor.ts` — heartbeat action-card trigger :378-421 (`if (!ACTION_CARDS_ENABLED) return` at :387), bounded-warm `DEFAULT_WARM_MAX_ROWS = 5` :440, TL;DR heartbeat :280-354.
- `src/worker/agents/agent-task-delivery.ts` — `startAgentTask` :426-552 (records `recordOwnOperationIssue` :498 + governed `checkAndRecordWake` :529; op-issues `surfaceVisibility:'plugin_operation'` :473).
- `src/worker/agents/wake-governor.ts` — `checkAndRecordWake` full file.
- `src/worker/db/wake-kill-switch-repo.ts` — the flag-repo template (`isEngaged`/`engage`/`clear`, fail-open, version-scope).
- `migrations/0017_loop_governor.sql` — `wake_kill_switch` table block (clone target); validator-legality notes.
- `migrations/` listing — highest on disk is `0018`; **next = 0019**.
- `test/loop/storm-safety.test.mjs` — `makeStormCtx()` reusable harness.
- `src/ui/surfaces/situation-room/employee-row.tsx` :360-449 — the ONLY surface rendering `actionCard` today; `rescrubPersisted` read-time scrub.
- `src/ui/surfaces/reader/live-blocker-panel.tsx` — uses deterministic `blockerLine(data)` as `namedAction` (no card read) → D-09 gap.
- `src/ui/surfaces/bulletin/action-inbox.tsx` — no `actionCard`/`namedAction` → D-09 gap.
- `package.json` + `src/manifest.ts` — current version **1.7.5** (both sources).
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/phases/19.../19-CONTEXT.md`.

### Secondary (MEDIUM confidence)
- Project memories (auto-context): `beaaa-deploy-mechanics` (no `psql` on box; `npx`-run host; two-source bump), `plugin-version-bump-two-sources`, `incident-editor-loop-storm-phase-16.1`, `phase-16.1-loop07-gap`.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; everything is in-repo against pinned deps.
- Architecture: HIGH — the compile/governance path was read line-by-line; the re-arch is subtraction + a verified clone.
- Pitfalls: HIGH for the code-grounded ones (request-path, four-surface gap, SWR cache); MEDIUM for the notification-vector (A1, inherently empirical — flagged).

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable internal codebase; the only volatility is host-side notification behavior on `plugin_operation` updates — re-verify if Paperclip is updated).
