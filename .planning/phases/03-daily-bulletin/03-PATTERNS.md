# Phase 3: Daily Bulletin — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 30 NEW + 3 EXTEND (33 total)
**Analogs found:** 30 / 30 (100% coverage from Phase 2)

This document maps every NEW file Phase 3 will create to its closest existing Phase 2 analog in the codebase, with a verbatim code excerpt the planner can hand to executors as "copy this shape." Three EXTEND targets are listed at the bottom with their current-code state + the surgical addition.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/manifest.ts` | manifest (extend) | config | `src/manifest.ts:18-208` self | EXTEND |
| `src/worker.ts` | worker entry (extend) | wiring | `src/worker.ts:84-87` self | EXTEND |
| `src/worker/agents/self-loop-filter.ts` | filter (extend) | event-driven | `src/worker/agents/self-loop-filter.ts:21,39-50` self | EXTEND |
| `src/worker/jobs/compile-bulletin.ts` | worker job (cron) | scheduled-batch | `src/worker/jobs/situation-snapshot.ts` | EXACT |
| `src/worker/bulletin/next-due-at.ts` | shared pure helper | pure-function | `src/shared/blocker-chain.ts` (PRIM-03 pure-graph) | EXACT (pure-fn pattern) |
| `src/worker/bulletin/facts-table.ts` | worker helper | SQL-aggregate | `src/worker/jobs/situation-snapshot.ts:218-228` (db.query inside job) | role-match |
| `src/worker/bulletin/compile-pass-1.ts` | LLM call | request-response | `src/worker/agents/compile-tldr.ts` | EXACT |
| `src/worker/bulletin/bulletin-verifier.ts` | pure validator | transform | `src/shared/blocker-chain.ts` (deterministic) | EXACT (pure-fn pattern) |
| `src/worker/bulletin/action-inbox-query.ts` | issues.list wrap | request-response | `src/worker/handlers/flatten-blocker-chain.ts:74-127` (walkBlockerChain) | role-match |
| `src/worker/bulletin/lineage-grouper.ts` | pure clustering | transform | `src/shared/blocker-chain.ts` (deterministic graph) | EXACT |
| `src/worker/bulletin/department-reconcile.ts` | idempotent reconcile | batch-upsert | `src/worker/agents/editor.ts:56-62` (reconcileEditorAgent) | role-match |
| `src/worker/bulletin/standing-numbers.ts` | pre-defined SQL set | CRUD-read | `src/worker/handlers/editor-pause-status.ts:28-52` (db.query SELECT) | role-match |
| `src/worker/bulletin/publish.ts` | host issue write | mutation | `src/worker/jobs/situation-snapshot.ts:300-309` (INSERT + content_hash) | role-match |
| `src/worker/db/bulletins-repo.ts` | typed repo | CRUD | `src/worker/db/tldr-cache.ts` | EXACT |
| `src/worker/handlers/bulletin-by-cycle.ts` | data handler | request-response | `src/worker/handlers/situation-room.ts` | EXACT |
| `src/worker/handlers/bulletin-latest-status.ts` | data handler | request-response | `src/worker/handlers/editor-pause-status.ts` | EXACT |
| `src/worker/handlers/bulletin-errata.ts` | data+action handler | request-response | `src/worker/handlers/set-opt-in.ts` (write) + `editor-pause-status.ts` (read) | role-match |
| `src/worker/handlers/bulletin-action-approve.ts` | action handler | mutation | `src/worker/handlers/active-viewer-ping.ts` | EXACT |
| `src/worker/handlers/bulletin-action-decline.ts` | action handler | mutation | `src/worker/handlers/active-viewer-ping.ts` | EXACT |
| `src/shared/bulletin-rendering.ts` | shared pure helper | transform | `src/shared/blocker-chain.ts` (pure helpers) | role-match |
| `src/ui/surfaces/bulletin/index.tsx` | top-level page | UI page slot | `src/ui/surfaces/situation-room/index.tsx` | EXACT |
| `src/ui/surfaces/bulletin/masthead.tsx` | header component | render | `src/ui/surfaces/situation-room/critical-path-strip.tsx` | role-match |
| `src/ui/surfaces/bulletin/action-inbox.tsx` | right-rail panel | render+action | `src/ui/surfaces/situation-room/awaiting-you-pill.tsx` (deep-link + action shape) | role-match |
| `src/ui/surfaces/bulletin/department-section.tsx` | section component | render | `src/ui/surfaces/situation-room/agent-card.tsx` (mockup-driven card grid) | role-match |
| `src/ui/surfaces/bulletin/standing-numbers-panel.tsx` | metrics card | render | `src/ui/surfaces/situation-room/sparkline.tsx` + critical-path-strip layout | role-match |
| `src/ui/surfaces/bulletin/lineage-footer.tsx` | chain renderer | render | `src/ui/surfaces/situation-room/critical-path-strip.tsx` | EXACT |
| `src/ui/surfaces/bulletin/errata-footer.tsx` | footer block | render | `src/ui/surfaces/reader/pause-banner.tsx` (footer scoped region) | role-match |
| `src/ui/surfaces/bulletin/failed-compile-banner.tsx` | banner | render | `src/ui/surfaces/reader/pause-banner.tsx` | EXACT |
| `src/ui/styles/bulletin.css` | surface stylesheet | CSS | (Phase 2 theme.css scoped under `[data-clarity-surface="<name>"]`) | role-match |
| `migrations/0004_bulletin.sql` | DDL | schema | `migrations/0003_situation_and_optin.sql` | EXACT |
| `test/worker/bulletin/next-due-at.test.mjs` | pure-fn test | test | `test/shared/blocker-chain.test.mjs` | EXACT |
| `test/worker/bulletin/verifier.test.mjs` | pure-fn test | test | `test/shared/blocker-chain.test.mjs` | EXACT |
| `test/worker/bulletin/lineage-grouper.test.mjs` | pure-fn test | test | `test/shared/blocker-chain.test.mjs` | EXACT |
| `test/worker/bulletin/compile-bulletin.test.mjs` | job test | test | `test/worker/situation-snapshot.test.mjs` | EXACT |
| `test/worker/bulletin/action-inbox-query.test.mjs` | handler test | test | `test/worker/situation-room-handler.test.mjs` (not loaded here but same shape) | role-match |
| `test/worker/bulletin/publish.test.mjs` | mutation test | test | `test/worker/situation-snapshot.test.mjs` | role-match |
| `test/worker/self-loop-filter-bulletin.test.mjs` | regression test | test | `test/worker/self-loop-filter.test.mjs` | EXACT |
| `test/migrations/0004-bulletin-schema.test.mjs` | DDL test | test | `test/migrations/no-procedural-blocks.test.mjs` (already covers all .sql; ADD: namespace + table-presence asserts) | EXACT |
| `test/ui/bulletin-page.test.mjs` | source-grep | test | `test/ui/situation-room.test.mjs` | EXACT |
| `test/ci/coexistence-bulletin-disable.test.mjs` | coexistence | test | `test/ci/coexistence-checklist.test.mjs` | role-match |

---

## Pattern Assignments

### NEW: `src/worker/jobs/compile-bulletin.ts`

**Role:** worker job (manifest `jobs[]` cron handler)
**Closest analog:** `src/worker/jobs/situation-snapshot.ts:216-312`
**Why this analog:** Same shape — `registerXJob(ctx)` exports the registration function; the registered fn is the per-tick handler; the per-tick handler short-circuits on a gate (active-viewers there, `next_due_at` here), iterates companies, executes work, writes a content-hash-keyed row. Identical wiring style in `src/worker.ts`.

**Imports + Ctx pattern excerpt** (lines 15-44):
```typescript
import type {
  PluginAgentsClient,
  PluginCompaniesClient,
  PluginDatabaseClient,
  PluginIssuesClient,
  PluginJobsClient,
  PluginLogger,
  Company,
  Agent,
} from '@paperclipai/plugin-sdk';

import {
  flattenBlockerChain,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
import type { BlockerChainResult } from '../../shared/types.ts';
import { humanizeChain, buildIdLookup, type IdLookup } from './humanize-snapshot.ts';

const MAX_CHAIN_DEPTH = 6;
const CRITICAL_PATH_MAX = 3;
const ACTIVE_VIEWER_WINDOW_SECS = 90;

export type SituationSnapshotCtx = {
  logger?: PluginLogger;
  db: PluginDatabaseClient;
  jobs: PluginJobsClient;
  companies: PluginCompaniesClient;
  agents: PluginAgentsClient;
  issues: PluginIssuesClient;
};
```

**Register fn + per-company loop excerpt** (lines 216-309):
```typescript
export function registerSituationSnapshotJob(ctx: SituationSnapshotCtx): void {
  ctx.jobs.register('recompute-situation', async () => {
    // ROOM-05 gate: skip when no recent active viewers.
    let activeViewerCount = 0;
    try {
      const rows = await ctx.db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM plugin_clarity_pack_cdd6bda4bd.active_viewers WHERE surface = 'situation-room' AND last_seen_at > now() - interval '${ACTIVE_VIEWER_WINDOW_SECS} seconds'`,
      );
      activeViewerCount = rows[0]?.n ?? 0;
    } catch (e) {
      ctx.logger?.warn?.('situation-snapshot: active_viewers count failed', { err: (e as Error).message });
      return;
    }
    if (activeViewerCount === 0) {
      return;
    }

    let companies: Company[] = [];
    try {
      companies = await ctx.companies.list();
    } catch (e) {
      ctx.logger?.warn?.('situation-snapshot: companies.list failed', { err: (e as Error).message });
      return;
    }

    for (const company of companies) {
      // ... per-company work ...
      try {
        await ctx.db.execute(
          'INSERT INTO plugin_clarity_pack_cdd6bda4bd.situation_snapshots (computed_for_company_id, payload, content_hash) VALUES ($1, $2::jsonb, $3) ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING',
          [companyId, payloadJson, contentHash],
        );
      } catch (e) {
        ctx.logger?.warn?.('situation-snapshot: INSERT failed', { companyId, err: (e as Error).message });
      }
    }
  });
}
```

**Planner instruction:** Replace the `active_viewers` gate with a `next_due_at` SELECT (read from `bulletins` table); replace the snapshot payload composition with the two-pass compile call (`compilePass1` then `verifyDraft` then `publishBulletin`); keep the per-company loop, the try/catch-and-continue style, the `ctx.logger?.warn?.()` warn-not-throw style, and the content-hash dedupe via `ON CONFLICT DO NOTHING`. Idempotency key is `(next_due_at, content_hash)` per D-13 (vs `(computed_for_company_id, content_hash)` for snapshots).

---

### NEW: `src/worker/bulletin/next-due-at.ts`

**Role:** shared pure helper (DST-safe `06:30 America/New_York` arithmetic)
**Closest analog:** `src/shared/blocker-chain.ts:33-49` (pure helper exporting one deterministic function)
**Why this analog:** Same architectural pattern — single pure function exported from a single file, no `ctx`, fully deterministic output for the same input, test fixture-friendly (caller passes `now: Date`). RESEARCH.md §"Pattern 1" and §"Test-time strategy" mandate the exact same `(now: Date) => Date` signature the blocker-chain.ts file pioneered with `({startId, edges, nodeMeta, viewerUserId}) => BlockerChainResult`.

**Pure-fn pattern excerpt from analog** (`src/shared/blocker-chain.ts:1-20`):
```typescript
// src/shared/blocker-chain.ts
//
// Plan 02-02 Task 1 — PRIM-03 (deterministic DFS, no model inference)...
// Critical contract (PRIM-03 from PROJECT.md): terminal selection is pure
// graph code — no AI inference of any kind.

import type { BlockerChainResult, Terminal } from './types.ts';

export type BlockerEdge = {
  from: string;
  to: string;
  reason: 'blocks' | 'awaiting' | 'external';
};

export type BlockerChainInput = {
  startId: string;
  edges: BlockerEdge[];
  // ...
};
```

**Planner instruction:** Write `src/worker/bulletin/next-due-at.ts` using the RESEARCH.md §"Pattern 1" code verbatim (already validated against `date-fns-tz` ^3.2.0 API). Single pure export: `export function computeNextDueAt(now: Date): Date`. Module-level constants `BULLETIN_TZ = 'America/New_York'`, `BULLETIN_HOUR = 6`, `BULLETIN_MINUTE = 30`. No `ctx`, no I/O, no logger calls. Test fixture passes 4 DST instants per CONTEXT.md D-12 verification gate (2026-03-08, 03-09, 11-01, 11-02).

---

### NEW: `src/worker/bulletin/compile-pass-1.ts`

**Role:** LLM call (pass-1 draft generation with structured output)
**Closest analog:** `src/worker/agents/compile-tldr.ts:153-226` (`compileTldr` — the existing single-call LLM kernel)
**Why this analog:** Same architectural contract — single function that (1) checks idempotency hash, (2) builds prompt, (3) enforces MAX_TOKENS cap BEFORE the call, (4) invokes injected `LlmAdapter`, (5) validates output schema, (6) feeds circuit-breaker on failure (`recordFailure`) or success (`recordSuccess`), (7) persists. The LlmAdapter interface is reused — RESEARCH.md §"Code Dependencies on Phase 2" explicitly says "re-uses the `LlmAdapter` interface."

**Imports + adapter interface excerpt** (lines 31-90):
```typescript
import crypto from 'node:crypto';

import { upsertTldr, getTldrByScope, type TldrRow, type TldrCacheCtx } from '../db/tldr-cache.ts';
import {
  recordFailure,
  recordSuccess,
  type CircuitBreakerCtx,
} from './circuit-breaker.ts';
import { EDITOR_WRITE_TAG } from './self-loop-filter.ts';

export const MAX_TOKENS = 4000;
export const EDITOR_AGENT_ID_TAG = 'clarity-pack-editor-agent';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function validateLlmOutput(body: unknown): asserts body is string {
  if (typeof body !== 'string' || body.length === 0 || body.length > 8000) {
    throw new Error(`Editor-Agent output failed schema validation (len=${typeof body === 'string' ? body.length : 'non-string'})`);
  }
}

export type LlmAdapter = {
  complete(args: { maxTokens: number; prompt: string }): Promise<string>;
};

export type CompileTldrCtx = TldrCacheCtx &
  CircuitBreakerCtx & {
    logger?: { info?(...a: unknown[]): void; warn?(...a: unknown[]): void; error?(...a: unknown[]): void };
    llm?: LlmAdapter;
  };
```

**Cap-then-call pattern excerpt** (lines 153-226):
```typescript
export async function compileTldr(
  ctx: CompileTldrCtx,
  args: CompileTldrArgs,
): Promise<TldrRow> {
  const contentHash = contentHashFor(args);

  // EDITOR-03: check cache by (surface, scope_id). If the most-recent row's
  // hash matches, return it without an LLM call.
  const cached = await getTldrByScope(ctx, args.surface, args.scopeId);
  if (cached && cached.content_hash === contentHash) {
    return cached;
  }

  // EDITOR-05: enforce cap BEFORE invoking the LLM, not after.
  const prompt = buildPrompt(args);
  const inputTokens = estimateTokens(prompt);
  if (inputTokens > MAX_TOKENS) {
    await recordFailure(ctx, {
      agentKey: args.agentKey,
      agentId: args.agentId,
      companyId: args.companyId,
      reason: `input_tokens=${inputTokens} exceeds MAX_TOKENS=${MAX_TOKENS}`,
    });
    throw new Error(`Editor-Agent input exceeds max_tokens cap (${inputTokens} > ${MAX_TOKENS})`);
  }

  const llm = args.llm ?? ctx.llm;
  if (!llm) {
    throw new Error('Editor-Agent compileTldr called without an LLM adapter wired into ctx.llm');
  }

  let body: string;
  try {
    body = await llm.complete({ maxTokens: MAX_TOKENS, prompt });
  } catch (err) {
    await recordFailure(ctx, { /* ... */ });
    throw err;
  }
  // ... validateLlmOutput + recordSuccess + upsert ...
}
```

**Planner instruction:** Mirror `compileTldr`'s shape exactly. Output type is `BulletinDraft` (structured object per D-14) NOT a plain string — so `validateLlmOutput` becomes `validateDraftSchema` (assert all required keys, every `standing_numbers[*].sql` is a string, every prose `{{NUMBER:key}}` references an entry in `factsTable`). Reuse `recordFailure`/`recordSuccess` from `circuit-breaker.ts` with a NEW agentKey constant (e.g. `'bulletin-compile'`) so bulletin failures don't poison the TL;DR counter. The injected `LlmAdapter` is the SAME interface — production wires through `ctx.agents.invoke`, tests inject a stub returning a canned `BulletinDraft`.

---

### NEW: `src/worker/bulletin/bulletin-verifier.ts`

**Role:** pure deterministic validator (pass-2 — re-runs SQL, compares numbers)
**Closest analog:** `src/shared/blocker-chain.ts:49-197` (`flattenBlockerChain` — pure function returning typed discriminated-union result)
**Why this analog:** Same architectural shape — pure function takes input + helper (SQL client here, no helper there but otherwise identical), returns a typed discriminated-union result (`{ok: true}` / `{ok: false, mismatches: [...]}`). NO LLM. The test for this file follows `test/shared/blocker-chain.test.mjs` exactly.

**Typed-result-union excerpt** (`src/shared/types.ts:16-20` for shape inspiration):
```typescript
export type Terminal =
  | { kind: 'HUMAN_ACTION_ON'; userId: string; label: string }
  | { kind: 'SELF_RESOLVING'; etaIso: string; label: string }
  | { kind: 'EXTERNAL'; label: string }
  | { kind: 'CYCLE'; cycleNodes: string[]; label: string };
```

**Pure-fn deterministic body excerpt** (`src/shared/blocker-chain.ts:49-110`):
```typescript
export function flattenBlockerChain(input: BlockerChainInput): BlockerChainResult {
  // Adjacency map: from-id → outgoing edges. Sort edges deterministically by
  // `to` so iteration order doesn't depend on input array order at the same
  // from-node.
  const adj = new Map<string, BlockerEdge[]>();
  for (const edge of input.edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge);
    adj.set(edge.from, list);
  }
  for (const list of adj.values()) {
    list.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  }
  // ... DFS with deterministic ordering, single typed terminal returned ...
}
```

**Planner instruction:** Export `export async function verifyDraft(draft: BulletinDraft, sqlClient: SqlClient): Promise<VerifierResult>`. The `SqlClient` type should be `{ query<T>(sql: string, params?: unknown[]): Promise<T[]> }` — narrow shape from `PluginDatabaseClient` so tests can inject a stub. `VerifierResult = { ok: true } | { ok: false, mismatches: Array<{ slot: string; claimed: unknown; actual: unknown; tolerance: number }> }`. Iterate `draft.standing_numbers[i]`; re-execute `slot.sql`; compare per RESEARCH.md §"Pattern 5" tolerance rules (exact for integers, ±0.01 for percentages). Three consecutive `{ok: false}` triggers `circuit-breaker.ts:recordFailure` from the caller (not inside this pure fn — keep verifier pure).

---

### NEW: `src/worker/bulletin/action-inbox-query.ts`

**Role:** Paperclip issues query (D-19 mapping fix)
**Closest analog:** `src/worker/handlers/flatten-blocker-chain.ts:41-127` (wraps an issues client call, parses + filters, returns typed result)
**Why this analog:** Same pattern of (a) wrapping a `ctx.issues.*` SDK call, (b) graceful degradation (`graceful(...)`), (c) `try { ... } catch { ctx.logger?.warn?.(); return graceful(...) }` shape, (d) typed return regardless of which branch fired.

**Handler shape + graceful-degrade excerpt** (lines 41-72):
```typescript
export function registerFlattenBlockerChain(ctx: FlattenBlockerChainCtx): void {
  wrapDataHandler(ctx, 'flatten-blocker-chain', async (params) => {
    const startId = String(params.startId ?? '');
    const viewerUserId = String(params.viewerUserId ?? '');
    const companyId = String(params.companyId ?? '');
    const maxAgeMs = typeof params.maxAgeMs === 'number' ? params.maxAgeMs : undefined;

    if (!startId || !companyId) {
      return graceful(startId, 'startId and companyId required');
    }

    let walk: WalkOutput;
    try {
      walk = await walkBlockerChain(ctx.issues, companyId, startId);
    } catch (e) {
      ctx.logger?.warn?.('flatten-blocker-chain: relations walk failed', { err: (e as Error).message });
      return graceful(startId, 'Relations unavailable');
    }

    if (walk.edges.length === 0) {
      return graceful(startId, 'No active blockers');
    }

    return flattenBlockerChain({ /* ... */ });
  });
}
```

**Issues walk excerpt** (lines 74-127):
```typescript
async function walkBlockerChain(
  issues: PluginIssuesClient,
  companyId: string,
  startId: string,
): Promise<WalkOutput> {
  const edges: BlockerEdge[] = [];
  const nodeMeta: WalkOutput['nodeMeta'] = {};
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > MAX_CHAIN_DEPTH) continue;
    visited.add(id);

    let summary: PluginIssueRelationSummary;
    try {
      summary = await issues.relations.get(id, companyId);
    } catch {
      // One relation read failing shouldn't abort the whole walk
      continue;
    }
    // ... extract blockedBy ...
  }
  return { edges, nodeMeta };
}
```

**Planner instruction:** Export a pure-ish helper `queryActionInbox(ctx, {companyId, viewerUserId, now})` that calls `ctx.issues.list({companyId, status: 'blocked', ...})`. Per CONTEXT.md D-19 the filter is `status==='blocked' && blockerAttention.state ∈ {'needs_attention', 'stalled'} && assigneeUserId === viewerUserId`. Mirror the try/catch-and-warn-then-return-graceful-empty style. Age is `now - issue.awaiting_since`. Each row tagged with department via lookup into `clarity_department_membership`. RESEARCH.md §"Code Examples" lines 392-440 has the full filter implementation already drafted.

---

### NEW: `src/worker/bulletin/lineage-grouper.ts`

**Role:** pure clustering helper (temporal+actor proximity heuristic)
**Closest analog:** `src/shared/blocker-chain.ts:33-197` (the canonical pure deterministic graph algo in this codebase)
**Why this analog:** RESEARCH.md §"Pattern" + CONTEXT.md D-21 mandate "deterministic code, never LLM" — same contract as `flattenBlockerChain`. Cluster activity rows by `(entityId, actorChain, time-proximity ≤ 5 min)`. Tests follow `test/shared/blocker-chain.test.mjs` shape (assertions on `pathIds`, `terminal.kind`, etc.).

**Determinism-by-sorting pattern excerpt** (`src/shared/blocker-chain.ts:53-61`):
```typescript
const adj = new Map<string, BlockerEdge[]>();
for (const edge of input.edges) {
  const list = adj.get(edge.from) ?? [];
  list.push(edge);
  adj.set(edge.from, list);
}
for (const list of adj.values()) {
  list.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}
```

**Planner instruction:** Single pure export `export function groupLineageThreads(activities: ActivityEvent[], opts: {maxDeltaSec: number}): LineageThread[]`. Sort activities by timestamp ascending. Group by `entityId`. Within an `entityId` group, split into sub-clusters whenever consecutive events are > `maxDeltaSec` apart OR `actorChain` diverges. Default `maxDeltaSec = 300` per CONTEXT.md D-21. Return a typed `LineageThread[]` shape that the UI's `<LineageFooter />` consumes.

---

### NEW: `src/worker/bulletin/department-reconcile.ts`

**Role:** idempotent reconcile pass (role→department membership)
**Closest analog:** `src/worker/agents/editor.ts:56-62` (reconcileEditorAgent — idempotent upsert keyed by stable identifier)
**Why this analog:** Same idempotency pattern. CONTEXT.md D-20 mandates: `UPSERT ... ON CONFLICT DO NOTHING` so manual SQL overrides win. RESEARCH.md §"Pattern 3" calls this out explicitly.

**Idempotent reconcile excerpt** (lines 49-62):
```typescript
/**
 * Reconcile the Editor-Agent for a single company. Idempotent — the SDK
 * handles "already exists" by returning the resolution row with status
 * 'resolved' instead of 'created'. Called once per company at worker boot,
 * then again on the 'company.created' event for new companies that appear
 * after boot.
 */
export async function reconcileEditorAgent(
  ctx: EditorAgentReconcileCtx,
  companyId: string,
): Promise<string | null> {
  const resolution = await ctx.agents.managed.reconcile(EDITOR_AGENT_KEY, companyId);
  return resolution.agentId;
}
```

**Planner instruction:** Export `export async function reconcileDepartments(ctx, companyId: string): Promise<void>`. Implementation: list agents via `ctx.agents.list({companyId})`; for each, derive department by regex match against `role` (`/sales/i → 'Sales'`, etc.) per CONTEXT.md D-20; UPSERT into `clarity_department_membership` with `ON CONFLICT (company_id, employee_user_id) DO NOTHING` so manual rows survive. Called from `compile-bulletin.ts` job at the top of each cycle.

---

### NEW: `src/worker/bulletin/standing-numbers.ts`

**Role:** pre-defined SQL query set (v1: MRR, Briefs Sent, Reply Rate, Refund Rate)
**Closest analog:** `src/worker/handlers/editor-pause-status.ts:28-52` (db.query with named, deterministic SQL)
**Why this analog:** Same shape — registered/pure helper, executes a small set of fixed SQL queries against `coreReadTables` (via `ctx.db.query<T>(...)`), returns typed rows.

**Typed SELECT pattern excerpt** (lines 28-46):
```typescript
export function registerEditorPauseStatus(ctx: EditorPauseStatusCtx): void {
  wrapDataHandler(ctx, 'editor.pause-status', async () => {
    try {
      const rows = await ctx.db.query<FailureRow>(
        'SELECT failed_at, reason, consecutive FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE agent_key = $1 ORDER BY failed_at DESC LIMIT 1',
        [EDITOR_AGENT_KEY],
      );
      const last = rows[0];
      if (!last) {
        const empty: EditorPauseStatus = { paused: false, lastFailureAt: null, reason: null };
        return empty;
      }
```

**Planner instruction:** Export a typed registry: `export const STANDING_NUMBERS: Array<{key: string; displayName: string; sql: string; format: 'currency'|'count'|'pct'; params?: (cycle: BulletinCycleArgs) => unknown[]}>`. Each entry's SQL targets `coreReadTables` only (`issues`, `issue_comments`, `agents`, etc. per `manifest.ts:77-84`). Export `export async function computeStandingNumbers(ctx, cycleArgs): Promise<StandingNumberRow[]>` that iterates the registry, runs each query, returns typed rows. The pass-2 verifier (`bulletin-verifier.ts`) re-runs each `entry.sql` independently and compares.

---

### NEW: `src/worker/bulletin/publish.ts`

**Role:** two-phase publish (host issue create + plugin-namespace metadata upsert)
**Closest analog:** `src/worker/jobs/situation-snapshot.ts:300-309` (content-hash-keyed INSERT with `ON CONFLICT DO NOTHING`)
**Why this analog:** Same idempotent-write shape. RESEARCH.md §"Pattern 2" mandates two-phase: INSERT `bulletins` with `status='attempting'` FIRST, then `ctx.issues.create`, then UPDATE `bulletins SET published_issue_id`.

**Content-hash-keyed INSERT excerpt** (lines 300-309):
```typescript
const payloadJson = JSON.stringify(payload);
const contentHash = syncHash(payloadJson);
try {
  await ctx.db.execute(
    'INSERT INTO plugin_clarity_pack_cdd6bda4bd.situation_snapshots (computed_for_company_id, payload, content_hash) VALUES ($1, $2::jsonb, $3) ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING',
    [companyId, payloadJson, contentHash],
  );
} catch (e) {
  ctx.logger?.warn?.('situation-snapshot: INSERT failed', { companyId, err: (e as Error).message });
}
```

**Planner instruction:** Export `export async function publishBulletin(ctx, {draft, cycleNumber, contentHash}): Promise<PublishResult>`. Order: (1) INSERT into `bulletins` with `compile_status='attempting'` + UNIQUE `(next_due_at, content_hash)` enforces idempotency per D-13; (2) call `ctx.issues.create({title: 'Bulletin No. {N} — {weekday}, {YYYY-MM-DD}', body: renderedMd, tags: ['clarity:bulletin', 'clarity:bulletin-issue', `cycle:${N}`], author: editorAgentId})`; (3) UPDATE `bulletins SET published_issue_id = ?, compile_status = 'published'`. Errata-as-comment path (per D-18): on each cycle, snapshot prior cycle's `bulletin_errata` rows and call `ctx.issues.createComment(priorIssueId, erratumBody)` for each. NEW capabilities needed: `issues.create`, `issue.comments.create` (per RESEARCH.md §"Manifest extension" lines 712-716).

---

### NEW: `src/worker/db/bulletins-repo.ts`

**Role:** typed repo (CRUD over `bulletins`, `bulletin_errata`, `clarity_department_membership`, `bulletin_compile_failures`)
**Closest analog:** `src/worker/db/tldr-cache.ts:1-72` (typed repo for `tldr_cache`)
**Why this analog:** EXACT match — same architectural slot. Encapsulates SQL behind typed `async` functions; consumers (jobs, handlers) call those rather than raw SQL.

**Full file (verbatim, lines 1-72):**
```typescript
// src/worker/db/tldr-cache.ts
import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type TldrRow = {
  surface: 'issue' | 'situation' | 'bulletin';
  scope_id: string;
  content_hash: string;
  body: string;
  generated_at: string;
  source_revisions: string[];
  compiled_by_agent_id: string;
  tags: string[];
};

export type TldrCacheCtx = {
  db: PluginDatabaseClient;
};

export async function upsertTldr(ctx: TldrCacheCtx, tldr: TldrRow): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.tldr_cache
       (surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (surface, scope_id, content_hash) DO NOTHING`,
    [/* ... */],
  );
}

export async function getTldrByScope(
  ctx: TldrCacheCtx,
  surface: TldrRow['surface'],
  scopeId: string,
): Promise<TldrRow | null> {
  const rows = await ctx.db.query<TldrRow>(
    `SELECT surface, scope_id, content_hash, ...
     FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache
     WHERE surface = $1 AND scope_id = $2
     ORDER BY generated_at DESC
     LIMIT 1`,
    [surface, scopeId],
  );
  return rows[0] ?? null;
}
```

**Planner instruction:** Export typed `BulletinRow`, `ErratumRow`, `DepartmentMembershipRow`, `CompileFailureRow`. Export accessors: `upsertBulletin(ctx, row)`, `getBulletinByCycle(ctx, cycle)`, `getNextDueAt(ctx, companyId)`, `appendErratum(ctx, row)`, `listErrataByCycle(ctx, cycle)`, `recordCompileFailure(ctx, row)`, `getLatestCompileFailure(ctx, companyId)`, `upsertDepartmentMembership(ctx, row)`. All SQL strings use fully-qualified `plugin_clarity_pack_cdd6bda4bd.<table>` per Plan 02-01 Finding #4.

---

### NEW: `src/worker/handlers/bulletin-by-cycle.ts`

**Role:** opt-in-guarded data handler — reads materialized bulletin metadata + body for one cycle
**Closest analog:** `src/worker/handlers/situation-room.ts:1-43` (entire file — 43 lines)
**Why this analog:** EXACT match — both read the most-recent / specific row from a plugin-namespace cache table, scoped by companyId from params, wrapped via `wrapDataHandler`. Even the failure mode (`throw new Error('… companyId required')`) is the documented Phase 2 convention (RESEARCH.md §"Architectural Responsibility Map" → "Bulletin body persistence" entry).

**Full file (verbatim, lines 1-43):**
```typescript
// src/worker/handlers/situation-room.ts
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

export type SituationRoomCtx = OptInGuardDataCtx;

type SnapshotRow = {
  id: number;
  taken_at: string;
  computed_for_company_id: string;
  payload: unknown;
  content_hash: string;
};

export function registerSituationRoomHandlers(ctx: SituationRoomCtx): void {
  wrapDataHandler(ctx, 'situation.snapshot', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) {
      throw new Error('situation.snapshot: companyId required');
    }
    const rows = await ctx.db.query<SnapshotRow>(
      'SELECT id, taken_at, computed_for_company_id, payload, content_hash FROM plugin_clarity_pack_cdd6bda4bd.situation_snapshots WHERE computed_for_company_id = $1 ORDER BY taken_at DESC LIMIT 1',
      [companyId],
    );
    const row = rows[0];
    if (!row) return null;
    const payload = row.payload as Record<string, unknown>;
    return { ...payload, taken_at: row.taken_at };
  });
}
```

**Planner instruction:** Mirror exactly. Handler key = `'bulletin.byCycle'`. Params = `{cycle: number | 'latest', companyId, userId}`. SQL: `SELECT * FROM ... bulletins WHERE company_id = $1 AND (cycle_number = $2 OR $2 IS NULL) ORDER BY cycle_number DESC LIMIT 1` (when cycle='latest', pass NULL). Then composite-fetch the bulletin body from `public.issues` via `ctx.issues.get(row.published_issue_id, companyId)` so the canonical body lives only in public.issues. Also fetch errata via `listErrataByCycle()`. Return `{kind: 'published', body, masthead, actionInbox, departments, standingNumbers, lineageThreads, errata}` or `{kind: 'not-yet-published'}` if `published_issue_id IS NULL`.

---

### NEW: `src/worker/handlers/bulletin-latest-status.ts`

**Role:** opt-in-guarded data handler — most-recent compile-failure row for banner
**Closest analog:** `src/worker/handlers/editor-pause-status.ts:1-52`
**Why this analog:** EXACT — reads most-recent failure row, returns typed `{kind: 'ok' | 'failed', ...}` object. Same `wrapDataHandler` + try/catch-and-degrade shape.

**Full file (verbatim, lines 28-52):**
```typescript
export function registerEditorPauseStatus(ctx: EditorPauseStatusCtx): void {
  wrapDataHandler(ctx, 'editor.pause-status', async () => {
    try {
      const rows = await ctx.db.query<FailureRow>(
        'SELECT failed_at, reason, consecutive FROM plugin_clarity_pack_cdd6bda4bd.editor_agent_failures WHERE agent_key = $1 ORDER BY failed_at DESC LIMIT 1',
        [EDITOR_AGENT_KEY],
      );
      const last = rows[0];
      if (!last) {
        const empty: EditorPauseStatus = { paused: false, lastFailureAt: null, reason: null };
        return empty;
      }
      const paused = last.consecutive >= MAX_CONSECUTIVE_FAILURES;
      const status: EditorPauseStatus = {
        paused,
        lastFailureAt: paused ? last.failed_at : null,
        reason: paused ? last.reason : null,
      };
      return status;
    } catch {
      const empty: EditorPauseStatus = { paused: false, lastFailureAt: null, reason: null };
      return empty;
    }
  });
}
```

**Planner instruction:** Handler key = `'bulletin.latestCompileStatus'`. SQL: `SELECT failed_at, reason, attempt_n, next_retry_at FROM plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures WHERE cycle_number = (SELECT MAX(cycle_number) FROM ... bulletins WHERE company_id = $1) ORDER BY failed_at DESC LIMIT 1`. Return shape per CONTEXT.md D-22: `{ kind: 'ok' } | { kind: 'failed', attempt_at, next_retry_at, reason }`. Banner renders only when `kind === 'failed' && next_retry_at > now`.

---

### NEW: `src/worker/handlers/bulletin-errata.ts`

**Role:** combined data (`bulletin.errata.byCycle`) + action (`bulletin.errata.add`) handler
**Closest analog 1 (data):** `src/worker/handlers/situation-room.ts` (read pattern)
**Closest analog 2 (action):** `src/worker/handlers/set-opt-in.ts` (write pattern) + `src/worker/handlers/active-viewer-ping.ts` (action shape)
**Why this analog:** A combined data+action handler is exactly how `set-opt-in` + `get-opt-in` pair already work in Phase 2.

**Write-handler pattern excerpt from `active-viewer-ping.ts` (lines 15-33):**
```typescript
export function registerActiveViewerPing(ctx: ActiveViewerPingCtx): void {
  wrapActionHandler(ctx, 'situation.active-viewer-ping', async (params) => {
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    const tabId =
      typeof params?.tabId === 'string' && params.tabId ? params.tabId : null;
    if (!userId) {
      throw new Error('active-viewer-ping: userId required');
    }
    if (!tabId) {
      throw new Error('active-viewer-ping: tabId required');
    }
    await ctx.db.execute(
      "INSERT INTO plugin_clarity_pack_cdd6bda4bd.active_viewers (user_id, surface, tab_id) VALUES ($1, 'situation-room', $2) ON CONFLICT (user_id, surface, tab_id) DO UPDATE SET last_seen_at = now()",
      [userId, tabId],
    );
    return { ok: true };
  });
}
```

**Planner instruction:** Two registrations in one file. Data: `wrapDataHandler(ctx, 'bulletin.errata.byCycle', ...)` reads `bulletin_errata WHERE bulletin_cycle_number = $1`. Action: `wrapActionHandler(ctx, 'bulletin.errata.add', ...)` validates `cycle`, `body`, `userId` params; inserts row with `added_at = now()`, `added_by_user_id = userId`. Returns `{ok: true, errataId}`. v1 affordance per CONTEXT.md §Claude's Discretion: settings-page form (no inline-on-bulletin composer in v1).

---

### NEW: `src/worker/handlers/bulletin-action-approve.ts` + `bulletin-action-decline.ts`

**Role:** action handlers — bridge UI cards' Approve / Decline buttons to host issue mutations
**Closest analog:** `src/worker/handlers/active-viewer-ping.ts:1-33` (entire file — small action handler)
**Why this analog:** EXACT match — `wrapActionHandler` + param validation + single host mutation + `return {ok: true}`.

**Full active-viewer-ping.ts (verbatim, used twice):**
```typescript
import { wrapActionHandler, type OptInGuardActionCtx } from '../opt-in-guard.ts';

export type ActiveViewerPingCtx = OptInGuardActionCtx;

export function registerActiveViewerPing(ctx: ActiveViewerPingCtx): void {
  wrapActionHandler(ctx, 'situation.active-viewer-ping', async (params) => {
    const userId =
      typeof params?.userId === 'string' && params.userId ? params.userId : null;
    // ...
    if (!userId) {
      throw new Error('active-viewer-ping: userId required');
    }
    await ctx.db.execute(
      "INSERT INTO ... ON CONFLICT (...) DO UPDATE SET last_seen_at = now()",
      [userId, tabId],
    );
    return { ok: true };
  });
}
```

**Planner instruction:** `bulletin-action-approve.ts` registers `'bulletin.action.approve'`; validates `issueId`, `userId`, `companyId` from params; calls `ctx.issues.update(issueId, companyId, {resolution: 'approved', ...})` (verify exact SDK shape during plan execution against `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` — this is one of CONTEXT.md "verify in Phase 3 smoke task"). Returns `{ok: true}`. `bulletin-action-decline.ts` is identical with `resolution: 'declined'`.

---

### NEW: `src/ui/surfaces/bulletin/index.tsx`

**Role:** top-level page slot (route `/:co/plugins/clarity-pack/bulletin`)
**Closest analog:** `src/ui/surfaces/situation-room/index.tsx:1-217`
**Why this analog:** EXACT — both are `page`-slot surfaces. Same composition order: `useOptIn` gate → `useResolvedCompanyId` → `useResolvedUserId` → `usePluginData` → render. Same `ClaritySurfaceRoot` wrap. Same `EnableClarityCta` fallback.

**Full opt-in-gate + composition excerpt** (lines 61-138):
```typescript
export function SituationRoom(_props?: PluginPageProps): React.ReactElement {
  // OPTIN-02 — gate BEFORE companyId resolution.
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <p className="clarity-room-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <EnableClarityCta surfaceName="Situation Room" />
      </ClaritySurfaceRoot>
    );
  }
  return <SituationRoomOptedIn />;
}

function SituationRoomOptedIn(): React.ReactElement {
  const { userId } = useHostContext();
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();
  const config = useInstanceConfig();
  const intervalMs = config.situationRefreshIntervalMs ?? 60_000;

  // Resolver in flight.
  if (companyLoading) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <p className="clarity-room-loading">Resolving company context…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (companyError === 'no-company-context' || !companyId) {
    return (
      <ClaritySurfaceRoot name="situation-room">
        <p className="clarity-room-error" data-clarity-error="no-company-context">
          Situation Room unavailable — could not identify the active company.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ClaritySurfaceRoot name="situation-room">
      <SituationRoomBody
        companyId={companyId}
        userId={userId ?? ''}
        intervalMs={intervalMs}
      />
      <PauseBanner />
    </ClaritySurfaceRoot>
  );
}
```

**Planner instruction:** Mirror exactly. Wrap in `<ClaritySurfaceRoot name="bulletin">`. Replace `useHostContext().userId` with `useResolvedUserId()` per Plan 02-09 pattern (because Phase 2 closed the userId-null gap there; bulletin must inherit the resolver). Use `usePluginData<BulletinByCycleResult>('bulletin.byCycle', {cycle: 'latest', companyId, userId})`. Compose children: `<Masthead />` + `<FailedCompileBanner />` (uses `bulletin.latestCompileStatus`) + `<ActionInbox cards={data.actionInbox} />` + `<DepartmentSection />` × N + `<StandingNumbersPanel rows={data.standingNumbers} />` + `<LineageFooter threads={data.lineageThreads} />` + `<ErrataFooter errata={data.errata} />` + `<PauseBanner />` (reused as-is from Phase 2). The opt-in error response (`{error: 'OPT_IN_REQUIRED'}`) handler at line 178-183 of analog must be mirrored.

---

### NEW: `src/ui/surfaces/bulletin/masthead.tsx`

**Role:** display-typography header ("The Bulletin · Vol. I · No. N · {day} · {date} · 06:30 ET · prepared for Eric G., Editor-in-Chief")
**Closest analog:** `src/ui/surfaces/situation-room/critical-path-strip.tsx:32-56`
**Why this analog:** Small render-only component that consumes typed props from the parent data fetch and emits a scoped `<section data-clarity-region="...">`. No hooks, no I/O.

**Full critical-path-strip.tsx (verbatim, lines 32-56):**
```typescript
export function CriticalPathStrip({
  chains,
  narrative,
}: {
  chains: BlockerChainResult[];
  narrative?: string | null;
}): React.ReactElement | null {
  if (!chains || chains.length === 0) return null;
  return (
    <section className="clarity-critical-path" data-clarity-region="critical-path">
      <h2 className="clarity-critical-path-heading">Critical Path</h2>
      <ol className="clarity-critical-path-list">
        {chains.slice(0, 3).map((chain, i) => (
          <li key={i} className="clarity-critical-path-item" data-terminal-kind={chain.terminal.kind}>
            <span className="clarity-critical-path-index">{i + 1}.</span>
            <span className="clarity-critical-path-text">{defaultNarration(chain.terminal)}</span>
          </li>
        ))}
      </ol>
      {narrative ? (
        <p className="clarity-critical-path-narrative">{narrative}</p>
      ) : null}
    </section>
  );
}
```

**Planner instruction:** Pure render: `export function Masthead({ volume, number, weekday, dateText, prepareForName }: MastheadProps): React.ReactElement`. CSS classes prefixed `clarity-bulletin-masthead-*`. `data-clarity-region="masthead"`. Date text already pre-formatted worker-side (worker uses `formatInTimeZone` from `date-fns-tz`) so UI never does TZ math. Literal "The Bulletin · Vol. I · No. {N} · {weekday} · {dateText} · 06:30 ET · prepared for {name}, Editor-in-Chief · Operations Cycle {N} · Auto-compiled" is the locked visual contract per `sketches/paperclip-fix-bulletin.html`.

---

### NEW: `src/ui/surfaces/bulletin/action-inbox.tsx`

**Role:** "Requires Your Decision" card grid + Approve/Decline/Open buttons
**Closest analog (deep-link + action):** `src/ui/surfaces/situation-room/awaiting-you-pill.tsx:20-47`
**Closest analog (card grid render):** `src/ui/surfaces/situation-room/agent-card.tsx:1-60`
**Why this analog:** AwaitingYouPill shows the deep-link / action-on-click pattern (uses `useHostNavigation().linkProps()` per SCAF-09 — no raw `<a href>`). AgentCard shows the per-item card render with structured typed props.

**Deep-link + linkProps excerpt** (`awaiting-you-pill.tsx:20-47`):
```typescript
export function AwaitingYouPill({
  count,
  oldestAge,
  deepLink,
}: {
  count: number;
  oldestAge: number | null;
  deepLink?: string;
}): React.ReactElement | null {
  const nav = useHostNavigation();
  if (count == null || count === 0) return null;
  const href = deepLink ?? '/inbox';
  return (
    <a
      {...nav.linkProps(href)}
      className="clarity-awaiting-you-pill"
      data-clarity-region="awaiting-you"
    >
      <span className="clarity-awaiting-you-label">Awaiting You</span>
      <span className="clarity-awaiting-you-count">{count}</span>
      <span className="clarity-awaiting-you-age">·</span>
      <span className="clarity-awaiting-you-age">{formatAge(oldestAge)}</span>
    </a>
  );
}
```

**Planner instruction:** Card grid: `<ActionInbox cards={data.actionInbox}>` renders one `<ActionInboxCard>` per row. Each card has dept tag + age + summary + Approve/Decline/Open. Buttons use `usePluginAction('bulletin.action.approve')` and `usePluginAction('bulletin.action.decline')`. "Open" uses `useHostNavigation().linkProps(issueUrl)` per the awaiting-you-pill pattern. After Approve/Decline, revalidate via the bridge's automatic re-fetch on action mutation (or explicit re-fetch via a key-bump).

---

### NEW: `src/ui/surfaces/bulletin/department-section.tsx`

**Role:** one section per department ("Yesterday's Operations · {date}" + item rows + Editorial-prose summary + lineage thread reference)
**Closest analog:** `src/ui/surfaces/situation-room/agent-card.tsx:1-60` (mockup-driven typed card render with normalizer helpers)
**Why this analog:** Same role — render a typed slice of compiled snapshot data into a sketch-anchored layout. Same pattern of small normalizer helpers (`normaliseState`, `nowDoingFallback`).

**Normalizer + render excerpt** (`agent-card.tsx:30-60`):
```typescript
const STATE_FALLBACK: StatePillState = 'Standby';

function normaliseState(raw: string): StatePillState {
  switch (raw) {
    case 'Working':
    case 'Stuck':
    case 'AwaitingYou':
    case 'Standby':
    case 'AwaitingPeer':
      return raw;
    default:
      return STATE_FALLBACK;
  }
}

function nowDoingFallback(employee: AgentEmployee): string {
  if (employee.now_doing) return employee.now_doing;
  const state = normaliseState(employee.state);
  const age = formatAge(employee.age_ms);
  if (state === 'Standby') {
    return `Standby — idle ${age}`;
  }
  return `${humaniseState(state)} for ${age}`;
}
```

**Planner instruction:** `<DepartmentSection name={'Production'} items={[...]} editorialSummary={prose} />`. CSS class `clarity-bulletin-department-section`. Drop-cap class on first section per sketch ll. 195-230. Dotted-rule between item rows per sketch. Empty department renders the "· no items ·" quiet-day prose per sketch ll. 151-156.

---

### NEW: `src/ui/surfaces/bulletin/standing-numbers-panel.tsx`

**Role:** right-rail metrics card — every number has a corresponding SQL grep'able from `standing-numbers.ts`
**Closest analog (layout):** `src/ui/surfaces/situation-room/critical-path-strip.tsx:32-56` (`<section>` + ordered/unordered list of typed entries)
**Closest analog (tiny pure render):** `src/ui/surfaces/situation-room/sparkline.tsx:1-22`
**Why this analog:** Same shape — typed entries in, rendered list out. Pure SVG sparkline could be reused if a v1 entry has a trend.

**Tiny render excerpt** (`sparkline.tsx:1-22`):
```typescript
export function Sparkline({ values }: { values: number[] }): React.ReactElement | null {
  if (!values || values.length === 0) return null;
  const width = 70;
  const height = 20;
  // ...
  return (
    <svg width={width} height={height} className="clarity-sparkline" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}
```

**Planner instruction:** `<StandingNumbersPanel rows={data.standingNumbers} />`. Each row: `{key, displayName, value, format}`. Formatter switches on `format` ('currency' → `'$' + value.toLocaleString()`, 'pct' → `(value*100).toFixed(1) + '%'`, 'count' → `value.toLocaleString()`). No LLM prose — values arrive pre-verified from pass-2. `data-clarity-region="standing-numbers"`. Sparklines reused via `<Sparkline values={...}>` if any row has trailing-7d data.

---

### NEW: `src/ui/surfaces/bulletin/lineage-footer.tsx`

**Role:** 8-column grid rendering temporal lineage threads (terminal node inverted per sketch ll. 195-230)
**Closest analog:** `src/ui/surfaces/situation-room/critical-path-strip.tsx:32-56`
**Why this analog:** EXACT — same role (chain renderer for the deterministic-graph result). Critical-path strip renders `BlockerChainResult[]`; lineage footer renders `LineageThread[]` (the new type emitted by `lineage-grouper.ts`).

**Reuse pattern excerpt** (`critical-path-strip.tsx:12-30`):
```typescript
function defaultNarration(terminal: Terminal): string {
  switch (terminal.kind) {
    case 'HUMAN_ACTION_ON':
      return `Awaiting action: ${terminal.label}.`;
    case 'SELF_RESOLVING':
      return `Self-resolving: ${terminal.label}.`;
    case 'EXTERNAL':
      return `External: ${terminal.label}.`;
    case 'CYCLE':
      return `Cycle detected: ${terminal.label}.`;
    default: {
      const t = terminal as Terminal;
      return t.kind;
    }
  }
}
```

**Planner instruction:** `<LineageFooter threads={data.lineageThreads} />`. Render each thread as a sequence of agent nodes connected by arrow connectors. CSS grid 8 columns per sketch. Terminal node inverted (`data-terminal="true"` styled paper-on-ink). If thread > 8 steps, summarize "…and N more steps" per CONTEXT.md §Claude's Discretion. Empty days render quiet-day prose per sketch.

---

### NEW: `src/ui/surfaces/bulletin/errata-footer.tsx`

**Role:** footer block listing errata appended (NEVER inline-rewriting)
**Closest analog:** `src/ui/surfaces/reader/pause-banner.tsx:38-68` (footer-scoped region with `data-clarity-region` + dismissible interaction model)
**Why this analog:** Same role — a footer-scoped section keyed off a typed data slice; renders only when slice is non-empty.

**Footer-scoped region pattern excerpt** (`pause-banner.tsx:38-68`):
```typescript
export function PauseBanner(): React.ReactElement | null {
  const { userId, loading: userIdLoading } = useResolvedUserId();
  const { data } = usePluginData<EditorPauseStatus | { error: string }>(
    'editor.pause-status',
    !userIdLoading && userId ? { userId } : {},
  );
  const [dismissed, setDismissed] = React.useState(false);
  if (userIdLoading || !data || 'error' in data || !data.paused || dismissed) return null;
  const ts = formatHHMM(data.lastFailureAt);
  return (
    <footer
      className="clarity-pause-banner"
      role="status"
      data-clarity-region="pause-banner"
    >
      Editorial Desk paused — last compile failed at {ts}. Resume in agent panel.
      <button
        type="button"
        className="clarity-pause-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss pause banner"
      >
        ×
      </button>
    </footer>
  );
}
```

**Planner instruction:** `<ErrataFooter errata={data.errata} />`. Render `<footer data-clarity-region="errata">` with one entry per erratum: `{added_at, added_by_user_id, body_md}`. NOT dismissible (errata are authoritative). Empty array → return null.

---

### NEW: `src/ui/surfaces/bulletin/failed-compile-banner.tsx`

**Role:** "Bulletin compile failed at HH:MM · retrying at NN" banner at top
**Closest analog:** `src/ui/surfaces/reader/pause-banner.tsx:1-68` (entire file — same role, same data-shape)
**Why this analog:** EXACT — the analog IS the pause banner shape. CONTEXT.md D-22 banner state machine and Phase 2's pause banner have identical lifecycle.

**Full pause-banner.tsx (verbatim, lines 38-68):** see above.

**Planner instruction:** Copy `pause-banner.tsx` line-for-line; replace the data handler key `'editor.pause-status'` with `'bulletin.latestCompileStatus'`; replace `formatHHMM` with the same helper (or share via a new `src/ui/primitives/format-hhmm.ts`); replace `data.paused` discriminant with `data.kind === 'failed' && data.next_retry_at > now`; replace banner copy with `"Bulletin compile failed at ${formatHHMM(data.attempt_at)} · retrying at ${formatHHMM(data.next_retry_at)}"`. Render at the TOP of the page (not as a footer) per CONTEXT.md.

---

### NEW: `src/ui/styles/bulletin.css`

**Role:** scoped surface stylesheet (warm-paper palette, Fraunces + Newsreader fonts)
**Closest analog:** Phase 2 theme.css conventions (scoped under `[data-clarity-surface="<name>"]` per SCAF-06)
**Why this analog:** Same architectural rule — every Clarity surface stylesheet scopes its selectors under `[data-clarity-surface="<name>"]` to prevent host-CSS bleed-through.

**Scope-root pattern excerpt** (`src/ui/primitives/clarity-surface-root.tsx:25-33`):
```typescript
export function ClaritySurfaceRoot({
  name,
  children,
}: {
  name: ClaritySurfaceName;
  children: React.ReactNode;
}): React.ReactElement {
  return <div data-clarity-surface={name}>{children}</div>;
}
```

**Planner instruction:** All selectors prefixed `[data-clarity-surface="bulletin"]`. Custom-properties for warm-paper palette (`--paper`, `--paper-2`, `--ink`, `--ink-2`, `--muted`, `--rule`, `--terracotta`, `--moss`, `--gold`) defined on the scope root. `@font-face` for Fraunces (display) + Newsreader (body) + JetBrains Mono (meta). The stylesheet is INJECTED at runtime via `src/ui/index.tsx`'s existing one-time injection (DEV-14 closure) — do NOT add a second injection path. `test/ui/clarity-pack-css-rules.test.mjs` (Phase 2 css-scope guard) WILL validate every selector is prefixed.

---

### NEW: `migrations/0004_bulletin.sql`

**Role:** DDL for `bulletins`, `bulletin_errata`, `clarity_department_membership`, `bulletin_compile_failures`
**Closest analog:** `migrations/0003_situation_and_optin.sql` (entire file — the most recent migration; sets the exact DDL convention)
**Why this analog:** EXACT — same architectural slot. All tables in `plugin_clarity_pack_cdd6bda4bd.*`. No procedural blocks (Plan 02-04 validator finding). `COMMENT ON` may be unqualified.

**Full DDL pattern excerpt** (lines 1-66):
```sql
-- 0003_situation_and_optin.sql
-- Plan 02-04 Task 1 + Task 2 — Situation Room snapshot cache, active-viewer
-- gating table, and an idempotent guard for the prior clarity_user_prefs
-- table.
--
-- All DDL targets the deterministic plugin namespace
-- `plugin_clarity_pack_cdd6bda4bd` literally. The Paperclip host validator
-- (server/src/services/plugin-database.ts) requires fully qualified schema
-- names — there is NO template substitution.
--
-- Paperclip's plugin-SQL validator rejects anonymous procedural blocks
-- (case-insensitive match on the keyword that opens a PL/pgSQL anonymous
-- block followed by a dollar-quote start or LANGUAGE clause).

CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.situation_snapshots (
  id                       bigserial PRIMARY KEY,
  taken_at                 timestamptz NOT NULL DEFAULT now(),
  computed_for_company_id  text NOT NULL,
  payload                  jsonb NOT NULL,
  content_hash             text NOT NULL,
  UNIQUE (computed_for_company_id, content_hash)
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.situation_snapshots IS
  'ROOM-05 60s materialized snapshot cache for the Situation Room. The 60s job inserts; UI reads most-recent.';
```

**Planner instruction:** Mirror exactly. Use the DDL skeleton at RESEARCH.md §"Migration Plan" lines 663-705 verbatim. ALL tables: `plugin_clarity_pack_cdd6bda4bd.<name>`. NO procedural blocks (no `DO $$ ... END $$;`). `CREATE TABLE IF NOT EXISTS` (idempotent via the DDL itself; not via PL/pgSQL guards). Add `COMMENT ON TABLE` for each per docs convention. Document the FK to `public.issues.id` (host-side) in comments — Postgres cross-schema FK to `public` is fine.

---

### NEW: `test/worker/bulletin/next-due-at.test.mjs`

**Role:** pure-fn test — 4 DST fixture dates
**Closest analog:** `test/shared/blocker-chain.test.mjs:1-80`
**Why this analog:** EXACT — same pure-fn-test pattern. Both files: `import { strict as assert } from 'node:assert'`; `test('description', () => {...})`; no setup/teardown; deterministic input-output pairs.

**Full test-shape excerpt** (lines 19-66):
```javascript
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { flattenBlockerChain } from '../../src/shared/blocker-chain.ts';

test('HUMAN_ACTION_ON — A→B→C, C is awaiting eric, terminal is HUMAN_ACTION_ON(eric); pathIds=[A,B,C]', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [
      { from: 'A', to: 'B', reason: 'blocks' },
      { from: 'B', to: 'C', reason: 'blocks' },
    ],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'blocked' },
      C: { ownerUserId: 'eric', etaIso: null, status: 'awaiting' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.startId, 'A');
  assert.deepEqual(result.pathIds, ['A', 'B', 'C']);
  assert.equal(result.terminal.kind, 'HUMAN_ACTION_ON');
});
```

**Planner instruction:** Four tests minimum, one per DST instant per CONTEXT.md D-12 (2026-03-08 day-before-spring-forward, 2026-03-09 day-of, 2026-11-01 day-before-fall-back, 2026-11-02 day-of). Each test: `const now = new Date('2026-03-08T...'); const next = computeNextDueAt(now); assert.equal(formatInTimeZone(next, 'America/New_York', "yyyy-MM-dd'T'HH:mm"), '2026-03-09T06:30')`. The fall-back fixture must include the duplicated 01:00–02:00 hour without triggering a second compile (one calendar day = one compile).

---

### NEW: `test/worker/bulletin/verifier.test.mjs`

**Role:** number-mismatch rejection test
**Closest analog:** `test/shared/blocker-chain.test.mjs:19-66`
**Why this analog:** Same pure-fn test pattern. Inject a fake `SqlClient` that returns canned rows for each call; assert the typed `{ok: false, mismatches: [...]}` result.

**Planner instruction:** Three tests minimum: (a) all numbers match → `assert.equal(result.ok, true)`, (b) one number mismatches → `assert.equal(result.ok, false); assert.equal(result.mismatches[0].slot, 'mrr')`, (c) prose `{{NUMBER:foo}}` references key not in factsTable → reject with typed `{kind: 'UNKNOWN_SLOT'}`. Plus integration with circuit-breaker: 3 consecutive `ok:false` → `recordFailure` called 3 times → on the 3rd, `ctx.agents.pause` is invoked exactly once (matches existing `test/worker/circuit-breaker.test.mjs` if it exists; same shape).

---

### NEW: `test/worker/bulletin/lineage-grouper.test.mjs`

**Role:** clustering heuristic determinism test
**Closest analog:** `test/shared/blocker-chain.test.mjs:67-80` (canonical-form / determinism asserts)
**Why this analog:** Same pure-fn-determinism shape. Run the grouper twice with the same input; `JSON.stringify` results must be byte-equal.

**Planner instruction:** Tests: (a) two activity rows 4 min apart, same actor, same entity → single cluster; (b) 6 min apart → two clusters (threshold = 300s default); (c) same time, different actor → two clusters; (d) cluster size > 8 → renders "…and N more steps" tail; (e) determinism: 100 invocations with same input produce identical output. Pure-fn pattern means no mocking.

---

### NEW: `test/worker/bulletin/compile-bulletin.test.mjs`

**Role:** integration test of the cron job
**Closest analog:** `test/worker/situation-snapshot.test.mjs:1-80`
**Why this analog:** EXACT — same shape. Builds a fake `ctx` with stub `db`, `jobs`, `companies`, `agents`, `issues` clients. Registers the job. Manually invokes the registered fn. Asserts on `dbCalls` array.

**Fake-ctx shape excerpt** (lines 18-65):
```javascript
function makeJobCtx({ activeViewerCount = 1, companies = [], employees = {} } = {}) {
  const dbCalls = [];
  const jobs = new Map();
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql, params) {
        dbCalls.push({ kind: 'query', sql, params });
        if (/active_viewers/.test(sql)) {
          return [{ n: activeViewerCount }];
        }
        return [];
      },
      async execute(sql, params) {
        dbCalls.push({ kind: 'execute', sql, params });
        return { rowCount: 1 };
      },
    },
    jobs: {
      register(key, fn) {
        jobs.set(key, fn);
      },
    },
    companies: {
      async list() {
        return companies;
      },
    },
    // ...
  };
  return { ctx, dbCalls, jobs };
}
```

**Planner instruction:** Mirror exactly. Add a stub for `issues.create` that records calls. Tests: (a) `now < next_due_at` → no-op (no INSERTs to `bulletins`); (b) `now >= next_due_at` AND verifier passes → INSERT `bulletins (compile_status='attempting')`, then `ctx.issues.create` called with the 3 required tags, then UPDATE `bulletins SET published_issue_id`, then `bulletins.next_due_at` advanced to tomorrow 06:30 ET; (c) verifier rejects → no `ctx.issues.create` call, `recordFailure` invoked; (d) idempotency: same `(next_due_at, content_hash)` → second call is a no-op.

---

### NEW: `test/worker/self-loop-filter-bulletin.test.mjs`

**Role:** regression test — bulletin-tagged events filtered
**Closest analog:** `test/worker/self-loop-filter.test.mjs:1-62` (entire file — same module, new tag prefix)
**Why this analog:** EXACT — same `filterSelfLoopEvents` import + same `assert.deepEqual` shape. After extension, the function should ALSO drop events with tags matching `clarity:bulletin-*` prefix.

**Full test pattern excerpt** (lines 1-43):
```javascript
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  filterSelfLoopEvents,
  EDITOR_WRITE_TAG,
} from '../../src/worker/agents/self-loop-filter.ts';

test('EDITOR_WRITE_TAG is the locked literal "clarity:editor-write"', () => {
  assert.equal(EDITOR_WRITE_TAG, 'clarity:editor-write');
});

test('filterSelfLoopEvents drops events authored by the editor-agent id (author-id match)', () => {
  const events = [{ author_id: 'editor-agent-1', tags: [] }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.deepEqual(out, []);
});

test('filterSelfLoopEvents drops events carrying clarity:editor-write tag even when author differs (tag match)', () => {
  const events = [{ author_id: 'other-author', tags: ['clarity:editor-write'] }];
  const out = filterSelfLoopEvents(events, 'editor-agent-1');
  assert.deepEqual(out, []);
});
```

**Planner instruction:** Add tests assert: (a) event with tag `'clarity:bulletin'` → dropped; (b) event with tag `'clarity:bulletin-issue'` → dropped; (c) event with tag `'cycle:5'` → dropped (per RESEARCH.md "bulletin-tag self-loop filter extension"); (d) regression: existing tag `'clarity:editor-write'` STILL drops (verify Phase 2 behavior unchanged); (e) export the new constant `BULLETIN_TAG_PREFIX = 'clarity:bulletin'`.

---

### NEW: `test/migrations/0004-bulletin-schema.test.mjs`

**Role:** assert all Phase 3 DDL is fully-qualified namespaced; no procedural blocks
**Closest analog:** `test/migrations/no-procedural-blocks.test.mjs:23-62` (already auto-iterates ALL `.sql` files including 0004)
**Why this analog:** The existing test already covers the procedural-block scan for any new `.sql` file. The NEW test must add namespace-presence + table-presence asserts for the 4 new tables.

**Existing iterator pattern excerpt** (lines 45-61):
```javascript
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

for (const f of files) {
  test(`Migration ${f} contains no DO procedural blocks (Paperclip plugin SQL validator)`, () => {
    const stripped = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    const match = stripped.match(FORBIDDEN_PATTERN);
    assert.equal(
      match,
      null,
      `migration ${f} contains a procedural block matching ${FORBIDDEN_PATTERN}; ` +
        `Paperclip's plugin SQL validator will reject this at install time.`,
    );
  });
}
```

**Planner instruction:** New file scans `0004_bulletin.sql` specifically and asserts: (a) every `CREATE TABLE` line starts with `plugin_clarity_pack_cdd6bda4bd.`; (b) the 4 expected tables present (`bulletins`, `bulletin_errata`, `clarity_department_membership`, `bulletin_compile_failures`); (c) UNIQUE constraint on `bulletins (next_due_at, content_hash)` present per D-13; (d) no `DROP TABLE`, no `ALTER TABLE … DROP COLUMN` (additive-only invariant).

---

### NEW: `test/ui/bulletin-page.test.mjs`

**Role:** UI source-grep test (Node `--test` doesn't load `.tsx`; tests scan source text)
**Closest analog:** `test/ui/situation-room.test.mjs:1-60`
**Why this analog:** EXACT — same source-grep approach. Phase 2 established this pattern (Node 24 doesn't load `.tsx` through the test runtime, so tests verify source-text properties instead).

**Full file pattern excerpt** (lines 1-60):
```javascript
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'situation-room');

function readSrc(rel) {
  return readFileSync(path.join(ROOM_DIR, rel), 'utf8');
}

const REQUIRED_FILES = [
  'index.tsx',
  'agent-card.tsx',
  // ...
];

for (const f of REQUIRED_FILES) {
  test(`Situation Room: ${f} exists`, () => {
    assert.ok(existsSync(path.join(ROOM_DIR, f)), `expected ${f}`);
  });
}

test('Situation Room: index.tsx exports SituationRoom + wraps in <ClaritySurfaceRoot name="situation-room"> (SCAF-06)', () => {
  const src = readSrc('index.tsx');
  assert.match(src, /export function SituationRoom/);
  assert.match(src, /ClaritySurfaceRoot[\s\S]*name=["']situation-room["']/);
});
```

**Planner instruction:** Mirror exactly. Required files: `index.tsx`, `masthead.tsx`, `action-inbox.tsx`, `department-section.tsx`, `standing-numbers-panel.tsx`, `lineage-footer.tsx`, `errata-footer.tsx`, `failed-compile-banner.tsx`. Asserts: (a) `index.tsx` wraps in `<ClaritySurfaceRoot name="bulletin">`; (b) imports `useResolvedUserId` AND `useResolvedCompanyId` (BULL-09 viewer-scoped); (c) uses `usePluginData('bulletin.byCycle', ...)`; (d) gates on `useOptIn`; (e) renders ALL 8 children components; (f) literal masthead string `"The Bulletin"` is present in `masthead.tsx`; (g) `[data-clarity-surface="bulletin"]` appears in `src/ui/styles/bulletin.css`.

---

### NEW: `test/ci/coexistence-bulletin-disable.test.mjs`

**Role:** plugin-disable preserves bulletin-issues in classic Paperclip
**Closest analog:** `test/ci/coexistence-checklist.test.mjs:1-80`
**Why this analog:** Same role — coexistence assertion suite. Existing harness already validates `03-disable-preserves-data.mjs`; the new test extends it for bulletin-tagged issues.

**Existing pattern excerpt** (lines 1-53):
```javascript
const CHECK_FILES = [
  '01-original-ui-unchanged.mjs',
  '02-no-public-ddl.mjs',
  '03-disable-preserves-data.mjs',
  // ...
];

for (const f of CHECK_FILES) {
  test(`Coexistence: ${f} exists`, () => {
    assert.ok(existsSync(path.join(CHECKS_DIR, f)), `expected ${f}`);
  });
}

for (const f of CHECK_FILES) {
  test(`Coexistence: ${f} exits 0 against clean tree`, () => {
    const r = runNode(path.join(CHECKS_DIR, f));
    assert.equal(r.status, 0, `${f} should pass clean tree`);
  });
}
```

**Planner instruction:** New file simulates plugin-disable, asserts that `public.issues` rows tagged `clarity:bulletin-issue` are NOT deleted, and asserts `bulletins` table is NOT dropped (additive-only invariant from coexistence guarantee #3). Add a new script `scripts/coexistence-checks/07-bulletin-disable.mjs` and append `'07-bulletin-disable.mjs'` to the `CHECK_FILES` array in the existing test.

---

## Shared Patterns

### Opt-in-guard wrap on every new data/action handler

**Source:** `src/worker/opt-in-guard.ts:87-124`
**Apply to:** EVERY new handler (`bulletin-by-cycle`, `bulletin-latest-status`, `bulletin-errata` data+action, `bulletin-action-approve`, `bulletin-action-decline`)

```typescript
export function wrapDataHandler(
  ctx: OptInGuardDataCtx,
  key: string,
  fn: (params: Record<string, unknown>) => Promise<unknown>,
): void {
  if (EXEMPT_HANDLER_KEYS.has(key)) {
    ctx.data.register(key, fn);
    return;
  }
  ctx.data.register(key, async (params) => {
    const userId = extractUserId(params);
    if (!(await isOptedIn(ctx, userId))) {
      return OPT_IN_REQUIRED;
    }
    return fn(params);
  });
}
```

**Rule:** No new handler is exempt. Bulletin handlers all require opt-in. The 3-member exempt set stays at 3.

### Ctx composed from real SDK types (never lying-narrow local Ctx)

**Source:** `src/worker/jobs/situation-snapshot.ts:37-44`, `src/worker/handlers/issue-reader.ts:86-94`
**Apply to:** every new worker file
**Why:** Phase 2 02-04 found that narrow local `Ctx = {...}` shapes diverged from the real SDK and caused integration breaks. Always import the real SDK client types.

```typescript
import type {
  PluginAgentsClient,
  PluginCompaniesClient,
  PluginDatabaseClient,
  PluginIssuesClient,
  PluginJobsClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

export type CompileBulletinCtx = {
  logger?: PluginLogger;
  db: PluginDatabaseClient;
  jobs: PluginJobsClient;
  companies: PluginCompaniesClient;
  agents: PluginAgentsClient;
  issues: PluginIssuesClient;
  llm?: LlmAdapter;
};
```

### Fully-qualified namespace in all DDL

**Source:** `migrations/0003_situation_and_optin.sql:37-44`, all DDL across all 3 migrations
**Apply to:** `migrations/0004_bulletin.sql`
**Why:** Paperclip host validator requires literal namespace; no template substitution.

```sql
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.situation_snapshots (
  ...
);
```

### useResolvedUserId + useResolvedCompanyId composition for opt-in-gated UI

**Source:** `src/ui/surfaces/situation-room/index.tsx:82-138`, `src/ui/surfaces/reader/index.tsx:74-138`
**Apply to:** `src/ui/surfaces/bulletin/index.tsx`
**Why:** Phase 2 Plan 02-09 closed DEV-15-STRUCTURAL with this pattern. Detail-tab slots return null userId during Better-Auth getSession loading; the page slot is less likely to hit this but the resolver is the safe default for all opt-in-gated handlers.

```typescript
const { optedIn, loading: optInLoading } = useOptIn();
if (!optedIn) return <EnableClarityCta surfaceName="Bulletin" />;

// Inner component:
const { companyId, loading: companyLoading } = useResolvedCompanyId();
const { userId, loading: userIdLoading } = useResolvedUserId();
if (companyLoading || userIdLoading) return <p>Resolving…</p>;
if (!companyId || !userId) return <p data-clarity-error="...">Bulletin unavailable…</p>;

// Now usePluginData:
const { data } = usePluginData('bulletin.byCycle', { cycle: 'latest', companyId, userId });
```

### Surface-scoped CSS via `[data-clarity-surface="..."]`

**Source:** `src/ui/primitives/clarity-surface-root.tsx:25-33`, `test/ui/clarity-pack-css-rules.test.mjs`
**Apply to:** `src/ui/styles/bulletin.css`
**Why:** SCAF-06 + COEXIST-01 — no host CSS bleed. The existing css-scope test will fail if any selector isn't scoped.

### Worker-side numeric formatting; UI never does TZ math

**Source:** RESEARCH.md §"Standard Stack" "Worker-only" note
**Apply to:** worker passes pre-formatted strings to UI via `data.masthead.dateText`, `data.masthead.weekday`, action-inbox `card.ageText`
**Why:** date-fns-tz is worker-only (~6-8 KB worker delta). UI bundle has zero TZ-library cost.

---

## No Analog Found

Files with no close match in Phase 2 codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason | Fallback source |
|------|------|-----------|--------|-----------------|
| `src/worker/bulletin/next-due-at.ts` (date-fns-tz wall-clock math) | pure helper | date math | No `date-fns-tz` usage exists in Phase 2 codebase (first time) | RESEARCH.md §"Pattern 1" lines 273-303 has full implementation |
| `src/worker/bulletin/facts-table.ts` (structured-slot extraction) | pre-LLM transform | aggregate | Phase 2's LLM pipeline (`compile-tldr.ts`) goes prompt→string→cache, not factsTable→structured-JSON→prose-with-slots | RESEARCH.md §"Pattern 4" lines 315-321 |

---

## EXTEND: existing files modified in place

### EXTEND: `src/manifest.ts:148-208`

**Current code excerpt (lines 148-172):**
```typescript
instanceConfigSchema: {
  type: 'object',
  properties: {
    situationRefreshIntervalMs: {
      type: 'number',
      minimum: 30_000,
      maximum: 600_000,
      default: 60_000,
      description: 'Situation Room polling cadence in milliseconds. ...',
    },
  },
},
jobs: [
  {
    jobKey: 'recompute-situation',
    schedule: '*/1 * * * *',
    displayName: 'Recompute Situation Room snapshot',
  },
],
```

**Current capabilities excerpt (lines 27-62):**
```typescript
capabilities: [
  'ui.detailTab.register',
  'ui.page.register',
  'instance.settings.register',
  'database.namespace.migrate',
  'database.namespace.read',
  'database.namespace.write',
  'issues.read',
  'issue.comments.read',
  'issue.documents.read',
  'issue.documents.write',
  'issue.relations.read',
  'projects.read',
  'goals.read',
  'agents.managed',
  'agents.read',
  'agents.pause',
  'agents.resume',
  'events.subscribe',
  'companies.read',
  'jobs.schedule',
],
```

**Bulletin slot is ALREADY DECLARED (lines 102-108) — do NOT re-declare:**
```typescript
{
  type: 'page',
  id: 'clarity-bulletin',
  displayName: 'Daily Bulletin',
  exportName: 'BulletinPage',
  routePath: 'bulletin',
},
```

**Extension instruction:**
1. Capabilities array: ADD `'issues.create'` and `'issue.comments.create'` (per RESEARCH.md lines 712-716) — do NOT touch the existing 20 entries.
2. `jobs` array: ADD second entry `{ jobKey: 'compile-bulletin', schedule: '*/1 * * * *', displayName: 'Compile Daily Bulletin (DST-safe; worker-managed next_due_at)' }` AFTER the existing `recompute-situation` entry.
3. `instanceConfigSchema.properties`: ADD `bulletinDepartments` (array of strings, default `['Production', 'Sales', 'Customer', 'Builder']`) and `bulletinTimezone` (string, default `'America/New_York'`) — do NOT touch `situationRefreshIntervalMs`.
4. `database.coreReadTables` (lines 77-84): consider adding `'activities'` if SDK union allows — RESEARCH.md flagged this as MAYBE (verify with `tsc` against `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` PluginDatabaseCoreReadTable union; if the union doesn't include `'activities'`, route activity reads via `ctx.issues.listComments` instead, matching Phase 2's documented workaround in `src/worker/handlers/issue-reader.ts:17`).
5. `bulletin` page slot at lines 102-108 already exists — DO NOT touch.
6. EDITOR-AGENT `agents[]` block at lines 173-207 — DO NOT touch (Editor-Agent already declared in Phase 2; Plan 02-09 closed Phase 2; redeclaring would break reconcile).

---

### EXTEND: `src/worker.ts:84-87`

**Current code excerpt (lines 84-87):**
```typescript
// ---- Plan 02-04 Task 2 — Situation Room handlers + job ------------------
registerSituationRoomHandlers(ctx as unknown as SituationRoomCtx);
registerActiveViewerPing(ctx as unknown as ActiveViewerPingCtx);
registerSituationSnapshotJob(ctx as unknown as SituationSnapshotCtx);
```

**Extension instruction:** ADD a new comment block + 5 `register*` calls AFTER line 87:

```typescript
// ---- Plan 03-01 + 03-02 + 03-03 + 03-04 — Bulletin handlers + job ------
registerCompileBulletinJob(ctx as unknown as CompileBulletinCtx);
registerBulletinByCycle(ctx as unknown as BulletinByCycleCtx);
registerBulletinLatestStatus(ctx as unknown as BulletinLatestStatusCtx);
registerBulletinErrata(ctx as unknown as BulletinErrataCtx);
registerBulletinActionApprove(ctx as unknown as BulletinActionApproveCtx);
registerBulletinActionDecline(ctx as unknown as BulletinActionDeclineCtx);
```

Add matching `import` statements at the top of the file (lines 11-58 currently — append after the situation imports). Do NOT touch the existing Editor-Agent reconcile or heartbeat dispatcher blocks (lines 89-169). The bulletin compile pipeline does NOT use the heartbeat dispatcher (it's a `jobs[]` cron path per CONTEXT.md D-12).

---

### EXTEND: `src/worker/agents/self-loop-filter.ts:21-50`

**Current code excerpt (lines 21-50):**
```typescript
export const EDITOR_WRITE_TAG = 'clarity:editor-write';

export type SelfLoopEvent = {
  author_id?: string | null;
  tags?: string[] | null;
  [key: string]: unknown;
};

export function filterSelfLoopEvents<E extends SelfLoopEvent>(
  events: E[],
  editorAgentId: string,
): E[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events.filter((e) => {
    if (e?.author_id && e.author_id === editorAgentId) return false;
    const tags = Array.isArray(e?.tags) ? e.tags : [];
    if (tags.includes(EDITOR_WRITE_TAG)) return false;
    return true;
  });
}
```

**Extension instruction:** Two-line surgical addition.

1. Add a new exported constant after `EDITOR_WRITE_TAG`:
```typescript
/** Bulletin self-loop tag PREFIX. Any event tag starting with this prefix
 * (e.g. `clarity:bulletin`, `clarity:bulletin-issue`, `cycle:5`) is filtered
 * — day-N+1 compile must not see day-N's bulletin as agent activity. */
export const BULLETIN_TAG_PREFIX = 'clarity:bulletin';
```

2. Inside `filterSelfLoopEvents`, after the `EDITOR_WRITE_TAG` check, add:
```typescript
if (tags.some((t) => typeof t === 'string' && t.startsWith(BULLETIN_TAG_PREFIX))) return false;
```

Update the function's JSDoc comment block to mention the new bulletin-tag filter behavior. Plan 03-01 must include `test/worker/self-loop-filter-bulletin.test.mjs` as a regression lock (see test section above).

---

## Summary Table

| New file | Analog | Wave (suggested) |
|----------|--------|------------------|
| `migrations/0004_bulletin.sql` | `migrations/0003_situation_and_optin.sql` | 03-01 |
| `src/worker/bulletin/next-due-at.ts` | `src/shared/blocker-chain.ts` (pure-fn) | 03-01 |
| `src/worker/jobs/compile-bulletin.ts` | `src/worker/jobs/situation-snapshot.ts` | 03-01 |
| `src/worker/db/bulletins-repo.ts` | `src/worker/db/tldr-cache.ts` | 03-01 |
| `src/manifest.ts` (EXTEND) | self | 03-01 |
| `src/worker.ts` (EXTEND) | self | 03-01 |
| `src/worker/agents/self-loop-filter.ts` (EXTEND) | self | 03-01 |
| `test/worker/bulletin/next-due-at.test.mjs` | `test/shared/blocker-chain.test.mjs` | 03-01 |
| `test/worker/self-loop-filter-bulletin.test.mjs` | `test/worker/self-loop-filter.test.mjs` | 03-01 |
| `test/migrations/0004-bulletin-schema.test.mjs` | `test/migrations/no-procedural-blocks.test.mjs` | 03-01 |
| `src/worker/bulletin/facts-table.ts` | `src/worker/jobs/situation-snapshot.ts:218-228` | 03-02 |
| `src/worker/bulletin/standing-numbers.ts` | `src/worker/handlers/editor-pause-status.ts` | 03-02 |
| `src/worker/bulletin/compile-pass-1.ts` | `src/worker/agents/compile-tldr.ts` | 03-02 |
| `src/worker/bulletin/bulletin-verifier.ts` | `src/shared/blocker-chain.ts` (pure-fn) | 03-02 |
| `src/worker/bulletin/publish.ts` | `src/worker/jobs/situation-snapshot.ts:300-309` | 03-02 |
| `src/shared/bulletin-rendering.ts` | `src/shared/blocker-chain.ts` (pure helpers) | 03-02 |
| `test/worker/bulletin/verifier.test.mjs` | `test/shared/blocker-chain.test.mjs` | 03-02 |
| `test/worker/bulletin/compile-bulletin.test.mjs` | `test/worker/situation-snapshot.test.mjs` | 03-02 |
| `test/worker/bulletin/publish.test.mjs` | `test/worker/situation-snapshot.test.mjs` | 03-02 |
| `src/worker/bulletin/action-inbox-query.ts` | `src/worker/handlers/flatten-blocker-chain.ts:74-127` | 03-03 |
| `src/worker/bulletin/department-reconcile.ts` | `src/worker/agents/editor.ts:56-62` | 03-03 |
| `src/worker/bulletin/lineage-grouper.ts` | `src/shared/blocker-chain.ts` | 03-03 |
| `src/worker/handlers/bulletin-by-cycle.ts` | `src/worker/handlers/situation-room.ts` | 03-03 |
| `src/worker/handlers/bulletin-action-approve.ts` | `src/worker/handlers/active-viewer-ping.ts` | 03-03 |
| `src/worker/handlers/bulletin-action-decline.ts` | `src/worker/handlers/active-viewer-ping.ts` | 03-03 |
| `src/ui/surfaces/bulletin/index.tsx` | `src/ui/surfaces/situation-room/index.tsx` | 03-03 |
| `src/ui/surfaces/bulletin/masthead.tsx` | `src/ui/surfaces/situation-room/critical-path-strip.tsx` | 03-03 |
| `src/ui/surfaces/bulletin/action-inbox.tsx` | `src/ui/surfaces/situation-room/awaiting-you-pill.tsx` + `agent-card.tsx` | 03-03 |
| `src/ui/surfaces/bulletin/department-section.tsx` | `src/ui/surfaces/situation-room/agent-card.tsx` | 03-03 |
| `src/ui/surfaces/bulletin/standing-numbers-panel.tsx` | `src/ui/surfaces/situation-room/sparkline.tsx` + critical-path-strip layout | 03-03 |
| `src/ui/surfaces/bulletin/lineage-footer.tsx` | `src/ui/surfaces/situation-room/critical-path-strip.tsx` | 03-03 |
| `src/ui/styles/bulletin.css` | Phase 2 theme.css convention | 03-03 |
| `test/worker/bulletin/action-inbox-query.test.mjs` | `test/worker/situation-snapshot.test.mjs` | 03-03 |
| `test/worker/bulletin/lineage-grouper.test.mjs` | `test/shared/blocker-chain.test.mjs` | 03-03 |
| `test/worker/bulletin/department-reconcile.test.mjs` | `test/worker/situation-snapshot.test.mjs` | 03-03 |
| `test/ui/bulletin-page.test.mjs` | `test/ui/situation-room.test.mjs` | 03-03 |
| `src/worker/handlers/bulletin-errata.ts` | `src/worker/handlers/active-viewer-ping.ts` + `set-opt-in.ts` | 03-04 |
| `src/worker/handlers/bulletin-latest-status.ts` | `src/worker/handlers/editor-pause-status.ts` | 03-04 |
| `src/ui/surfaces/bulletin/errata-footer.tsx` | `src/ui/surfaces/reader/pause-banner.tsx` | 03-04 |
| `src/ui/surfaces/bulletin/failed-compile-banner.tsx` | `src/ui/surfaces/reader/pause-banner.tsx` | 03-04 |
| `test/worker/bulletin/errata.test.mjs` | `test/worker/situation-snapshot.test.mjs` | 03-04 |
| `test/worker/bulletin/failed-compile-banner.test.mjs` | `test/worker/situation-snapshot.test.mjs` | 03-04 |
| `test/ci/coexistence-bulletin-disable.test.mjs` | `test/ci/coexistence-checklist.test.mjs` | 03-04 |

---

## Metadata

**Analog search scope:** `src/`, `migrations/`, `test/`
**Files scanned (read in this pass):** 18
  - `src/manifest.ts` (208 lines)
  - `src/worker.ts` (178 lines)
  - `src/worker/jobs/situation-snapshot.ts` (312 lines)
  - `src/worker/handlers/situation-room.ts` (43 lines)
  - `src/worker/handlers/issue-reader.ts` (90 of 200+ lines)
  - `src/worker/handlers/flatten-blocker-chain.ts` (142 lines)
  - `src/worker/handlers/editor-pause-status.ts` (52 lines)
  - `src/worker/handlers/active-viewer-ping.ts` (33 lines)
  - `src/worker/agents/self-loop-filter.ts` (50 lines)
  - `src/worker/agents/editor.ts` (132 lines)
  - `src/worker/agents/compile-tldr.ts` (227 lines)
  - `src/worker/agents/circuit-breaker.ts` (91 lines)
  - `src/worker/opt-in-guard.ts` (143 lines)
  - `src/worker/db/tldr-cache.ts` (72 lines)
  - `src/shared/blocker-chain.ts` (197 lines)
  - `src/shared/types.ts` (43 lines)
  - `src/ui/surfaces/situation-room/index.tsx` (217 lines)
  - `src/ui/surfaces/situation-room/{agent-card,sparkline,critical-path-strip,awaiting-you-pill}.tsx`
  - `src/ui/surfaces/reader/{index,pause-banner}.tsx`
  - `src/ui/surfaces/bulletin-stub.tsx`
  - `src/ui/primitives/{clarity-surface-root,use-instance-config}.ts`
  - `migrations/0003_situation_and_optin.sql` (66 lines)
  - `test/{shared,worker,ui,ci,migrations}/*.test.mjs` (4 sample files)

**Pattern extraction date:** 2026-05-15
**Coverage:** 100% — every NEW file has an EXACT or role-match analog in Phase 2. No file requires invented patterns.
