# Plan 16-01 — Wave-0 Schema & RPC-Timeout Verification

**Captured:** 2026-06-03
**Resolves:** 16-RESEARCH.md Open Question #1 (per-call `timeoutMs` reachability / A5) and Open
Question #2 (live `public.issues` / `public.agents` snake_case column names / A1, Pitfall 1).
**Purpose:** Lock the two Wave-0 facts that Waves A (16-02) and B (16-03) depend on so those plans
can be written deterministically against a known column set and a chosen deadline mechanism. This is
a read-only/evidence-gathering plan — no `src/` file is modified and no dependency is added.

---

## Columns

The raw-SQL reads Wave A adds (mirroring `src/worker/bulletin/standing-numbers.ts:65-115`) bypass the
RPC layer's camelCase mapping and must project the real Postgres **snake_case** column names
(Pitfall 1, RESEARCH lines 261-269). Source-of-truth is `03-10-SCHEMA-FINDINGS.md §2` — a live `\d`
introspection of a real Paperclip instance (the Countermoves box, run as the `postgres` role). Every
SELECT keeps the proven `WHERE company_id = $1` company-scoping (no prefix literal) and the `?? null`
defensive posture on every field.

### `public.issues` — CONFIRMED (03-10-SCHEMA-FINDINGS.md §2, `## public.issues`)

The locked target set Wave A's SQL projects, every name confirmed present in the live `\d`:

| Column | Type | Status | Evidence |
|--------|------|--------|----------|
| `id` | uuid | CONFIRMED | 03-10 §2 `public.issues` line 35 |
| `identifier` | text | CONFIRMED | 03-10 §2 `public.issues` line 35 (`identifier` text) |
| `title` | text | CONFIRMED | 03-10 §2 `public.issues` line 35 |
| `status` | text | CONFIRMED | 03-10 §2 line 35 + value domain line 38 (`backlog,todo,in_progress,in_review,blocked,done,cancelled`) |
| `assignee_agent_id` | uuid | CONFIRMED | 03-10 §2 `public.issues` line 35 (`assignee_agent_id` uuid) |
| `assignee_user_id` | text | **LIVE-CHECK-REQUIRED** | 03-10 §2 lists `created_by_user_id` but does NOT enumerate an `assignee_user_id`; RESEARCH/PATTERNS Pattern-1 SELECT projects it. The RPC client exposes `assigneeUserId`, so the snake_case column is the expected name — but it was not in the introspected line. Back-fill in the 16-04 BEAAA `\d public.issues` window. Defensive `?? null` covers an absent column at runtime (a SELECT of a non-existent column THROWS, so the per-query try/catch must floor the slot — see degrade posture below). |
| `updated_at` | timestamptz | CONFIRMED | 03-10 §2 `public.issues` line 35 (`updated_at` tstz) |
| `company_id` | uuid | CONFIRMED | 03-10 §2 `public.issues` line 35 (`company_id` uuid) — the sole `$1` filter |
| `hidden_at` | timestamptz | CONFIRMED | 03-10 §2 `public.issues` line 35 (`hidden_at` tstz) — used by standing-numbers today |
| `origin_kind` | text | CONFIRMED | 03-10 §2 `public.issues` line 35 (`origin_kind` text) — drives `EXCLUDE_OPERATION_ISSUES_SQL` |

**Reuse verbatim** the operation-issue exclusion (`standing-numbers.ts:65-66`) so the Editor-Agent's
own clarity-pack operation/bulletin issues never appear as an agent's "focus" in the rollup:
```
AND (origin_kind IS NULL OR origin_kind NOT LIKE 'plugin:clarity-pack%')
```

### `public.agents` — LIVE-CHECK-REQUIRED (NOT yet introspected)

`03-10-SCHEMA-FINDINGS.md` explicitly did **NOT** introspect `public.agents` and warns (line 74):
*"If the planner wants an 'active agents' number it MUST first obtain `\d public.agents` from a live
query; do not guess."* The Pattern-1 roster SELECT (RESEARCH lines 155-162) therefore targets the
following **working set** — every name is the RPC client's camelCase field mapped to its expected
snake_case form, and EACH is marked `LIVE-CHECK-REQUIRED` for the 16-04 bookended BEAAA drill, which
MUST run `\d public.agents` in the deploy window and back-fill any name that differs:

| Column | Expected type | Status | Note |
|--------|---------------|--------|------|
| `id` | uuid | LIVE-CHECK-REQUIRED | PK; near-certain but unconfirmed by `\d`. |
| `name` | text | LIVE-CHECK-REQUIRED | agent display name (drives uuid→name resolution Map). |
| `role` | text | LIVE-CHECK-REQUIRED | nullable. |
| `title` | text | LIVE-CHECK-REQUIRED | nullable. |
| `last_heartbeat_at` | timestamptz | **LIVE-CHECK-REQUIRED (highest risk)** | the heartbeat column name is the single most-likely drift point (RESEARCH OQ#2: "heartbeat column name (`last_heartbeat_at`?)"). The RPC client reads `lastHeartbeatAt`. If the live column is named differently (e.g. `heartbeat_at`, `last_seen_at`), the liveness projection silently nulls and every agent reads as `stuck` (D-04). Confirm FIRST in the 16-04 `\d public.agents`. |
| `status` | text | LIVE-CHECK-REQUIRED | nullable. |
| `paused_at` | timestamptz | LIVE-CHECK-REQUIRED | nullable; drives the paused-agent banner. |
| `company_id` | uuid | LIVE-CHECK-REQUIRED | the sole `$1` filter; company-scoping invariant. |

**Working posture (do NOT block the phase):** Wave A writes against this set NOW with the
defensive `?? null` on every field and a per-query try/catch that floors the affected stage rather
than aborting the snapshot (mirror `standing-numbers.ts:16-18, 124-130`). The 16-04 bookended
BEAAA drill is the live-truth gate that confirms/back-fills the names — record the live `\d` output
back into this file at that time. A SELECT of a non-existent column THROWS at the host RPC layer
(it does not return null), so the degrade path is the try/catch, not the `?? null` alone — both are
required.

**Instance-agnostic invariant preserved:** every SELECT above filters `WHERE company_id = $1`; no
`'BEAAA-'`/`'COU-'` prefix literal appears anywhere (RESEARCH lines 424-429; `org-blocked-backlog.ts:94`).

---

## timeoutMs decision

**DECISION: USE `withDeadline` wrapper.** The per-call `timeoutMs` override is **NOT reachable**
through the typed `ctx.issues.relations.get` surface. Wave B (16-03) MUST floor each `relations.get`
walk with the hand-rolled `withDeadline(p, ms, onTimeout)` from `src/worker/util/map-bounded.ts`
(this plan's Task 2). The SDK override path is unavailable; `withDeadline` gives an identical
deterministic floor with zero host dependency, satisfying SNAP-02 (RESEARCH A5, OQ#1
recommendation).

### Evidence (read this session against the pinned SDK `@paperclipai/plugin-sdk@2026.512.0`)

1. **Typed signature accepts exactly two params, no options/timeout arg**
   `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:912-914` —
   ```ts
   export interface PluginIssueRelationsClient {
       /** Read blocker relationships for an issue. Requires `issue.relations.read`. */
       get(issueId: string, companyId: string): Promise<PluginIssueRelationSummary>;
   ```
   There is no third `timeoutMs` parameter and no `options` object — the call surface cannot carry
   a per-call deadline.

2. **The runtime wrapper does NOT thread a `timeoutMs` into `callHost`**
   `node_modules/@paperclipai/plugin-sdk/dist/worker-rpc-host.js:683-686` —
   ```js
   relations: {
       async get(issueId, companyId) {
           return callHost("issues.relations.get", { issueId, companyId });
       },
   ```
   `callHost` is invoked with only two arguments (`method`, `params`); its third `timeoutMs`
   parameter is therefore `undefined`.

3. **An undefined `timeoutMs` falls back to the coarse default**
   `node_modules/@paperclipai/plugin-sdk/dist/worker-rpc-host.js:153,163` —
   ```js
   function callHost(method, params, timeoutMs) {
       ...
       const timeout = timeoutMs ?? rpcTimeoutMs;   // rpcTimeoutMs default = DEFAULT_RPC_TIMEOUT_MS
   ```
   with `DEFAULT_RPC_TIMEOUT_MS = 30_000` (`worker-rpc-host.js:46`). So every `relations.get` is
   bounded only by the 30s default — far too coarse for a per-row floor, and exactly the 502 cliff
   Pitfall 3 (RESEARCH lines 283-290) describes.

**Consequence for Wave B (16-03):** wrap each `relations.get` walk (or each `buildEdges` call) in
`withDeadline(walkPromise, ~1500–2000ms, () => unclassifiedChain(startId, 'relations-walk-timeout'))`
and run the walks through `mapBounded(items, 4–6, …)`. A timed-out OR thrown walk floors that row to
the existing deterministic UNCLASSIFIED line (`org-blocked-backlog.ts:220-239` /
`build-employees-rollup.ts:541-571`) — never a dropped issue, never a hang. The exact `ms` budget and
the concurrency `limit` are Wave-B planner discretion (RESEARCH A3 — no locked value; start at
limit 4, deadline ~1.5–2s, measure on the bookended drill). No dependency is added either way.

---

## Summary for Waves A/B

| Wave-0 unknown | Resolution | Action for downstream plan |
|----------------|------------|----------------------------|
| OQ#2 — `public.issues` columns | CONFIRMED from 03-10 §2 (10 names locked; `assignee_user_id` flagged for the 16-04 live `\d`) | 16-02 writes the blocked-issue SELECT against the locked set + `EXCLUDE_OPERATION_ISSUES_SQL`. |
| OQ#2 — `public.agents` columns | LIVE-CHECK-REQUIRED (table never introspected); 8-name working set recorded, `last_heartbeat_at` highest-risk | 16-02/16-03 write against the working set with `?? null` + per-query try/catch; 16-04 BEAAA drill runs `\d public.agents` and back-fills. |
| OQ#1 — per-call `timeoutMs` reachable? | NO — `relations.get(issueId, companyId)` has no timeout arg and the wrapper omits it (defaults to 30s) | 16-03 uses `withDeadline` (this plan's Task 2 export) as the per-walk floor, run inside `mapBounded`. |
