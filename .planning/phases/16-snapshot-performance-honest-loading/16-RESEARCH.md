# Phase 16: Snapshot performance & honest loading - Research

**Researched:** 2026-06-03
**Domain:** Worker-side read-path performance — the `situation.snapshot` data handler's RPC fan-out, degrade-safety, and load-time budgeting (Clarity Pack, a Paperclip plugin)
**Confidence:** HIGH for the codebase findings (every claim is anchored to a file:line read this session); MEDIUM for the live-cause attribution (the 25.7s cold number was measured on BEAAA but per-query profiling was blocked — encrypted PG pw, no `pg_stat_statements`).

## Summary

The cold 25.7s is an **N+1 RPC round-trip amplification problem**, not a CPU problem. The
`situation.snapshot` data handler (`src/worker/handlers/situation-room.ts`) computes EVERYTHING
fresh on every call — the `situation_snapshots` materialized cache is **dead** (never read, never
written since Plan 09-01; the table is preserved empty per R9 additive-only). Two independent,
expensive builders run inside that handler, each doing its own blocker-graph BFS over the
worker→host JSON-RPC bridge:

1. `buildOrgBlockedBacklog` (`org-blocked-backlog.ts`) — lists ALL company `status='blocked'`
   issues, then walks `buildEdges` (a BFS over `ctx.issues.relations.get`) **sequentially in a
   `for` loop** over every blocked issue, then resolves owner UUIDs→names via per-UUID
   `ctx.agents.get` calls.
2. `buildEmployeesRollup` (`build-employees-rollup.ts`) — lists the agent roster
   (`ctx.agents.list`), then per agent runs `buildOneEmployeeRow` in `Promise.all`. Each blocked
   row does its OWN `buildEdges` BFS (the SAME relations walk #1 already did for org-wide blocked
   issues), plus a leaf `ctx.issues.get`, plus per-UUID `ctx.agents.get` name resolution.

Every one of those `issues.list` / `issues.get` / `issues.relations.get` / `agents.list` /
`agents.get` calls is a **separate JSON-RPC round-trip over stdio to the host**, and the host
executes each against Postgres under load from the company's own agents (the v1.4.3 incident proved
the box CPU is host-Postgres + the org's agents, NOT the Clarity worker, which idles at ~0.1%). On a
~two-dozen-blocked org with a multi-hop chain (MAX_CHAIN_DEPTH=6), the two builders together issue
**on the order of 100+ serialized-ish round-trips** on a cold view. That is where the 25.7s goes.

**Primary recommendation:** Attack the fan-out, not the CPU. Three levers, in priority order:
(1) **Replace the per-issue/per-agent list reads with direct `ctx.db.query` SQL** — `issues`,
`agents`, `companies` are already in `coreReadTables`, so the roster + all blocked issues + agent
heartbeats can be fetched in **2–3 SQL round-trips instead of dozens of RPC calls**. (2) **De-dup
the blocker-graph BFS** — the org backlog and the employees rollup currently walk the SAME relations
twice; compute the edge graph ONCE and share it. (3) **Restore `situation_snapshots` as a
stale-while-revalidate cache** so the cold view serves the last good snapshot instantly (sub-second)
and recomputes in the background. The relations edges (`relations.get`) MUST stay on the RPC path
(no relations table in `coreReadTables`) — so bound them with a **per-call timeout** (the SDK's
`callHost` already supports a per-call `timeoutMs` override) and a **bounded-concurrency** batch, and
floor any slow/failed edge walk to the deterministic UNCLASSIFIED line the engine already produces.

This phase is read-path-only and can be done **with at most one additive plugin-namespace migration**
(an optional `viewer_user_id` + index on the re-activated snapshot cache); no company-prefix literals
are needed.

**Primary recommendation (one-liner):** Cut snapshot round-trips by moving list reads to
`ctx.db.query` SQL, computing the blocker BFS once, bounding the remaining `relations.get` RPCs with
per-call timeouts + bounded concurrency, and serving a stale-while-revalidate `situation_snapshots`
cache so cold loads are instant.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blocked-issue list + agent roster + heartbeat reads | DB (`ctx.db.query` SELECT against `public.issues`/`public.agents`) | API/Worker | These tables are in `coreReadTables` (`src/manifest.ts:741-748`); one SQL query beats N RPC list/get calls. `standing-numbers.ts:78-114` already reads `public.issues`/`public.companies` this way. |
| Blocker EDGE graph (blockedBy DAG) | API/Worker (`ctx.issues.relations.get` RPC) | — | No relations table in `coreReadTables`, so edges cannot be read via direct SQL — the RPC is the only in-contract path. This is the irreducible per-issue fan-out; bound it, don't eliminate it. |
| Snapshot deadline + per-row floor | API/Worker (the `situation.snapshot` handler) | — | The handler owns the overall budget; per-row degrade already lives in the two builders' try/catch. |
| Fast-load cache (serve-last-good) | DB (`situation_snapshots` plugin-namespace table) | API/Worker | Additive plugin-namespace table already exists (`migrations/0003`); re-activating it as SWR is the cleanest cold-load win and is uninstall-safe by construction. |
| UI poll / refresh cadence | Browser/Client (`index.tsx` `usePollWithLeader` + `usePluginData`) | — | The UI already leader-elects polling (ROOM-07) and force-refetches on mutation; SWR semantics surface here as "show cached, then update". |

## Standard Stack

No new runtime libraries. This phase edits existing worker TypeScript and (optionally) adds one
plain-SQL migration. The stack is locked by the plugin contract `[CITED: CLAUDE.md Technology Stack]`:
TypeScript ^5.7.3, ESM, esbuild, React 19 externalized, Node ≥20. `ctx.db.query` / `ctx.db.execute`
and the worker→host RPC clients are all SDK-provided (`@paperclipai/plugin-sdk@2026.512.0`).

### Core (already present — reused, not installed)
| Capability | Source | Purpose | Why standard here |
|---|---|---|---|
| `ctx.db.query<T>(sql, params)` | `@paperclipai/plugin-sdk` `PluginDatabaseClient` (`node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:409`) | SELECT-only reads against plugin namespace + `coreReadTables` | Already used 9× in the codebase (e.g. `standing-numbers.ts`, `chat-search.ts`); the in-contract way to collapse N list-RPCs into one SQL round-trip. |
| `ctx.db.execute(sql, params)` | same, `:411` (returns `{rowCount}`) | namespace-local INSERT/UPDATE/DELETE | For writing the SWR `situation_snapshots` cache row. |
| Per-call RPC timeout | SDK `callHost(method, params, timeoutMs)` (`node_modules/@paperclipai/plugin-sdk/dist/worker-rpc-host.js:153`) | Bound a single `relations.get` round-trip below the default 30s | The default per-call timeout is `DEFAULT_RPC_TIMEOUT_MS = 30_000` (`worker-rpc-host.js:46`) — far too coarse for a per-row floor; the override is the lever. **See Open Question #1 — verify the override is reachable from the typed `ctx.issues.relations.get` surface.** |

### Don't add a concurrency library — hand-roll a tiny bounded pool
The phase brief asks about `p-limit`. **Recommendation: do NOT add `p-limit`.** The bundle has a
strict size ceiling enforced in CI (`scripts/check-ui-bundle-size.mjs`, currently ~760 kB) and the
plugin contract discourages new deps. A ~15-line bounded-concurrency helper (a Promise pool that
keeps N in flight) is trivial, dependency-free, and testable. This is the in-house pattern the
project already prefers (`build-employees-rollup.ts` uses raw `Promise.all`).

**Alternatives considered:**
| Instead of | Could use | Tradeoff |
|---|---|---|
| Raw `Promise.all` (current, unbounded) | A bounded Promise pool (hand-rolled) | `Promise.all` over the whole roster fires every per-agent fan-out at once — fine for a small org, but on a large org it stampedes the host Postgres. A bounded pool (e.g. 4–6 concurrent) is gentler and is the safe parallelization answer for SNAP-02. |
| `ctx.issues.relations.get` per node (RPC) | direct SQL on a relations table | **NOT available** — no relations table in `coreReadTables`. Stay on RPC; bound it. |
| New SWR write path | reuse the EXISTING dead `situation_snapshots` table | The table + `active_viewers` gating already exist (`migrations/0003`); re-activating is additive and uninstall-safe. |

**Installation:** None. (No `## Package Legitimacy Audit` required — zero external packages added.)

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All capabilities used (`ctx.db.query`,
`ctx.db.execute`, `ctx.issues.*`, `ctx.agents.*`) are already-declared SDK surfaces. No
`npm install` step exists in any plan for this phase.

## Architecture Patterns

### System Architecture Diagram — the cold snapshot today (the long pole)

```
UI (Situation Room)                         WORKER (clarity-pack)                    HOST (Paperclip)
─────────────────────                       ────────────────────────                ─────────────────
usePluginData('situation.snapshot') ──RPC──► situation.snapshot handler
                                             │                                       Postgres
                                             ├─ buildOrgBlockedBacklog
                                             │    issues.list({status:'blocked'}) ──► 1 round-trip
                                             │    FOR EACH blocked issue (SEQUENTIAL for-loop):
                                             │      buildEdges() BFS:
                                             │        relations.get(node) ──────────► 1 round-trip  ┐ per node,
                                             │          ... up to MAX_CHAIN_DEPTH=6              │ up to 6 deep
                                             │      ...repeat for next blocked issue ◄───────────┘
                                             │    FOR EACH distinct owner UUID:
                                             │      agents.get(uuid) ────────────────► 1 round-trip (each)
                                             │
                                             ├─ buildEmployeesRollup
                                             │    agents.list() ─────────────────────► 1 round-trip
                                             │    Promise.all(agents):                  (UNBOUNDED parallel)
                                             │      issues.list({assigneeAgentId}) ───► 1 round-trip (each agent)
                                             │      IF blocked:
                                             │        buildEdges() BFS  ◄── SAME walk org-backlog already did
                                             │          relations.get(node) ──────────► 1 round-trip (each node)
                                             │        issues.get(leaf) ────────────────► 1 round-trip
                                             │        Promise.all(uuids): agents.get ──► 1 round-trip (each)
                                             │
                                             ├─ driveActionCardsStep  ── GATED OFF (ACTION_CARDS_ENABLED=false) ✓
                                             └─ buildPulseSummary  ── PURE, no I/O ✓
                                             returns {org_blocked_backlog, situation_employees, needsYou, pulse}
◄────────────────────────────────────────── JSON payload
```

The fan-out is **dozens to 100+ serialized-ish round-trips** on a cold org. The two `buildEdges`
walks are largely redundant (org-wide blocked issues overlap the blocked agents' focus issues).

### Pattern 1: Collapse list-reads to SQL (the single biggest win)
**What:** Replace `ctx.issues.list({status:'blocked'})`, `ctx.agents.list()`, the per-agent
`ctx.issues.list({assigneeAgentId})`, and the per-UUID `ctx.agents.get(uuid)` name resolution with
**direct `ctx.db.query` SELECTs** against `public.issues` and `public.agents` (both in
`coreReadTables`, `manifest.ts:741-748`).
**When to use:** For everything EXCEPT the blocker EDGE graph (relations).
**Example (verified pattern — mirrors `standing-numbers.ts:78`):**
```ts
// Source: src/worker/bulletin/standing-numbers.ts:78-99 (existing in-contract pattern)
// One round-trip replaces ctx.issues.list + the per-agent issues.list:
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
**Caveat (Open Question #2):** the exact `public.issues` / `public.agents` column names must be
confirmed live (the codebase reads camelCase off the RPC clients, but raw SQL needs the real
snake_case columns). `standing-numbers.ts:70-71` cites `03-10-SCHEMA-FINDINGS.md` for verified
column names — the planner should re-verify against the live BEAAA schema (the bookended deploy gives
a safe window). A name resolution map (`uuid→name`) built once from the single `agents` SELECT
eliminates ALL per-UUID `agents.get` round-trips.

### Pattern 2: Compute the blocker BFS ONCE, share it
**What:** The org backlog and the employees rollup both call `buildEdges` (the relations BFS) for
overlapping issues. Compute the edge graph for the union of {all blocked issues} ∪ {each blocked
agent's focus issue} ONE time, memoized by `startId`, and have both consumers read from the shared
result.
**When to use:** Always — it halves the relations.get fan-out on the overlap.
**Anti-pattern avoided:** the current double-walk (`org-blocked-backlog.ts:402` and
`build-employees-rollup.ts:357` each call `buildEdges` independently).

### Pattern 3: Bounded-concurrency + per-call timeout for the irreducible relations.get RPCs
**What:** The relations edges MUST stay on RPC. Run the per-issue `buildEdges` walks through a
bounded Promise pool (4–6 concurrent), and pass a **per-call `timeoutMs`** (e.g. 1.5–2s) to each
`relations.get` so one stuck node can't consume the whole budget. A timed-out / thrown walk floors
that row to the deterministic UNCLASSIFIED line the engine already emits.
**Example (degrade pattern already present — extend it):**
```ts
// Source: src/worker/handlers/org-blocked-backlog.ts:404-414 (the UNCLASSIFIED floor)
// A thrown/timed-out edge walk → an honest UNCLASSIFIED row, NOT a dropped issue:
paired.push({ chain: unclassifiedChain(startId, 'relations-walk-timeout'), issue, nodeMeta: {} });
```
**When to use:** Wrap every `relations.get` walk. Bound concurrency to protect the host Postgres.

### Pattern 4: Stale-while-revalidate via the re-activated `situation_snapshots` cache
**What:** On a `situation.snapshot` call: SELECT the most-recent cached row for this company; if it
exists and is fresh enough (e.g. < ~60s old) return it immediately (sub-second cold load). Always
kick off a fresh recompute; write the result back via `ctx.db.execute` for the next caller. The
`active_viewers` table (`migrations/0003`) already gates "is anyone watching".
**When to use:** This is the SNAP-01 cold-case answer — it decouples "view loads fast" from "compute
finishes". The recompute can still take a few seconds; the user never waits on it.
**Schema note:** the existing table has `(id, taken_at, computed_for_company_id, payload jsonb,
content_hash, UNIQUE(company_id, content_hash))` (`migrations/0003:38-44`). It has **no
`viewer_user_id` column** despite the CLAUDE.md sketch — see the Security Domain + the migration flag
below. The `needsYou.count` is viewer-scoped (`situation-room.ts:103`), so a per-company cache that
serves a viewer-specific count is a **cross-viewer leak risk** — see Security Domain.

### Recommended approach ordering (lowest-risk first)
```
Wave A (no migration, biggest win):  SQL-ify the list/roster/name reads (Pattern 1) + share the
                                     BFS (Pattern 2). Likely cuts cold time from ~25s to a few s.
Wave B (no migration):               Bounded concurrency + per-call relations.get timeout (Pattern 3)
                                     → guarantees no row blocks the view; floors slow rows.
Wave C (1 optional migration):       Re-activate situation_snapshots as SWR (Pattern 4) → cold
                                     load becomes instant (serve-last-good).
```
Wave A alone may satisfy SNAP-01/02. Measure after each wave (see Measurement).

### Anti-Patterns to Avoid
- **CPU "optimization" of the engine / pulse / leverage code.** `buildPulseSummary`,
  `leverage.ts`, and `blocker-chain.ts` are all pure and synchronous — they are NOT the bottleneck.
  The v1.4.3 incident proved the worker idles at ~0.1% CPU. Touching them wastes the phase.
- **A continuous worker loop / `setInterval` recompute.** Forbidden by the plugin contract
  (governance parity, no-tight-loop rule, `CLAUDE.md`). The recompute stays request-driven (the
  data handler) or, for SWR, fire-and-forget from within a valid invocation scope.
- **Re-introducing the dead recompute cron.** Plan 09-01 removed it because it was dead on
  `2026.525.0` (PR #6547 invocation-scope). Do NOT resurrect a `jobs.schedule` writer; write the
  SWR cache row from inside the data handler's valid scope.
- **Editing `blocker-chain.ts`.** Pure-engine + AI-token grep guard (`blocker-chain.test.mjs` 21/21).
  This phase is read-path performance; the engine is untouched.
- **Unbounded `Promise.all` over a large roster.** Stampedes host Postgres. Bound it.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Per-issue blocker BFS | A new graph walker | the EXPORTED `buildEdges` (`org-blocked-backlog.ts:270`) | Already the shared, tested BFS both builders use; just call it once and memoize. |
| UNCLASSIFIED degrade row | A new "couldn't compute" shape | `unclassifiedChain()` (`org-blocked-backlog.ts:220`) + the rollup's inline UNCLASSIFIED block (`build-employees-rollup.ts:541-571`) | The honest deterministic floor already exists per row; the timeout path reuses it verbatim. |
| Agent name resolution (uuid→name) | Per-UUID `agents.get` round-trips | ONE `SELECT id,name FROM public.agents WHERE company_id=$1` → a `Map` | `agents` is a `coreReadTable`; one query replaces every name-resolution RPC in BOTH builders. |
| Blocked-issue list + roster | Per-agent `issues.list` RPCs | `ctx.db.query` against `public.issues`/`public.agents` | Same — these are `coreReadTables`; the SQL pattern is proven in `standing-numbers.ts`. |
| Fast-load cache | A new state store | the existing `situation_snapshots` + `active_viewers` tables (`migrations/0003`) | Additive, uninstall-safe, already provisioned. |
| Bounded concurrency | `p-limit` (new dep) | ~15-line in-house Promise pool | Bundle-size CI ceiling + plugin no-new-dep posture; trivial to write + test. |

**Key insight:** The whole phase is about **moving reads off the per-row RPC bridge** (onto SQL for
the list/roster/name reads, and bounding the irreducible relations RPCs). Nothing here is a novel
algorithm; it is reuse + a transport swap + a cache re-activation.

## Runtime State Inventory

> This is a performance/read-path refactor, not a rename — but it touches stored data + a dead table,
> so the inventory matters.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `plugin_clarity_pack_cdd6bda4bd.situation_snapshots` exists but is **empty** (never written since Plan 09-01; `situation-room.ts:5-11,221-227`). Re-activating SWR will start writing rows. | Code edit (write path) + optional additive migration (index / `viewer_user_id`). No data migration — the table is empty. |
| Live service config | None — no external service config embeds anything this phase changes. | None — verified by reading `manifest.ts` (no host-side config keys for snapshot perf). |
| OS-registered state | None — no cron/scheduler registration changes (the dead recompute cron was already removed in 09-01; we do NOT re-add one). | None. |
| Secrets/env vars | None — read-path uses `ctx.db`/`ctx.issues`/`ctx.agents`, no new secret refs. | None. |
| Build artifacts | Worker bundle (`build-worker.mjs`) + UI bundle (`build-ui.mjs`) rebuild on any worker change; bundle-size CI gate applies if UI changes (this phase is worker-only → UI bundle likely unchanged). | Rebuild both per the existing build scripts; bump `package.json` AND `src/manifest.ts` version per DEPLOY-RUNBOOK. |

## Common Pitfalls

### Pitfall 1: Raw-SQL column names differ from the RPC camelCase shape
**What goes wrong:** The codebase reads `assigneeAgentId`, `lastHeartbeatAt`, `lastActivityAt` off
the RPC clients (camelCase, proven in 07-01). A direct `ctx.db.query` needs the real Postgres column
names (snake_case, e.g. `assignee_agent_id`, `last_heartbeat_at`).
**Why it happens:** The RPC layer maps columns; raw SQL bypasses it.
**How to avoid:** Re-verify columns against the live BEAAA schema (`03-10-SCHEMA-FINDINGS.md` is the
prior source-of-truth; the bookended deploy window allows a live `\d public.issues` check). Keep the
existing `?? null` defensive posture for any field that might be absent.
**Warning signs:** A SELECT returns rows but every projected field is `undefined`/null.

### Pitfall 2: Viewer-scoped data in a per-company cache (cross-viewer leak)
**What goes wrong:** `needsYou.count` and the `need_you_count` banner are scoped to
`params.userId` (`situation-room.ts:103-104`, `org-blocked-backlog.ts:517-522`). A naive
per-company SWR cache would serve viewer A's count to viewer B.
**Why it happens:** The existing `situation_snapshots` table keys on company only, not viewer.
**How to avoid:** Cache only the **viewer-invariant** part of the payload (the org backlog rows,
the employees rollup, the pulse) and recompute the cheap viewer-scoped `needsYou` partition on each
call from the cached rows (the partition is a pure filter over already-computed rows — no extra
fetch). OR add a `viewer_user_id` column and key the cache per (company, viewer). The former is
cheaper and leaks nothing. **See Security Domain.**
**Warning signs:** Two operators see each other's "N need you" count.

### Pitfall 3: The per-call timeout floors a row but the snapshot still hangs on the slow read
**What goes wrong:** A per-row try/catch catches a thrown error, but if `relations.get` simply hangs
(no throw), `Promise.all`/the for-loop waits the full default 30s → 502.
**Why it happens:** A try/catch does not impose a deadline; only a timeout does.
**How to avoid:** Pass an explicit `timeoutMs` to the bounded `relations.get` calls (SDK
`callHost(method,params,timeoutMs)` supports it — `worker-rpc-host.js:153`), OR wrap each walk in a
`Promise.race([walk, timeoutFloor])`. A timed-out walk resolves to the UNCLASSIFIED floor row.
**Warning signs:** Cold time is fine until one issue's relations are slow, then the whole view 502s.

### Pitfall 4: Re-introducing a forbidden background loop
**What goes wrong:** "Background recompute for SWR" tempts a `setInterval` or a resurrected cron.
**Why it happens:** SWR's "revalidate" half reads like "run in the background".
**How to avoid:** Fire-and-forget the recompute from INSIDE the data handler's valid invocation scope
(the request that served the stale row also triggers the fresh compute). Do NOT add a `jobs[]` entry
(09-01 proved the cron is dead on this host) and do NOT add a worker timer.
**Warning signs:** Worker CPU rises above its ~0.1% idle; invocation-scope warnings in logs.

### Pitfall 5: `ctx.db.query` is SELECT-only; namespace-only for writes
**What goes wrong:** Trying to write to `public.*` or reading a non-whitelisted core table.
**Why it happens:** The contract: `query` is SELECT against namespace + `coreReadTables`; `execute`
is DML against the plugin namespace ONLY (`types.d.ts:408-411`; `CLAUDE.md`).
**How to avoid:** SELECT from `public.issues`/`public.agents` (whitelisted) is fine; the SWR write
goes to `plugin_clarity_pack_cdd6bda4bd.situation_snapshots` via `execute`. There is **no relations
table in `coreReadTables`** — relations stay on the RPC.
**Warning signs:** Host rejects the SQL with a privilege/whitelist error at runtime.

## Code Examples

### Bounded-concurrency Promise pool (hand-rolled, dependency-free)
```ts
// Run `fn` over `items` with at most `limit` in flight. Resolves preserving order.
async function mapBounded<T, R>(items: T[], limit: number,
    fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

### Per-call relations.get with a deadline floor (Promise.race fallback if the typed surface
won't accept `timeoutMs` — see Open Question #1)
```ts
function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           () => { clearTimeout(t); resolve(onTimeout()); });
  });
}
```

## State of the Art

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| `situation_snapshots` 60s materialized cron cache | Fully fresh compute on every `situation.snapshot` call | Plan 09-01 (cron dead on `2026.525.0` PR #6547) | This is the ROOT of the cold cost — the cache exists but is unused. Re-activating it as SWR (not a cron) is the modern fix. |
| Synchronous action-card compile on the snapshot path | Gated OFF (`ACTION_CARDS_ENABLED=false`) | v1.4.1 hotfix (BEAAA-2092) | The action-card compile is NOT in the cold path anymore (`situation-room.ts:179-189`); Phase 19 re-architects it off-request. This phase must NOT re-enable it. |
| ~4,192 fake-ref 404 lookups + dead-scope bulletin churn | Prefix-gated ref resolution + adaptive backoff | v1.4.3 hotfix (2026-06-03) | Partial load contribution; explicitly NOT the 25.7s cold-recompute fix (success criterion #3). |

**Deprecated/outdated:**
- The `situation-snapshot.ts` cron job + its `jobs[]` manifest entry — removed in 09-01; do not
  resurrect.

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `public.issues`/`public.agents` snake_case column names match the prior `03-10-SCHEMA-FINDINGS.md` set | Patterns 1, Pitfall 1 | A SQL projection returns null fields; planner must add a live `\d` verification task in the bookended window. |
| A2 | The cold cost is dominated by RPC round-trip count (N+1), not host query cost-per-call | Summary, Diagram | If a single relations.get is itself slow on the host, SQL-ifying the lists helps less; Pattern 3 (timeout) still floors it. Measure per Measurement section. |
| A3 | A bounded concurrency of 4–6 is safe against the host Postgres under the org's own agent load | Pattern 3 | Too high stampedes the box; too low under-parallelizes. Start at 4, measure, tune. The number is planner discretion (no locked value). |
| A4 | The SWR "serve last good, revalidate in scope" fire-and-forget is allowed inside a data-handler invocation scope on `2026.512.0` | Pattern 4, Pitfall 4 | If the host rejects a fire-and-forget compute outside the response, SWR degrades to "recompute synchronously but serve stale on the NEXT call only" — still a win; verify in the bookended drill. |
| A5 | `callHost` per-call `timeoutMs` is reachable through the typed `ctx.issues.relations.get` surface | Pattern 3, OQ#1 | If not exposed, use the `withDeadline` Promise.race wrapper (provided) — equivalent floor, no host dependency. |

## Open Questions

1. **Is the per-call RPC `timeoutMs` override reachable from `ctx.issues.relations.get`?**
   - What we know: the SDK's internal `callHost(method, params, timeoutMs)` accepts it
     (`worker-rpc-host.js:153`); default is 30s (`:46`).
   - What's unclear: whether the typed `PluginIssuesClient.relations.get` surface threads it through.
   - Recommendation: prefer the SDK override if reachable; otherwise the `withDeadline` Promise.race
     wrapper gives an identical floor with zero host dependency. Either satisfies SNAP-02.

2. **Exact `public.issues` / `public.agents` column names + the `hidden_at`/operation-issue filter.**
   - What we know: `standing-numbers.ts` reads `public.issues` with `status`, `company_id`,
     `hidden_at`, and an `EXCLUDE_OPERATION_ISSUES_SQL` clause; columns cited from
     `03-10-SCHEMA-FINDINGS.md`.
   - What's unclear: heartbeat column name (`last_heartbeat_at`?), the activity column, and whether
     the operation-issue exclusion must apply to the rollup too.
   - Recommendation: a Wave-0 live `\d public.issues` + `\d public.agents` against BEAAA in the
     bookended deploy window; lock the column list in the plan.

3. **What is the right SWR freshness window + does SWR need a migration?**
   - What we know: the table exists with `(company_id, content_hash)` uniqueness, no
     `viewer_user_id`, no `taken_at` index beyond the PK.
   - What's unclear: whether to cache the viewer-invariant slice only (no migration) or add a
     `viewer_user_id` column + a `(company_id, taken_at DESC)` index (one additive migration `0017`).
   - Recommendation: prefer the **no-migration** viewer-invariant-cache design (Pitfall 2); only add
     `0017_situation_snapshot_index.sql` if profiling shows the most-recent-row SELECT is itself slow.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Paperclip host (`@paperclipai/plugin-sdk`) | RPC + `ctx.db` | ✓ (BEAAA live, v1.4.x deployed) | `2026.512.0` pinned | — |
| `ctx.db.query` against `coreReadTables` | Pattern 1 (SQL list reads) | ✓ (used 9× in repo; `standing-numbers.ts`) | — | RPC list reads (the status quo — slower) |
| Live BEAAA instance for cold/warm timing | Measurement / SNAP-01 verification | ✓ (DO droplet, autonomous deploy authorized; bookend = automated DO backup) | v1.4.3 | local build verify + synthetic fixture timings if box unreachable |
| `pg_stat_statements` (query-level profiling) | Per-query cause attribution | ✗ | — | **No fallback for SQL-level profiling** — use worker-side timing instrumentation (below); count round-trips + wrap each builder/stage with `Date.now()` deltas logged via `ctx.logger`. |

**Missing dependencies with no fallback:** none that block execution.
**Missing dependencies with fallback:** `pg_stat_statements` is blocked (encrypted PG pw) — fall back
to worker-side stage timing (instrument the handler, not the DB).

## Measurement / Verification

`pg_stat_statements` is unavailable on BEAAA. The reproducible measurement path is **worker-side
timing instrumentation**, logged via `ctx.logger`:

- Wrap each stage in the handler with `const t0 = Date.now(); ... ctx.logger.info('snap.stage',
  {stage, ms: Date.now()-t0, companyId})` — cover: `buildOrgBlockedBacklog`, `buildEmployeesRollup`,
  (and within them) the `relations.get` BFS count and total. This gives a per-stage flamegraph in the
  worker logs without DB access.
- Count round-trips: increment a per-request counter on each `relations.get`/`issues.list`/
  `agents.get`; log the total. This directly proves the N+1 hypothesis and the post-fix reduction.
- **Cold vs warm:** cold = first view after the worker (re)starts / cache empty; warm = a subsequent
  view within the cache window. The drill: deploy (bookended by DO backup) → restart worker → open
  `/BEAAA/situation-room` cold, record the logged total + wall-clock; reload warm, record again.
- **p95 proof:** collect ~10–20 cold loads (or replay the logged stage timings) and assert p95 <
  target (~5s; baseline was a single 25.7s cold sample 2026-06-03). The success thresholds are
  driven by the recorded SNAP-03 baseline: no 502, 6/6 snapshot calls 200, cold 25.7s.
- Existing test infrastructure: the builders are already unit-tested with stubbed ctx clients
  (`test/worker/...`); a new test can assert (a) the SQL path issues ≤K round-trips for N agents/M
  blocked issues (spy on the stub), and (b) a stubbed slow/throwing `relations.get` yields an
  UNCLASSIFIED floor row, not a hang/blank (degrade-safety, SNAP-02 SC2).

## Instance-Agnostic + Additive-Only Compliance

- **No company-prefix literals.** Every SQL uses `WHERE company_id = $1` (the `companyId` param) —
  the proven pattern in `standing-numbers.ts`/`chat-search.ts`. No `'BEAAA-'`/`'COU-'` literal is
  needed anywhere. (Verified: `org-blocked-backlog.ts:94` explicitly notes "no company-prefix
  literal anywhere in this file" — keep that invariant.)
- **Additive-only schema.** Wave A + B need NO migration (read-path only). Wave C's SWR write reuses
  the EXISTING `situation_snapshots` table → no DDL. Only IF profiling demands it, add ONE additive
  migration `migrations/0017_*.sql` (a `CREATE INDEX IF NOT EXISTS` and/or `ALTER TABLE ... ADD
  COLUMN viewer_user_id text` — both additive; disable/uninstall preserves data; the namespace is
  plugin-owned). **Flag for the planner:** if Wave C adds a column/index, it MUST be plain SQL,
  fully namespace-qualified (`plugin_clarity_pack_cdd6bda4bd.situation_snapshots`), no procedural
  blocks (the host validator rejects them — `migrations/0003` header), and covered by
  `test/migrations/no-procedural-blocks.test.mjs`.
- **Coexistence guarantees preserved:** read-path changes touch no `public.*` writes; disable leaves
  the (additive) cache table intact; uninstall preserves data. SC4 holds by construction.

## Security Domain

> `security_enforcement` is ENABLED (ASVS L1, block on high). This phase is read-path-heavy +
> additive; the threat surface is data exposure across viewers and timeout-amplification DoS.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control for this phase |
|---|---|---|
| V1 Architecture | yes | Trust model unchanged: plugin UI is same-origin trusted JS; worker RPC is capability-gated. No new capability added (all reads use existing `database.namespace.read` + `coreReadTables` + already-declared `issues`/`agents` clients). |
| V4 Access Control | **yes (primary risk)** | Viewer-scoping: `needsYou`/`need_you_count` are per-`userId` (`situation-room.ts:103`). A per-company SWR cache MUST NOT serve one viewer's scoped count to another — cache the viewer-invariant slice and recompute the viewer partition per call (Pitfall 2), OR key the cache per (company, viewer). Company-scoping: every SQL filters `company_id = $1` — a missing filter would leak cross-company data. |
| V5 Input Validation | yes | All SQL uses parameterized `$1` placeholders (never string interpolation) — the proven pattern in `standing-numbers.ts`/`chat-search.ts`. `companyId`/`userId` come from validated handler params (`situation-room.ts:92-104` already fail-loud on missing companyId). |
| V6 Cryptography | no | No crypto surface in this phase. |
| V7 Error Handling / Logging | yes | The new timing instrumentation logs `companyId` but MUST NOT log raw payloads, UUIDs-as-identity, or PII. Degrade paths already log `err.message` only (existing posture). |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Cross-viewer data leak via shared per-company cache | Information Disclosure | Cache viewer-invariant data only; recompute `needsYou` per call (a pure filter, no fetch). |
| Cross-company data leak via missing `company_id` filter | Information Disclosure | Every SELECT filters `WHERE company_id = $1`; add a test asserting the filter is present. |
| SQL injection via the new `ctx.db.query` calls | Tampering | Parameterized queries only (`$1`,`$2`); never interpolate `companyId`/`userId` into SQL. |
| Timeout-amplification DoS via parallel relations fan-out | Denial of Service | Bounded concurrency (4–6) + per-call `relations.get` timeout — the parallelization that fixes SNAP-02 is itself the mitigation (it caps in-flight host load and bounds total time). |
| Stale/degraded snapshot serving wrong-but-believable state | Repudiation/Integrity | The deterministic floor + `taken_at` timestamp keep the snapshot honest; the UI already shows it's a snapshot. SWR freshness window bounds staleness. |

## Sources

### Primary (HIGH confidence — read this session)
- `src/worker/handlers/situation-room.ts` — the snapshot data handler; fresh-every-call, dead cache, gated action-cards, degrade-safe builders.
- `src/worker/situation/build-employees-rollup.ts` — per-agent rollup; `Promise.all` fan-out, per-row `buildEdges` + leaf `issues.get` + per-UUID `agents.get`; UNCLASSIFIED degrade floor.
- `src/worker/handlers/org-blocked-backlog.ts` — org backlog; sequential `buildEdges` for-loop, exported `buildEdges` BFS, `unclassifiedChain` floor, "no company-prefix literal" invariant.
- `src/worker/bulletin/standing-numbers.ts` — the proven `ctx.db.query` against `public.issues`/`public.companies` pattern.
- `src/manifest.ts:741-748` — `coreReadTables` (issues, agents, companies, …); `:732` migrationsDir; `:613` version.
- `migrations/0003_situation_and_optin.sql` — the dead `situation_snapshots` + `active_viewers` schema (no `viewer_user_id`).
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:405-413` — `PluginDatabaseClient.query`/`execute` contract.
- `node_modules/@paperclipai/plugin-sdk/dist/worker-rpc-host.js:46,153-178` — `DEFAULT_RPC_TIMEOUT_MS=30_000`, `callHost(method,params,timeoutMs)` per-call override, JSON-RPC-over-stdio model.
- `src/ui/surfaces/situation-room/index.tsx:198-233` — UI fetch via `usePluginData('situation.snapshot')` + `usePollWithLeader` + force-refetch; "Recomputing…" loading state.
- `src/worker.ts:54-59,277-279` — confirmation the recompute cron was removed (09-01), data handler is the sole live path.
- `src/worker/situation/agent-liveness.ts`, `leverage.ts` — pure helpers, no I/O (confirms CPU is not the bottleneck).

### Secondary (MEDIUM — project docs)
- `.planning/phases/_superseded-legibility-16-18-misscope/16-RESEARCH.md` — prior research already flagged the rollup as the hot path + the 25.7s/30s cliff; the snapshot is synchronous in this phase.
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md:20` — `buildEdges` ~L202 walks only `blockedBy`.
- `.planning/research/PITFALLS.md`, `ARCHITECTURE.md` — blocker-chain determinism + recompute-on-event guidance.
- Project memory: v1.4.3 hotfix + CPU incident (worker idles ~0.1%; bottleneck is host Postgres + the org's agents); CLAUDE.md stack pins + coexistence guarantees.

## Metadata

**Confidence breakdown:**
- Root cause (N+1 RPC fan-out): HIGH — directly traced through both builders + the SDK RPC model.
- The fix levers (SQL-ify lists, share BFS, bound relations, SWR cache): HIGH — every primitive
  already exists in-repo and in-contract; the only unknowns are tuning + exact column names.
- Live timing attribution / p95 prediction: MEDIUM — `pg_stat_statements` blocked; worker-side
  instrumentation is the reproducible substitute, and the post-fix cold number can only be confirmed
  by the bookended BEAAA drill.
- Schema/migration need: MEDIUM — Wave A/B need none; Wave C may need one additive migration
  pending live profiling of the most-recent-row SELECT.

**Research date:** 2026-06-03
**Valid until:** ~2026-07-03 (stable — internal codebase + pinned SDK; re-verify only if the SDK or
host `coreReadTables`/RPC contract changes).

## RESEARCH COMPLETE
