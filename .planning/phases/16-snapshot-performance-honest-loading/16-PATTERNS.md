# Phase 16: Snapshot performance & honest loading - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 6 (5 MODIFY, 1 NEW; +1 OPTIONAL new migration)
**Analogs found:** 6 / 6 (every pattern has a proven in-repo analog)

This phase is a **read-path performance refactor** — no novel algorithms, only a transport swap
(RPC list-reads → `ctx.db.query` SQL), a BFS de-dup, a bounded-concurrency wrapper around the
irreducible `relations.get` RPCs, and an optional cache re-activation. There is **no CONTEXT.md**;
the file list is extracted from `16-RESEARCH.md` (the three-wave plan).

Boundaries the planner must honor (DO NOT TOUCH — pure/not the bottleneck, AI-token grep guards on
some): `src/shared/blocker-chain.ts`, `src/worker/situation/build-pulse-summary.ts`,
`src/worker/situation/leverage.ts`, `src/worker/situation/agent-liveness.ts`,
`src/worker/situation/classify-employee-state.ts`, `src/shared/scrub-human-action.ts`. The phase
reuses their EXPORTS; it does not edit them.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/worker/handlers/org-blocked-backlog.ts` (MODIFY — SQL-ify list+name reads, bound relations, share BFS) | service/builder | request-response + CRUD-read | `src/worker/bulletin/standing-numbers.ts` (SQL read) + itself (existing BFS/degrade) | exact (self + sibling) |
| `src/worker/situation/build-employees-rollup.ts` (MODIFY — SQL-ify roster+per-agent issues, bounded `Promise.all`, share BFS) | service/builder | request-response + CRUD-read | `standing-numbers.ts` (SQL) + own `Promise.all` fan-out | exact (self + sibling) |
| `src/worker/handlers/situation-room.ts` (MODIFY — orchestrate one SQL prefetch, share edge graph, stage timing, SWR serve/write) | controller/handler | request-response | itself (the data handler) + `compile-bulletin.ts` (db.execute in valid scope) | exact (self) |
| `src/worker/situation/snapshot-cache.ts` (NEW — SWR read/write repo for `situation_snapshots`) | service/db-repo | CRUD (namespace SELECT + INSERT) | `src/worker/db/tldr-cache.ts` (most-recent SELECT + ON CONFLICT INSERT) | exact (role + flow) |
| `src/worker/util/map-bounded.ts` (NEW — hand-rolled bounded-concurrency pool + `withDeadline` floor) | utility | transform/control | `16-RESEARCH.md` Code Examples (canonical 15-line pool) | role-match (no existing pool) |
| `migrations/0017_situation_snapshot_index.sql` (NEW — OPTIONAL, Wave C only) | migration | DDL (additive) | `migrations/0008_chat_topics_archived_at.sql` (additive `ALTER ... ADD COLUMN IF NOT EXISTS`) | exact |

## Pattern Assignments

### `src/worker/bulletin/standing-numbers.ts` — THE direct-SQL read template (the single biggest win)

This is the proven, in-contract `ctx.db.query` against `public.*` pattern that Wave A copies into
both builders to collapse N list/get RPCs into 2–3 SQL round-trips. **Read this file end-to-end
before writing any new SQL.**

**SQL-injection invariant** (file header, lines 7–10, 65–66): every `sql` is a static module-level
string; the SOLE bound parameter is `$1` (companyId); a regression test asserts `/\$\{[^}]*\}/`
never matches. The new SQL MUST follow this — parameterized `$1`/`$2`, never interpolation.

**The read shape to copy** (`standing-numbers.ts:73-115`):
```ts
sql:
  "SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'blocked' AND hidden_at IS NULL " +
  EXCLUDE_OPERATION_ISSUES_SQL,
params: ['<companyId>'],
```
**The operation-issue exclusion to reuse verbatim** (`standing-numbers.ts:65-66`):
```ts
const EXCLUDE_OPERATION_ISSUES_SQL =
  "AND (origin_kind IS NULL OR origin_kind NOT LIKE 'plugin:clarity-pack%')";
```
> The rollup's per-agent issue read SHOULD apply this same exclusion (Open Question #2) so the
> Editor-Agent's own operation issues never appear as an agent's "focus".

**Per-slot degrade posture** (`standing-numbers.ts:16-18, 124-130`): a per-query try/catch defaults
that slot rather than aborting the whole compile — mirror this around each new SELECT.

**Column-name caveat** (Pitfall 1, `standing-numbers.ts:13-14, 70-71`): the codebase reads camelCase
off the RPC clients; raw SQL needs snake_case (`assignee_agent_id`, `last_heartbeat_at`). Columns
are cited from `03-10-SCHEMA-FINDINGS.md §2`. The planner MUST add a Wave-0 live `\d public.issues` /
`\d public.agents` verification task in the bookended deploy window.

**Target SELECTs for this phase** (from RESEARCH Pattern 1, lines 144-163):
```ts
// One round-trip replaces ctx.issues.list({status:'blocked'}) + per-agent issues.list:
const blocked = await ctx.db.query<{ id: string; identifier: string; title: string;
    status: string; assignee_agent_id: string | null; assignee_user_id: string | null;
    updated_at: string | null }>(
  `SELECT id, identifier, title, status, assignee_agent_id, assignee_user_id, updated_at
     FROM public.issues
    WHERE company_id = $1 AND status = 'blocked' AND hidden_at IS NULL`,
  [companyId],
);
// One round-trip for the whole roster + heartbeats (replaces agents.list + per-uuid agents.get):
const agents = await ctx.db.query<{ id: string; name: string; role: string | null;
    title: string | null; last_heartbeat_at: string | null; status: string | null;
    paused_at: string | null }>(
  `SELECT id, name, role, title, last_heartbeat_at, status, paused_at
     FROM public.agents WHERE company_id = $1`,
  [companyId],
);
```
A `uuid→name` Map built ONCE from the single `agents` SELECT eliminates EVERY per-UUID
`ctx.agents.get` round-trip in BOTH builders.

---

### `src/worker/handlers/org-blocked-backlog.ts` (service/builder, request-response)

**Analog:** itself (the existing degrade-safe BFS + UNCLASSIFIED floor) + `standing-numbers.ts` (SQL).

**Existing imports pattern** (`org-blocked-backlog.ts:28-49`):
```ts
import { flattenBlockerChain, pickTopChains, classifyVerdict, type BlockerEdge } from '../../shared/blocker-chain.ts';
import type { BlockerChainResult, Terminal } from '../../shared/types.ts';
import { scrubHumanAction, UUID_RE_G } from '../../shared/scrub-human-action.ts';
import { resolveAgentState } from '../situation/agent-liveness.ts';
```

**EXPORTED BFS to call ONCE + memoize, not re-walk** (`org-blocked-backlog.ts:270-355`). The signature
the shared edge graph must preserve:
```ts
export async function buildEdges(
  ctx: OrgBlockedBacklogCtx, companyId: string, startId: string,
): Promise<{ edges: BlockerEdge[]; nodeMeta: Record<string, EdgeNodeMeta> }>
```
This is the SAME walk `build-employees-rollup.ts:357` calls — Pattern 2 (RESEARCH lines 171-178) is to
compute the union {all blocked} ∪ {each blocked agent's focus} ONCE, memoized by `startId`, and have
both consumers read it. **Do NOT re-implement the BFS** (Don't-Hand-Roll, RESEARCH line 235).

**The irreducible relations.get RPC — keep on RPC, bound it** (`org-blocked-backlog.ts:289-299`):
```ts
try {
  summary = await ctx.issues.relations.get(id, companyId);
} catch (e) {
  if (isRoot) throw e;   // root throw → caller skips/floors the whole issue
  continue;              // inner-node throw → skip that node, graph survives
} finally { isRoot = false; }
```
Wave B wraps each `relations.get` (or each `buildEdges` walk) with `withDeadline` + the bounded pool.
No relations table is in `coreReadTables` — relations CANNOT be SQL-ified; bound them, do not
eliminate them (RESEARCH line 58, Architectural Responsibility Map).

**The UNCLASSIFIED floor to reuse for timed-out/thrown walks** (`org-blocked-backlog.ts:220-239`,
applied at `:404-414`):
```ts
function unclassifiedChain(startId: string, degradeReason: string): BlockerChainResult {
  const terminal: Terminal = { kind: 'UNCLASSIFIED',
    label: `Can't determine blocker for ${startId} — open to investigate` };
  const verdict = classifyVerdict(terminal);
  return { startId, pathIds: startId ? [startId] : [], terminal, isStale: false,
    needsYou: verdict.needsYou, tier: verdict.tier, actionAffordance: verdict.actionAffordance,
    awaitedPartyLabel: terminal.label, targetAgentUuid: null, targetIssueUuid: startId || null,
    degradeReason };
}
// at the call site — a thrown/timed-out walk → honest UNCLASSIFIED row, NOT a dropped issue:
paired.push({ chain: unclassifiedChain(startId, 'relations-walk-timeout'), issue, nodeMeta: {} });
```
A `relations-walk-timeout` degradeReason (new) is the honest label for the Wave-B deadline path.

**Instance-agnostic invariant to PRESERVE** (`org-blocked-backlog.ts:94-96`): "no company-prefix
literal anywhere in this file" — every SQL added here uses `WHERE company_id = $1`, never a
`'BEAAA-'`/`'COU-'` literal.

**What changes:** replace `ctx.issues.list({companyId,status:'blocked'})` (`:374`) with the prefetched
SQL `blocked[]`; replace the per-UUID `ctx.agents.get` loop (`:482-503`) with lookups in the prefetched
`nameByUuid` Map. The `buildEdges` BFS, the `pickTopChains` rank, the `scrubHumanAction` scrub, and the
row-emit (`:511-571`) are UNCHANGED.

---

### `src/worker/situation/build-employees-rollup.ts` (service/builder, request-response)

**Analog:** itself (the `Promise.all` fan-out + inline UNCLASSIFIED block) + `standing-numbers.ts` (SQL).

**The UNBOUNDED fan-out to REPLACE with a bounded pool** (`build-employees-rollup.ts:617, 624-636`):
```ts
const agents = (await ctx.agents.list({ companyId })) as AgentLike[];   // → SQL roster SELECT
...
const rows: InternalRow[] = await Promise.all(
  agents.map(async (agent) => {
    try { return await buildOneEmployeeRow(ctx, agent, companyId, viewerUserId, nowMs); }
    catch (e) { ctx.logger?.warn?.('build-employees-rollup: row failed', { agentId: agent.id,
      err: (e as Error).message }); return degradeSafeRow(agent); }
  }),
);
```
Wave B swaps the raw `Promise.all(agents.map(...))` for `mapBounded(agents, LIMIT, ...)` (LIMIT 4–6,
planner discretion per RESEARCH A3 — no locked value). The per-row try/catch → `degradeSafeRow` is
ALREADY the right degrade shape; keep it.

**The per-agent reads to SQL-ify / share** (`buildOneEmployeeRow`, lines 300-573):
- `:307` `ctx.issues.list({ companyId, assigneeAgentId, limit: 50 })` → served from the prefetched
  SQL issue set (group by `assignee_agent_id`) instead of one RPC per agent.
- `:357-361` `buildEdges(...)` → the SHARED memoized edge graph (Pattern 2).
- `:416-430` per-UUID `ctx.agents.get` in a nested `Promise.all` → the prefetched `nameByUuid` Map.
- `:468-488` the multi-hop leaf `ctx.issues.get(leafNodeId, companyId)` → served from the prefetched
  issue set when the leaf is in-company (fall back to RPC only for a leaf not in the prefetch).

**The inline UNCLASSIFIED degrade block to KEEP (per-row floor)** (`build-employees-rollup.ts:541-571`):
```ts
const unclassifiedTerminal: Terminal = { kind: 'UNCLASSIFIED',
  label: `Can't determine blocker for ${rootIssueId} — open to investigate` };
const verdict = classifyVerdict(unclassifiedTerminal);
const humanAction = scrubHumanAction(unclassifiedTerminal, viewerUserId, new Map());
blockerChain = { rootIssueId, leafIssueId: focusIssue.identifier ?? null, leafIssueUuid: focusUuid,
  humanAction, ownerName: 'Unassigned', ownerAgentId: ...,
  needsYou: verdict.needsYou, tier: verdict.tier, actionAffordance: verdict.actionAffordance,
  awaitedPartyLabel: humanAction, targetAgentUuid: null, targetIssueUuid: focusUuid,
  terminalKind: 'UNCLASSIFIED' as const, needsDurabilityFlip: focusIssue.status === 'blocked',
  degradeReason };
```
A Wave-B `relations.get` timeout floors the row here (or via `unclassifiedChain`) — reuse, don't invent
a new "couldn't compute" shape (RESEARCH line 236).

**Note for the planner:** `EmployeesRollupCtx` and `OrgBlockedBacklogCtx` are structurally typed
(test-stubbable). Adding `db: Pick<PluginDatabaseClient,'query'>` to the ctx is the typing change Wave A
needs (mirror `StandingNumbersCtx` at `standing-numbers.ts:117-121`).

---

### `src/worker/handlers/situation-room.ts` (controller/handler, request-response)

**Analog:** itself (the orchestrating data handler) + `compile-bulletin.ts` (a valid-scope `db.execute`).

This is where the **shared SQL prefetch + shared edge graph** are constructed ONCE and passed to both
builders, where **stage timing** is added (Measurement, RESEARCH lines 404-411), and where **SWR
serve/write** wires in (Wave C).

**The valid-scope assertion that licenses fire-and-forget SWR** (`situation-room.ts:5-23, 90-91`): the
`situation.snapshot` data handler is a VALID HTTP-request scope (unlike the dead recompute cron). The
SWR write goes here, NOT in a resurrected `jobs[]` cron (Pitfall 4; do NOT re-add a scheduler).

**Existing builder-invocation + degrade pattern to extend** (`situation-room.ts:108-141`):
```ts
let org_blocked_backlog: OrgBlockedBacklog;
try {
  org_blocked_backlog = await buildOrgBlockedBacklog(
    { issues: ctx.issues, agents: ctx.agents, logger: ctx.logger } as unknown as OrgBlockedBacklogCtx,
    companyId, viewerUserId);
} catch (e) {
  ctx.logger?.warn?.('situation.snapshot: org-blocked-backlog compute failed',
    { companyId, err: (e as Error).message });
  org_blocked_backlog = { ...EMPTY_BACKLOG };
}
```
Wrap each stage with `const t0 = Date.now(); ... ctx.logger?.info?.('snap.stage', { stage, ms: Date.now()-t0, companyId })`.

**Viewer-scoping that the SWR cache MUST respect** (`situation-room.ts:101-104`, V4 / Pitfall 2):
```ts
const viewerUserId = typeof params?.userId === 'string' && params.userId ? params.userId : '';
```
`needsYou`/`need_you_count` are per-viewer. Cache only the **viewer-invariant slice** (org backlog
rows, employees rollup, pulse) and recompute the cheap `needsYou` partition per call (a pure filter over
cached rows — no fetch). Do NOT cache the viewer-scoped count under a company-only key (cross-viewer leak).

**Return shape to preserve** (`situation-room.ts:228-236`): `{ org_blocked_backlog, situation_employees,
needsYou, pulse, taken_at }`. SWR adds nothing to the shape — `taken_at` already signals snapshot age.

**Action-cards stay GATED OFF** (`situation-room.ts:179-189`, `ACTION_CARDS_ENABLED=false`): this phase
must NOT re-enable the synchronous action-card compile (RESEARCH State-of-the-Art; Phase 19 owns it).

---

### `src/worker/situation/snapshot-cache.ts` (NEW — service/db-repo, CRUD)

**Analog:** `src/worker/db/tldr-cache.ts` — the canonical most-recent-row SELECT + ON-CONFLICT INSERT
repo against the plugin namespace. Copy its shape verbatim.

**Most-recent-row read** (`tldr-cache.ts:97-111`):
```ts
const rows = await ctx.db.query<TldrRow>(
  `SELECT surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags
     FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache
    WHERE surface = $1 AND scope_id = $2
    ORDER BY generated_at DESC
    LIMIT 1`,
  [surface, scopeId]);
return rows[0] ?? null;
```
For SWR: `SELECT payload, taken_at FROM plugin_clarity_pack_cdd6bda4bd.situation_snapshots
WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1`.

**Idempotent namespace write** (`tldr-cache.ts:73-89` / `active-viewer-ping.ts:27-30`):
```ts
await ctx.db.execute(
  `INSERT INTO plugin_clarity_pack_cdd6bda4bd.situation_snapshots
     (taken_at, computed_for_company_id, payload, content_hash)
   VALUES (now(), $1, $2::jsonb, $3)
   ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING`,
  [companyId, JSON.stringify(payload), contentHash]);
```
> `ctx.db.execute` is namespace-ONLY DML and returns `{ rowCount }` (no RETURNING) — see
> `reply-resume-repo.ts:71`. `ctx.db.query` is SELECT-only (namespace + `coreReadTables`). The
> existing `situation_snapshots` columns are `(id, taken_at, computed_for_company_id, payload jsonb,
> content_hash, UNIQUE(company_id, content_hash))` (`migrations/0003:37-44`) — NO `viewer_user_id`,
> NO `taken_at` index beyond the PK. Caching the viewer-invariant slice needs NO migration.

---

### `src/worker/util/map-bounded.ts` (NEW — utility, transform/control)

**Analog:** RESEARCH "Code Examples" (lines 311-338) — the project deliberately hand-rolls this
(NO `p-limit`; bundle-size CI ceiling + no-new-dep posture, RESEARCH lines 77-82). Two exports:

```ts
// Run `fn` over `items` with at most `limit` in flight. Resolves preserving order.
export async function mapBounded<T, R>(items: T[], limit: number,
    fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]!, i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Floor a hung RPC to a deterministic fallback (use if the typed surface won't take timeoutMs).
export function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(onTimeout()); });
  });
}
```
**Test it** like the existing builders (stubbed ctx): assert (a) ≤K round-trips for N agents/M blocked
issues, (b) a stubbed slow/throwing `relations.get` yields an UNCLASSIFIED floor, not a hang
(RESEARCH lines 419-422).

---

### `migrations/0017_situation_snapshot_index.sql` (NEW — OPTIONAL, Wave C only)

**Analog:** `migrations/0008_chat_topics_archived_at.sql` — the additive `ALTER ... ADD COLUMN IF NOT
EXISTS` template. Only add this IF profiling shows the most-recent-row SELECT is itself slow
(RESEARCH OQ#3); prefer the no-migration viewer-invariant-cache design.

**The additive DDL shape to copy** (`0008:24-25`):
```sql
ALTER TABLE plugin_clarity_pack_cdd6bda4bd.chat_topics
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;
```
For Wave C (if needed): `CREATE INDEX IF NOT EXISTS ... ON
plugin_clarity_pack_cdd6bda4bd.situation_snapshots (computed_for_company_id, taken_at DESC);`

**Validator constraints (ALL migrations, `0008:16-22` + `0003:13-27`):** namespace-qualified literally
(`plugin_clarity_pack_cdd6bda4bd.*`, NO template substitution); NO anonymous procedural blocks (host
rejects `DO $$` / dollar-quoted); apostrophe-free comments; file ends on a semicolon-terminated
statement. Covered by `test/migrations/no-procedural-blocks.test.mjs`.

## Shared Patterns

### Direct-SQL read (Pattern 1 — the cross-cutting win)
**Source:** `src/worker/bulletin/standing-numbers.ts:65-115` (SQL + exclusion) and
`src/worker/db/tldr-cache.ts:102-111` (namespace SELECT).
**Apply to:** `org-blocked-backlog.ts`, `build-employees-rollup.ts`, `snapshot-cache.ts`.
Parameterized `$1`/`$2` ONLY (never interpolation, T-03-10); `WHERE company_id = $1` on every
`public.*` read (V4 company-scoping, no prefix literal); `?? null` defensive posture on every field.

### Degrade-safe floor (the honesty contract)
**Source:** `org-blocked-backlog.ts:220-239` (`unclassifiedChain`) and `build-employees-rollup.ts:541-571`
(inline block) and the handler try/catch (`situation-room.ts:108-141`).
**Apply to:** every new timeout/throw path. A slow/failed read → an honest UNCLASSIFIED row with a
`degradeReason` (e.g. `'relations-walk-timeout'`), NEVER a dropped issue or a hang. Reuse the existing
shapes; do not invent a new one.

### Bounded concurrency + per-call deadline
**Source:** RESEARCH Code Examples (`mapBounded`, `withDeadline`) → new `map-bounded.ts`. The SDK
`callHost(method, params, timeoutMs)` per-call override is real (`worker-rpc-host.js:153-178`; default
`DEFAULT_RPC_TIMEOUT_MS=30_000` at `:46`). Prefer threading `timeoutMs` through the typed
`ctx.issues.relations.get` IF reachable (OQ#1); otherwise wrap with `withDeadline` for an identical floor.
**Apply to:** every `relations.get` walk in both builders (Wave B).

### Valid-scope, no background loop
**Source:** `situation-room.ts:5-23, 90-91` (the handler is a valid HTTP-request scope) and the removed
cron (`worker.ts:54-59`).
**Apply to:** the SWR write — fire-and-forget the recompute INSIDE the data handler's scope; do NOT add
a `jobs[]` cron or a `setInterval` (Pitfall 4; governance parity, CLAUDE.md no-tight-loop rule).

### Additive-only, namespace-qualified migration
**Source:** `migrations/0008_chat_topics_archived_at.sql` + `migrations/0003` header.
**Apply to:** the OPTIONAL `0017` only — `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`,
fully namespace-qualified, no procedural blocks.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/worker/util/map-bounded.ts` | utility | transform/control | No bounded-concurrency pool exists in-repo today (the codebase uses raw `Promise.all`). The canonical 15-line implementation lives in `16-RESEARCH.md` Code Examples — copy it verbatim. This is the only genuinely-new primitive in the phase. |

> Everything else has a strong in-repo analog. The SQL read, the BFS, the UNCLASSIFIED floor, the
> namespace SELECT/INSERT repo, the valid-scope handler, and the additive migration are ALL proven
> patterns already shipped on BEAAA.

## Metadata

**Analog search scope:** `src/worker/handlers/`, `src/worker/situation/`, `src/worker/bulletin/`,
`src/worker/db/`, `migrations/`, `src/manifest.ts`, `node_modules/@paperclipai/plugin-sdk/dist/`.
**Files scanned:** 12 (6 target files + 6 analogs/contracts).
**Pattern extraction date:** 2026-06-03

## PATTERN MAPPING COMPLETE

**Phase:** 16 - Snapshot performance & honest loading
**Files classified:** 6 (5 MODIFY, 1 NEW utility, 1 NEW db-repo; +1 OPTIONAL migration)
**Analogs found:** 6 / 6

### Coverage
- Files with exact analog: 5 (`org-blocked-backlog.ts`, `build-employees-rollup.ts`, `situation-room.ts`, `snapshot-cache.ts`, `0017_*.sql`)
- Files with role-match analog: 1 (`map-bounded.ts` — canonical from RESEARCH, no in-repo pool)
- Files with no analog: 0

### Key Patterns Identified
- **SQL-ify the list/roster/name reads** via the proven `ctx.db.query` template in `standing-numbers.ts:65-115` (parameterized `$1`, `company_id = $1`, `EXCLUDE_OPERATION_ISSUES_SQL`) — collapses N RPCs to 2–3 SQL round-trips; `agents`/`issues`/`companies` already in `coreReadTables` (`manifest.ts:741-748`).
- **Keep + bound the irreducible `relations.get` RPC** (no relations table in `coreReadTables`): hand-rolled `mapBounded` (4–6) + `withDeadline`/`timeoutMs` floor, reusing the existing `unclassifiedChain` (`org-blocked-backlog.ts:220-239`) / inline UNCLASSIFIED block (`build-employees-rollup.ts:541-571`) so a slow row floors honestly, never hangs or drops.
- **SWR via the dead `situation_snapshots` table** using the `tldr-cache.ts` most-recent SELECT + ON-CONFLICT INSERT shape; cache only the viewer-invariant slice (no cross-viewer leak, no migration); write from the valid-scope handler, never a cron.

### File Created
`.planning/phases/16-snapshot-performance-honest-loading/16-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. The planner can reference each analog file:line directly in PLAN action
sections. Flag two Wave-0 verification tasks the patterns depend on: (1) live `\d public.issues` /
`\d public.agents` to lock snake_case column names (Pitfall 1 / A1); (2) confirm whether `timeoutMs`
is reachable through the typed `ctx.issues.relations.get` surface, else use `withDeadline` (OQ#1 / A5).
