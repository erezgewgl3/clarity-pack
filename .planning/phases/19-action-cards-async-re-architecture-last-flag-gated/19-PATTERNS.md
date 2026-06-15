# Phase 19: Action-cards async re-architecture (LAST, flag-gated) - Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 12 (3 new, 9 modified/extended)
**Analogs found:** 12 / 12 (every new/modified file has a real in-repo analog — this phase is "clone + subtract", not invention)

> Sources are the live codebase, read this session. Line numbers are exact as of the
> read. The planner should re-grep before editing if a prior plan in this phase has
> already shifted line numbers.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/worker/db/action-cards-flag-repo.ts` (NEW) | db-repo | request-response (degrade-safe read) | `src/worker/db/wake-kill-switch-repo.ts` | exact (clone, inverted polarity) |
| `migrations/0019_action_cards_flag.sql` (NEW) | migration | DDL / additive | `migrations/0017_loop_governor.sql` (`wake_kill_switch` block, :72-95) | exact |
| `src/worker/agents/action-cards.ts` (MODIFY :131) | service / agent-step | event-driven (heartbeat compile) | self — promote const to runtime read; reuse repo above | n/a (subtraction) |
| `src/worker/handlers/situation-room.ts` (MODIFY :584-627, :85) | handler | request-response (read-cached-only) | self (the `:621-627` read-cached attach to KEEP) | n/a (subtraction + flag-gate) |
| `getActionCardsBySources` in `src/worker/db/action-cards-repo.ts` (NEW fn) | db-repo | batch read (CRUD-read) | `getActionCardBySource` in the same file (:92-106) | exact (same file) |
| `src/worker/agents/editor.ts` (MODIFY :387, :66) | service / agent-heartbeat | event-driven | self (the existing `driveActionCardsStep` trigger to KEEP, governed) | n/a (flag-gate) |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` (MODIFY) | component | request-response (attach card + floor) | `src/ui/surfaces/situation-room/employee-row.tsx` :374-404 (card ?? deterministic) | role-match |
| `src/ui/surfaces/bulletin/action-inbox.tsx` (MODIFY) | component | request-response (attach card + floor) | `employee-row.tsx` :374-404 | role-match |
| `src/ui/surfaces/chat/*` read path (MODIFY) | component | request-response (attach card + floor) | `employee-row.tsx` :374-404 | role-match |
| `src/worker/handlers/set-action-cards-flag.ts` (NEW) | handler | request-response (operator write) | `src/worker/handlers/set-opt-in.ts` | exact |
| `test/loop/storm-safety.test.mjs` (EXTEND) | test | event-driven (burst sim) | self (`makeStormCtx()` harness, :48-90) | n/a (extend) |
| `test/worker/db/action-cards-flag-repo.test.mjs` (NEW) | test | request-response | `test/worker/agents/action-cards.test.mjs` (freshness) + storm-ctx fake-db keying | role-match |

---

## Pattern Assignments

### `src/worker/db/action-cards-flag-repo.ts` (NEW — db-repo, degrade-safe read)

**Analog:** `src/worker/db/wake-kill-switch-repo.ts` (full file). This is a near-verbatim clone
with **inverted polarity** (default OFF/safe instead of permissive) and a **divergence on
version-scoping** (do NOT version-scope — the ON state must survive a two-source version bump,
per RESEARCH Pattern 1 / Open Q #1 / D-01).

**Repo ctx + SELECT-only read pattern** (analog `wake-kill-switch-repo.ts:41-68`):
```typescript
import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type WakeKillSwitchRepoCtx = { db: PluginDatabaseClient; };

export async function isEngaged(ctx, companyId: string): Promise<boolean> {
  try {
    const rows = await ctx.db.query<{ engaged: boolean }>(
      `SELECT engaged
       FROM plugin_clarity_pack_cdd6bda4bd.wake_kill_switch
       WHERE company_id = $1 AND plugin_version = $2
       LIMIT 1`,
      [companyId, CLARITY_PACK_VERSION],
    );
    return !!rows[0]?.engaged;
  } catch {
    return false; // fail-open — durable read is a backstop, never a wedge
  }
}
```

**Target shape for the new repo** (the inversion: predicate = "row exists AND enabled = true";
catch returns `false` = OFF; **drop the `plugin_version` filter** so ON persists across bumps):
```typescript
export async function isActionCardsEnabled(ctx, companyId: string): Promise<boolean> {
  try {
    const rows = await ctx.db.query<{ enabled: boolean }>(
      `SELECT enabled FROM plugin_clarity_pack_cdd6bda4bd.action_cards_flag
       WHERE company_id = $1 LIMIT 1`,
      [companyId],
    );
    return !!rows[0]?.enabled;   // no row ⇒ OFF (D-02 default)
  } catch {
    return false;                // unreadable ⇒ OFF (D-02 degrade-safe)
  }
}
```

**Write/upsert pattern** (analog `engage()` :76-89 — atomic upsert against `UNIQUE(company_id)`):
```typescript
await ctx.db.execute(
  `INSERT INTO plugin_clarity_pack_cdd6bda4bd.wake_kill_switch
     (company_id, engaged, engaged_at, reason, plugin_version)
   VALUES ($1, true, now(), $2, $3)
   ON CONFLICT (company_id) DO UPDATE
     SET engaged = true, engaged_at = now(), reason = $2, plugin_version = $3`,
  [companyId, reason, CLARITY_PACK_VERSION],
);
```

**Divergence to document in the repo header (per RESEARCH Pattern 1):** `wake_kill_switch` is
version-scoped (a pre-fix tripped row must not DOA a corrected build). The action-cards flag is
the OPPOSITE — Eric flips ON once, and a v1.8.1 hotfix must NOT silently revert to OFF. So the
new repo's read predicate must NOT filter on `plugin_version`. State this divergence explicitly.

---

### `migrations/0019_action_cards_flag.sql` (NEW — migration, additive)

**Analog:** `migrations/0017_loop_governor.sql` (the `wake_kill_switch` block, :72-95). Next
number is **0019** (highest on disk is `0018_structured_human_wait.sql`; verified by directory
listing this session — `0012` is absent, a harmless gap, NOT reused).

**Validator-legality header convention** (analog `0017_loop_governor.sql:1-29` — MUST be copied):
```sql
-- ADDITIVE-ONLY. Creates exactly one new table inside the deterministic plugin
-- namespace plugin_clarity_pack_cdd6bda4bd. ZERO public.* DDL. (coexistence #3)
-- Validator legality mirrors 0015/0016/0017/0018:
--   - fully-qualified namespace literal (NO template substitution).
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - inline UNIQUE (...) inside CREATE TABLE — NO standalone create-index.
--   - COMMENT body is apostrophe-free (stripSqlForKeywordScan pairs a lone
--     apostrophe across statements and swallows the leading keyword).
```

**CREATE TABLE pattern** (analog `0017_loop_governor.sql:84-95` — `wake_kill_switch`):
```sql
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.wake_kill_switch (
  id             bigserial PRIMARY KEY,
  company_id     text NOT NULL,
  engaged        boolean NOT NULL DEFAULT false,
  engaged_at     timestamptz,
  reason         text,
  plugin_version text,
  UNIQUE (company_id)
);
COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.wake_kill_switch IS
  'Durable wake kill-switch (D-08). One row per company; engaged persists across worker restart ... Additive plugin-namespace table -- plugin disable leaves data intact.';
```

**Target for 0019** (one row per company, default OFF, NOT version-scoped — note: no
`plugin_version` column, matching the repo divergence):
```sql
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.action_cards_flag (
  id          bigserial PRIMARY KEY,
  company_id  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  set_at      timestamptz,
  set_by      text,
  UNIQUE (company_id)
);
COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.action_cards_flag IS
  'Runtime action-cards enablement flag (Phase 19 D-01). One row per company; default OFF (absent row or enabled=false). Operator flips ON live with no redeploy; read degrade-safe (unreadable ⇒ OFF). NOT version-scoped -- the ON state survives a two-source version bump. Additive plugin-namespace table -- plugin disable leaves data intact.';
```

**Regression guard to run against it:** the existing `ddl-prefix-validator` regression test
(referenced in the `0017` header) — confirm the new file is validator-legal.

---

### `src/worker/agents/action-cards.ts` (MODIFY :131 — service / agent-step)

**Analog:** self. The generation step (`driveActionCardsStep`, 689 lines) **never throws** and
does not change — only the enable flag and the call-site guards change.

**Current const to promote** (:115-131 — the v1.4.1 BEAAA-2092 hotfix block):
```typescript
/**
 * v1.4.1 HOTFIX (BEAAA-2092) — action-card COMPILE is temporarily gated OFF.
 * ... 502 + "Someone updated <op-issue>" notification storm ...
 * We gate the two CALL SITES (situation-room.ts snapshot + editor.ts heartbeat)
 * on this flag ... Re-enable in the async re-architecture (compile off the request
 * path; op issue must not raise user notifications).
 */
export const ACTION_CARDS_ENABLED: boolean = false;
```

**Two import sites that consume this const** (both become runtime `isActionCardsEnabled(...)` reads):
- `src/worker/agents/editor.ts:66` — `import { ACTION_CARDS_ENABLED } ...`; used at `:387`.
- `src/worker/handlers/situation-room.ts:85` — same import; used at `:606`.

**Freshness/staleness already solved (reuse, do NOT rebuild)** — `isActionCardFresh` (:184-194,
pure, clock injected) + `ACTION_CARD_STALE_MS = 10 * 60 * 1000` (:139). Apply the **liveness arm**
on read so a long-idle Editor-Agent's stale card floors out (RESEARCH Pattern 2).

**Bounded-warm cap to ADD (D-06 / Pitfall 5):** `driveActionCardsStep` compiles ALL stale
needs-you rows at once. Cap `compileRows` to `DEFAULT_WARM_MAX_ROWS = 5` (the constant lives at
`editor.ts:440`) so a needs-you spike can't fan out into one giant compile.

---

### `src/worker/handlers/situation-room.ts` (MODIFY :584-627 — handler, read-cached-only)

**Analog:** self — the `:621-627` read-cached attach is the pattern to KEEP; the `:584-619`
on-request compile block is the pattern to DELETE (D-04 / CARD-01 core).

**DELETE this on-request compile block** (:606 is the named removal site):
```typescript
let cardsBySource: Record<string, ActionCard> = {};
try {
  const needsYouRows: ActionCardSourceRow[] = employees
    .filter((e) => e.blockerChain && e.blockerChain.needsYou === true)
    .map((e) => ({ /* ...row shape... */ }))
    .filter((r) => r.sourceIssueId.length > 0);

  if (ACTION_CARDS_ENABLED && needsYouRows.length > 0) {     // ← :606 — DELETE
    const step = await driveActionCardsStep(ctx as unknown as ActionCardsCtx, {
      companyId, needsYouRows,
    });
    cardsBySource = step.cards;                              // ← the on-request compile
  }
} catch (e) { /* ... */ cardsBySource = {}; }
```

**REPLACE with a flag-gated batch cached read** (RESEARCH Pattern 2 target):
```typescript
let cardsBySource: Record<string, ActionCard> = {};
if (await isActionCardsEnabled(ctx, companyId)) {
  const leafUuids = employees
    .filter(e => e.blockerChain?.needsYou)
    .map(e => e.blockerChain!.targetIssueUuid ?? e.blockerChain!.leafIssueUuid)
    .filter((x): x is string => !!x);
  cardsBySource = await getActionCardsBySources(ctx, companyId, leafUuids); // NEW batch read
}
```

**KEEP this attach unchanged** (:621-627 — the cached employee shape):
```typescript
const situation_employees = employees.map((e) => {
  const leafUuid = e.blockerChain?.targetIssueUuid ?? e.blockerChain?.leafIssueUuid ?? null;
  const actionCard: ActionCard | null = leafUuid ? (cardsBySource[leafUuid] ?? null) : null;
  return { ...e, actionCard };
});
```

**SWR serve-path flag check (Pitfall 4 / Open Q #3):** cards are baked into the cached slice
(`situation-room.ts:705/737`); a panic OFF won't instantly clear a FRESH cached slice. Add a flag
read in the SERVE path (:686-720) and strip `actionCard` from `situation_employees` when OFF — so
"flip ONE row, room back to floor" is literal. The serve path is at `:686-720` (SERVE-LAST-GOOD)
and the synchronous recompute write-back is at `:723-737`.

---

### `getActionCardsBySources` in `src/worker/db/action-cards-repo.ts` (NEW fn — batch read)

**Analog:** `getActionCardBySource` in the SAME file (:92-106 — the single-row read).

**Single-row analog** (:92-106):
```typescript
export async function getActionCardBySource(
  ctx: ActionCardsCacheCtx, companyId: string, sourceIssueId: string,
): Promise<ActionCardRow | null> {
  const rows = await ctx.db.query<ActionCardRow>(
    `SELECT company_id, source_issue_id, named_action, awaited_party, est_bucket, action_kind, decision_options, content_hash, generated_at, compiled_by_agent_id, source_revisions, tags
     FROM plugin_clarity_pack_cdd6bda4bd.action_cards
     WHERE company_id = $1 AND source_issue_id = $2
     ORDER BY generated_at DESC
     LIMIT 1`,
    [companyId, sourceIssueId],
  );
  return rows[0] ?? null;
}
```

**Target batch read** (RESEARCH Code Examples) — `DISTINCT ON` for newest-per-source; reuse
`toPgTextArrayLiteral` (imported at `action-cards-repo.ts:23` from `tldr-cache.ts`) for the
`text[]` bind, mirroring the `upsertActionCard` `$N::text[]` discipline (:68):
```typescript
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

**Wave-0 probe (Assumption A2):** verify `= ANY($2::text[])` binds correctly through the host
`ctx.db.query` bridge (the bridge has a documented quirk for `text[]` — `toPgTextArrayLiteral`
fixed it for INSERT; confirm it holds for SELECT-`ANY` before relying on it).

---

### `src/worker/agents/editor.ts` (MODIFY :387, :66 — service / heartbeat)

**Analog:** self — the existing heartbeat trigger (:378-421) is the off-request governed compile
path to KEEP. It already calls `buildEmployeesRollup` → `driveActionCardsStep` → `startAgentTask`
(which does `recordOwnOperationIssue` + `checkAndRecordWake`). So D-05/D-07 are ALREADY wired; the
only change is the flag read.

**Current const guard** (:385-387):
```typescript
// v1.4.1 HOTFIX (BEAAA-2092) — action-card compile gated OFF; skip the
// heartbeat trigger entirely so no op issue is started/touched.
if (!ACTION_CARDS_ENABLED) return;
```

**Target runtime read** (RESEARCH Pattern 3):
```typescript
if (!(await isActionCardsEnabled(ctx, payload.companyId))) return;   // was: if (!ACTION_CARDS_ENABLED) return;
```

The compile-and-dispatch body (:388-414, `buildEmployeesRollup` → `needsYouRows` map →
`driveActionCardsStep`) is unchanged — that IS the governed pull path.

---

### Three new surface attaches — Reader / Bulletin / Chat (MODIFY — component, attach + floor)

**Shared analog for ALL THREE:** `src/ui/surfaces/situation-room/employee-row.tsx:374-404` — the
ONLY surface rendering `actionCard` today; the `card ?? deterministic` fallback every new surface
must copy.

**The canonical card-or-floor render** (`employee-row.tsx:374-404`):
```tsx
{(() => {
  const card = row.actionCard;
  const estWords = card ? estBucketLabel(card.estBucket) : null;
  return card ? (
    <div className="clarity-employee-chain clarity-employee-chain-action-card">
      {/* read-time re-scrub over the in-hand display strings — NO new fetch */}
      <p className="clarity-employee-named-action">{rescrubPersisted(card.namedAction)}</p>
      <p className="clarity-employee-await">
        {`waiting on ${rescrubPersisted(card.awaitedParty)}${estWords ? ` · ${estWords}` : ''}`}
      </p>
    </div>
  ) : (
    /* fall through to the EXISTING deterministic chain line — never blank,
       never a fabricated estimate. card.sourceIssueUuid is NOT on the mirror,
       so it can never be rendered (NO_UUID_LEAK by construction, D-10/D-14). */
    <div className="clarity-employee-chain ...">{/* deterministic line */}</div>
  );
})()}
```

**Per-surface floor each new attach falls back to (the existing deterministic line):**
- **Reader** (`reader/live-blocker-panel.tsx`): the deterministic floor is `blockerLine(data)`
  (:85-127), already rendered at `:356` and used as `namedAction` for the reply branch
  (`:374`, `:439`). D-09 attach: when a fresh card exists, render `card.namedAction` in place of
  / above `blockerLine(data)`; OTHERWISE keep `blockerLine(data)`. Reader fetches
  `flatten-blocker-chain` via `usePluginData` (:191) — the card must be threaded through that
  handler (or a sibling) per D-09.
- **Bulletin** (`bulletin/action-inbox.tsx`): grep confirmed **NO** `actionCard`/`namedAction`/
  `blockerLine` today — a true D-09 gap. New attach + a deterministic floor matching its existing
  awaiting-you line.
- **Chat**: reads no action card today (RESEARCH §5 / Assumption A3). Same pattern.

**NO_UUID_LEAK extension (D-10 / Pitfall 2):** each new attach MUST use `rescrubPersisted(...)`
(imported in `live-blocker-panel.tsx:34` and `employee-row.tsx`) on every display string and MUST
NOT pass `sourceIssueUuid` to any render node. Extend the `employee-row-no-uuid-leak.test.mjs`
render-scan pattern to all three new surfaces.

---

### `src/worker/handlers/set-action-cards-flag.ts` (NEW — handler, operator write / Step-2 flip)

**Analog:** `src/worker/handlers/set-opt-in.ts` (full file). BEAAA has **no `psql` on the box**
(memory `beaaa-deploy-mechanics`), so the Step-2 ON-flip must be an RPC, not a shell command.

**Register + param-guard + namespaced UPSERT pattern** (`set-opt-in.ts:44-63`):
```typescript
export function registerSetOptIn(ctx: SetOptInCtx): void {
  ctx.actions.register('set-opt-in', async (params) => {
    const userId = typeof params?.userId === 'string' && params.userId ? params.userId : null;
    if (!userId) throw new Error('set-opt-in: userId required (...)');
    // ... param validation ...
    await ctx.db.execute(
      'INSERT INTO plugin_clarity_pack_cdd6bda4bd.clarity_user_prefs (user_id, opted_in_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET opted_in_at = EXCLUDED.opted_in_at',
      [userId, optedInAt],
    );
    invalidateOptedInCache();
    return { userId, optedInAt };
  });
}
```

**Target flip handler** — mirror the register/guard/UPSERT shape; UPSERT `action_cards_flag`
(`enabled`, `set_at = now()`, `set_by`) against `UNIQUE(company_id)`; access-control note
(Security Domain V4): scope to admin/operator like `set-opt-in`. The Step-2 enable + panic-OFF
gestures map directly to this handler:
```sql
-- ON (Step-2 monitored window):
INSERT INTO ...action_cards_flag (company_id, enabled, set_at, set_by)
VALUES ($1, true, now(), 'eric-step2')
ON CONFLICT (company_id) DO UPDATE SET enabled = true, set_at = now(), set_by = 'eric-step2';
-- PANIC OFF (one row back to the deterministic floor):
UPDATE ...action_cards_flag SET enabled = false WHERE company_id = $1;
```

---

### `test/loop/storm-safety.test.mjs` (EXTEND — test, burst sim) + flag-repo test (NEW)

**Analog:** self — `makeStormCtx()` (:48-90) drives the REAL governor (`checkAndRecordWake`) and
REAL provenance repo against a fake `db` keyed off SQL regex. Extend it with an action-cards
op-issue burst asserting bounded wakes + provenance suppression (CARD-01 / CARD-03).

**The fake-db SQL-regex keying pattern to extend** (:63-90):
```javascript
async query(sql, params) {
  if (/own_operation_issues/.test(sql)) { /* provenance Set */ }
  if (/wake_ledger/.test(sql)) { /* trailing-60s count */ }
  if (/wake_kill_switch/.test(sql)) { /* killSwitch Map */ }
  return [];
}
```
Add an `action_cards_flag` branch returning the flag row so the storm harness can exercise the
flag-ON compile burst, and add an `action_cards` branch for the batch-read assertions.

**New flag-repo test** (`test/worker/db/action-cards-flag-repo.test.mjs`): assert degrade-to-OFF
(unreadable row ⇒ false), absent-row ⇒ OFF, ON round-trip. Model the fake-db off the same
SQL-regex keying as `makeStormCtx`. The freshness analog (`isActionCardFresh` pure-function tests)
lives in `test/worker/agents/action-cards.test.mjs` (exists — confirmed this session).

**Static gate (Wave 0, CARD-01 anti-regression):** add a test asserting NO `driveActionCardsStep`
import/call inside any `src/worker/handlers/*` data handler — mirror the 16.1 no-wake static gate.

---

## Shared Patterns

### Degrade-safe runtime flag (the central new primitive)
**Source:** `src/worker/db/wake-kill-switch-repo.ts` (clone target).
**Apply to:** the new flag repo, the compile decision (`editor.ts:387`), the attach decision
(`situation-room.ts:606`), and the SWR serve path (`situation-room.ts:686-720`).
**Rule:** OFF at EITHER decision point ⇒ `cardsBySource = {}` ⇒ deterministic floor everywhere
(D-03 / Pitfall 3). The flag read fails to OFF (D-02).

### Non-notifying op-issue provenance (already wired — verify, don't rebuild)
**Source:** `src/worker/agents/agent-task-delivery.ts` `startAgentTask` (records
`recordOwnOperationIssue` + governed `checkAndRecordWake`; op-issues are
`surfaceVisibility:'plugin_operation'`). `driveActionCardsStep` already dispatches through it.
**Apply to:** the action-card compile path — D-07 is satisfied by construction. The one verify
item (Assumption A1 / Pitfall 1): confirm the `ctx.issues.update(opId,{status:'done'})` mark-done
writes (`action-cards.ts:510` and `:680`) raise NO user "Someone updated" notification in the
Step-1 quiet window. This is the single most important CARD-01 acceptance check.

### Parameterized-only SQL (T-161-01 discipline)
**Source:** every repo file — `$1/$2` binds, `toPgTextArrayLiteral` for `text[]`, never identifier
interpolation.
**Apply to:** the new flag repo, the batch read, the flip handler.

### NO_UUID_LEAK read-time scrub on every card display string
**Source:** `rescrubPersisted(...)` (`employee-row.tsx:383/385`, `live-blocker-panel.tsx:34`).
**Apply to:** all four surface attaches (D-09 widens render surface; D-10 carries the invariant).
Never pass `sourceIssueUuid` to a render node.

### Additive plugin-namespace migration legality
**Source:** `migrations/0017_loop_governor.sql:1-29` header + the `wake_kill_switch` block.
**Apply to:** `0019` — fully-qualified namespace literal, `CREATE TABLE IF NOT EXISTS`, inline
`UNIQUE`, apostrophe-free `COMMENT`. Run the `ddl-prefix-validator` regression test against it.

### Two-source version bump (D-12)
**Source:** memory `plugin-version-bump-two-sources`; current on-disk version is **1.7.5** (both
`package.json` and `src/manifest.ts`, per RESEARCH — NOT 1.7.4 as the older memory says). Plan the
bump from 1.7.5 to **v1.8.0** (feature minor). The host reads `dist/manifest.js`.

---

## No Analog Found

None. Every Phase 19 file maps to a real in-repo analog — this phase is deliberately
"clone + subtract + flag-flip", with the generation machinery and the safety primitives all
already shipped (Phase 13 generation, Phase 16.1 governance + kill-switch).

---

## Metadata

**Analog search scope:** `src/worker/db/`, `src/worker/handlers/`, `src/worker/agents/`,
`src/ui/surfaces/{situation-room,reader,bulletin,chat}/`, `migrations/`, `test/loop/`,
`test/worker/`.
**Files scanned (read in full or targeted):** `wake-kill-switch-repo.ts`, `action-cards-repo.ts`,
`0017_loop_governor.sql`, `situation-room.ts` (:560-752), `action-cards.ts` (:110-198),
`editor.ts` (:375-444), `employee-row.tsx` (:355-449), `set-opt-in.ts`, `live-blocker-panel.tsx`,
`storm-safety.test.mjs` (:1-90); migrations + test directory listings; `ACTION_CARDS_ENABLED`
grep (import sites confirmed at `editor.ts:66`, `situation-room.ts:85`).
**Key empirical confirmations this session:** highest migration = `0018` (next = `0019`);
`action-cards.test.mjs` exists; `bulletin/action-inbox.tsx` has NO card read today (D-09 gap real).
**Pattern extraction date:** 2026-06-15
