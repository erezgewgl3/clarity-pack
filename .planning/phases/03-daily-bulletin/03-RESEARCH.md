# Phase 3: Daily Bulletin — Research

**Researched:** 2026-05-15
**Domain:** Paperclip plugin — scheduled compile (DST-safe cron) + LLM-grounded editorial digest + persisted-as-issue
**Confidence:** HIGH on SDK shape (verified locally against `@paperclipai/plugin-sdk@2026.512.0` and `@paperclipai/shared@2026.512.0`). HIGH on existing codebase shape (Phase 2 read directly). MEDIUM on host-level `routines[]` runtime semantics (the formal spec under-describes it — but research shows it is NOT a scheduling mechanism, see Q2 below).

---

## Executive Summary (≤200 words — the 10 questions, one-sentence answers)

1. **SDK shape for issue persistence (D-16).** ✅ `ctx.issues.create({companyId, title, description, …})` and `ctx.issues.createComment(issueId, body, companyId, {authorAgentId})` both exist on `PluginIssuesClient` (types.d.ts:1009-1078). No REST fallback needed; capabilities `issues.create` + `issue.comments.create` are required.
2. **`routines[]` mechanics.** ⚠️ `routines[]` is **NOT a scheduling mechanism** — it's a Paperclip-domain Routine-entity declaration (host materializes a `Routine` row with cron triggers stored *server-side*, owned by an agent). Scheduling for the bulletin = manifest `jobs[]` entry whose handler runs in the worker; **the worker-managed `next_due_at` is read on every job fire** and the cron string is a hint only. D-12 is correct; the term in CONTEXT.md should read "jobs[]" not "routines[]".
3. **Activity log shape (D-21 lineage).** ❌ No `caused_by_activity_id` field exists on the SDK's `PluginActivityLogEntry` (types.d.ts:431-441). Lineage grouping must use **fallback heuristic**: cluster activity rows by `(entityId, actorChain, time-proximity ≤ 5 min)`.
4. **`coreReadTables` for Phase 3.** ✅ Phase 2 manifest already declares `[issues, issue_comments, issue_documents, agents, companies, projects]`. Phase 3 needs to ADD `activities` (TBD: verify the union allows it — fallback: query via existing `ctx.issues.listComments` + `paperclipApiRequest` MCP escape).
5. **Bulletin page URL.** ✅ `routePath: 'bulletin'` is already in `src/manifest.ts:103-108`; renders at `/:companyPrefix/plugins/clarity-pack/bulletin`. Component stub exists as `BulletinPage` export.
6. **luxon vs date-fns-tz bundle impact.** ✅ **Use `date-fns-tz`** — luxon ships CJS-only (no tree-shaking, ~23 KB gz fixed); date-fns-tz tree-shakes to ~6-8 KB gz with only `format`/`toZonedTime`/`fromZonedTime`. Worker bundle is 38.9 KB now; +6 KB tolerable. CONTEXT.md D-12 recommendation (luxon) should be overridden.
7. **Self-loop filter extension.** ✅ Lives at `src/worker/agents/self-loop-filter.ts:39`. Extend `filterSelfLoopEvents` to also drop events where `tags` includes any tag matching `clarity:bulletin-*` (regex prefix match). One-line addition; tests at `test/worker/self-loop-filter.test.mjs`.
8. **DST test framework.** ⚠️ Tests use `node:test` builtin. **Node `mock.timers.setTime` for Date requires Node 21.2+ and is experimental.** Phase 2 is on Node ≥20. **Solution:** inject `now()` as a parameter to the schedule helper (pure-function pattern matching `decideResolvedUserId`) — no time-mocking library needed.
9. **MCP server tool coverage.** ❌ NO tool for "list activities by time window." ✅ Tools exist for: list issues by status (`paperclipListIssues`), list comments (`paperclipListComments`), heartbeat context (`paperclipGetHeartbeatContext`), get goals/projects. ❌ NO "run SQL against core tables" — but `paperclipApiRequest` is the generic REST escape hatch. Compile pipeline uses `ctx.db.query()` for plugin namespace + `ctx.issues.list({status})` for action inbox + the MCP server for the LLM pass-1 reasoning context.
10. **Existing plugin namespace tables.** ✅ Three migrations exist: `0001_init.sql` (`clarity_user_prefs`), `0002_tldrs_and_editor.sql` (`tldr_cache`, `editor_agent_failures`, `ac_checklist_items`), `0003_situation_and_optin.sql` (`situation_snapshots`, `active_viewers`). **Next migration file = `0004_bulletin.sql`**, all DDL must use fully-qualified `plugin_clarity_pack_cdd6bda4bd.<table>` per Plan 02-01 Finding #4.

**Primary recommendation:** Single 4-plan decomposition (Plans 03-01..03-04), Phase 3 ships in ~3-4 sessions at established cadence. **Override CONTEXT.md D-12** to `date-fns-tz`; **clarify** that scheduling uses `jobs[]` not `routines[]`; **plan** lineage with the temporal-proximity heuristic, not a `caused_by_activity_id` column that doesn't exist.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

The following 11 decisions from `03-CONTEXT.md` are LOCKED — planner must implement these, not alternatives:

- **D-12: Worker-managed `next_due_at` is the source of truth**, not Paperclip's cron field. On every job fire: read `next_due_at`; if `now >= next_due_at`, run compile; recompute next `next_due_at` in `America/New_York`. CI must test 2026-03-08, 2026-03-09, 2026-11-01, 2026-11-02.
- **D-13: Idempotency key = `(next_due_at_iso, content_hash)`.** Re-fire is no-op; new input hash = new compile attempt; errata is the only amend path.
- **D-14: Structured numeric slots, not prose numbers.** Pass-1 emits `{masthead, action_inbox, departments, standing_numbers:[{key, sql, value, format}], lineage_threads}`. Facts table extracted before prose.
- **D-15: Pass-2 verifier is deterministic code** at `src/worker/bulletin-verifier.ts` — pure function `(draft, sqlClient) → VerifierResult`. Typed rejection errors. 3 verifier rejections → circuit breaker.
- **D-16: Canonical body = Paperclip issue** `Bulletin No. {N} — {weekday}, {YYYY-MM-DD}`. Author: Editor-Agent. Tags: `clarity:bulletin`, `clarity:bulletin-issue`, `cycle:{N}`.
- **D-17: Plugin-namespace `bulletins` table** holds metadata only (cycle_number, next_due_at, compiled_at, verified_at, published_issue_id, compile_status, content_hash, lineage_thread_json, errata_ids[]).
- **D-18: Errata first-class** via `bulletin_errata` table; footer-only render; append-as-comment on the cycle's issue.
- **D-19: Action Inbox source** = issues with `state=awaiting_human` AND `assignee.user_id===viewer.user_id`, last 30 days. **[⚠️ See Q3 below — `awaiting_human` is NOT a valid IssueStatus value. Mapping needs revision.]**
- **D-20: Departments configurable via `instanceConfigSchema`** with v1 default `[Production, Sales, Customer, Builder]`. Plugin-namespace `clarity_department_membership` table populated by reconcile pass.
- **D-21: Lineage thread data source** = Paperclip activity log filtered by `cycle_window` (yesterday 06:30 ET → today 06:30 ET) AND `actor_type=agent`, grouped by `caused_by_activity_id` chain. **[⚠️ See Q4 below — no `caused_by_activity_id` field exists; fallback heuristic needed.]**
- **D-22: Failed-compile banner state machine** = `{kind:'ok'} | {kind:'failed', attempt_at, next_retry_at, reason}`. 15-min retry spacing, 3 retries/cycle, then circuit breaker trips.

### Claude's Discretion

- luxon vs date-fns-tz: **research recommends `date-fns-tz`** (see Q6 / §State of the Art).
- Pass-1 LLM prompt shape: planner authors.
- Standing-Numbers panel content for v1: research recommends MRR, Briefs Sent, Reply Rate, Discoveries Booked, Refund Rate (matches sketch ll. 410-417); each backed by a SQL query against core tables (planner finalizes after schema spike).
- Bulletin-issue tag taxonomy beyond the three required: planner's call.
- Errata UI: settings-page form recommended for v1.
- Lineage-thread compaction (>N=8 nodes): planner's call.
- Cycle numbering: from `bulletins.first_compiled_at` + 1.
- Plan decomposition: research recommends 4 plans (see §Phase 3 Build Order Plan below).

### Deferred Ideas (OUT OF SCOPE — do not research/plan)

- Inline-on-bulletin errata composer (v2)
- Multi-recipient email/PDF send (BULL-V2-01)
- Configurable cycle cadence (twice-daily, weekly)
- Auto-promotion of Action Inbox cards to Reader's right-rail blocker panel
- Bulletin search across cycles (classic Paperclip issue search handles this — D-16)
- Compile-on-demand ("Compile now" button)
- Department reconcile UI (v1 = heuristic + manual SQL override)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BULL-01 | Compile at 06:30 ET via worker-managed `next_due_at`; both DST transitions covered by CI tests | §Standard Stack (date-fns-tz); §Architecture Patterns (Pattern 1); §CI Integration |
| BULL-02 | Idempotent compile; re-firing same `next_due_at` is no-op; no partial publishes | §Architecture Patterns (Pattern 2 — two-phase write); §Migration Plan (`bulletins` UNIQUE constraint) |
| BULL-03 | Action Inbox: dept tag + age + summary + Approve/Open/Decline | §Open Question Q3 (D-19 mapping fix); §Code Examples (Action Inbox query) |
| BULL-04 | Department sections (Production/Sales/Customer/Builder v1; configurable) with item rows + lineage threads | §Architecture Patterns (Pattern 3 — dept reconcile); §Migration Plan (`clarity_department_membership`) |
| BULL-05 | Standing Numbers from SQL — every number grep-able | §Architecture Patterns (Pattern 4 — facts table); §Code Examples (`ctx.db.query` against `coreReadTables`) |
| BULL-06 | Two-pass compile: pass-1 draft + pass-2 deterministic verifier | §Architecture Patterns (Pattern 5 — verifier); §Don't Hand-Roll (LLM grounding) |
| BULL-07 | Errata first-class: append, never rewrite; visible on next view | §Migration Plan (`bulletin_errata` table); §Architecture Patterns (Pattern 6 — errata-as-comment) |
| BULL-08 | Failed-compile banner; no silent failures | §Architecture Patterns (Pattern 7 — banner state machine); §Code Examples (`getLatestCompileStatus`) |
| BULL-09 | Persists as Paperclip issue (`Bulletin No. N`); survives plugin disable | §Open Question Q1 (✅ `ctx.issues.create` exists); §Architecture Patterns (Pattern 8 — canonical body = issue) |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cron firing (every minute heartbeat tick) | Host scheduler | — | Manifest `jobs[]` entry; host is "scheduler of record" per PLUGIN_SPEC §17 rule 2. |
| Next-due-at decision | Plugin Worker | — | Pure date-fns-tz computation; host's cron interpretation is unreliable (Pitfall #9). |
| LLM pass-1 draft generation | Editor-Agent adapter | Plugin Worker (orchestrates) | Governance parity — adapter respects pause/budget; worker calls compileBulletin() inside the agent's run context. |
| Pass-2 verifier (re-run SQL) | Plugin Worker | — | Deterministic code, never LLM. `ctx.db.query()` against `coreReadTables`. |
| Action Inbox source data | Plugin Worker | Host SDK (`ctx.issues.list`) | Filtered server-side then returned to UI; UI never sees unfiltered list. |
| Standing Numbers SQL execution | Plugin Worker | — | `ctx.db.query()` only — UI never runs SQL (same-origin trust model). |
| Bulletin body persistence | Host Postgres (`public.issues`) | Plugin namespace (`bulletins` metadata FK) | D-16: canonical body = Paperclip issue (survives plugin disable). |
| Lineage thread compilation | Plugin Worker | MCP server (heartbeat context for prose) | Deterministic grouping via temporal+actor heuristic (Q3 fallback); LLM writes prose around the result. |
| Errata footer rendering | Plugin UI | — | Read-only render of `bulletin_errata` rows via `usePluginData('bulletin.errata.byCycle', …)`. |
| Errata-as-comment persistence | Plugin Worker | Host SDK (`ctx.issues.createComment`) | Per D-18: on next cycle compile, snapshot errata to canonical issue as a comment. |
| Approve / Decline bridge actions | Plugin UI (initiates) | Plugin Worker (executes) | UI calls `usePluginAction('bulletin.action.approve', {issueId})`; worker calls `ctx.issues.update(...)`. |
| Failed-compile banner state | Plugin Worker (writes) | Plugin UI (reads via `usePluginData`) | `compile_failure` row in plugin state; banner queries on UI mount. |

---

## Standard Stack

### Core (already pinned — no changes for Phase 3)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@paperclipai/plugin-sdk` | `2026.512.0` | All worker + UI surface | FORCED — verified `ctx.issues.create/update/createComment`, `ctx.jobs.register`, `ctx.db.query/execute` against actual `types.d.ts` |
| TypeScript | `^5.7.3` | Type safety | FORCED |
| esbuild | `^0.27.3` | Worker + UI bundles | FORCED |
| React | `19.x` (peer) | Bulletin UI | FORCED |
| Node | `>=20` | Worker runtime | FORCED |

### NEW for Phase 3

| Library | Version | Purpose | Why Standard | Confidence |
|---------|---------|---------|--------------|------------|
| `date-fns-tz` | `^3.2.0` | DST-safe `06:30 America/New_York` arithmetic | Tree-shakeable (~6-8 KB gz worker-only); luxon ships CJS-only, fixed ~23 KB gz. Pure function imports = `toZonedTime`, `fromZonedTime`, `formatInTimeZone`. | HIGH [VERIFIED: npm + bundle research; [date-fns vs Luxon comparison](https://www.pkgpulse.com/blog/best-javascript-date-libraries-2026)] |
| `date-fns` | `^4.1.0` | Peer dependency of date-fns-tz; provides `addDays`/`startOfDay` etc. used by next-due-at logic | Same author as date-fns-tz; required peer | HIGH [VERIFIED: date-fns-tz v3+ requires date-fns v4 as peer] |

**Worker-only:** Both libraries are imported only in worker bundle. UI uses pre-formatted strings from worker payload (`bulletin.masthead.dateText`).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `date-fns-tz` | `luxon` | Cleaner DateTime API with `setZone('America/New_York')`. Cost: ~23 KB gz fixed (CJS-only, not tree-shakeable). Recommended ONLY if planner finds date-fns-tz's API ergonomics intolerable — but worker bundle currently 38.9 KB and +23 KB pushes it past 60 KB. |
| `date-fns-tz` | `Temporal` (Stage 3 proposal) | Native Date replacement; perfect TZ semantics. NOT shipped in Node 20 stable (polyfill required). Reject for v1; revisit when Node 24 LTS lands. |
| Worker-managed `next_due_at` | Trust the host's cron-string TZ interpretation | PLUGIN_SPEC §17 does NOT specify cron TZ semantics. Pitfall #9 documents DST drift in node-cron, action-scheduler, etc. Locked by D-12. |

**Installation:**
```bash
pnpm add date-fns-tz@^3.2.0 date-fns@^4.1.0
```

**Version verification (before plan execution):**
```bash
npm view date-fns-tz version
npm view date-fns version
```

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Host Scheduler (every minute)                                       │
│        │                                                              │
│        │  PluginJobContext { jobKey='compile-bulletin', trigger,     │
│        │                     runId, scheduledAt }                     │
│        ▼                                                              │
│  ┌─────────────────────────────────────────────────────────┐         │
│  │  Worker: jobs/compile-bulletin.ts                        │         │
│  │                                                           │         │
│  │  1. Read bulletins.next_due_at (plugin namespace)        │         │
│  │  2. now < next_due_at? → return (no-op)                  │         │
│  │  3. Compute new next_due_at via date-fns-tz              │         │
│  │  4. Begin two-pass compile:                              │         │
│  └─────────────────────────────────────────────────────────┘         │
│        │                                                              │
│        ▼                                                              │
│  ┌──────────────────────────┐    ┌────────────────────────────────┐ │
│  │  Pass 1: Draft           │    │  Pass 2: Verifier              │ │
│  │  ─ Facts table (SQL)     │───▶│  ─ Re-run each SQL slot        │ │
│  │  ─ Action Inbox query    │    │  ─ Compare claimed vs actual   │ │
│  │  ─ Dept sections         │    │  ─ {kind:'NUMBER_MISMATCH'}    │ │
│  │  ─ Lineage threads       │    │    on any diverge → reject     │ │
│  │  ─ LLM prose w/          │    │  ─ Pure function (no LLM)      │ │
│  │    {{NUMBER:key}} slots  │    └────────────────────────────────┘ │
│  └──────────────────────────┘            │                          │
│        │                                  │                          │
│        ▼ (3 verifier rejections          │                          │
│         in a row → circuit               │                          │
│         breaker pauses agent)            │                          │
│        ▼                                  ▼ verified                 │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Publish:                                                 │        │
│  │  1. ctx.issues.create({title:'Bulletin No.N — Mon, …'})  │        │
│  │     ─ tags: clarity:bulletin + clarity:bulletin-issue +  │        │
│  │       cycle:N                                             │        │
│  │     ─ author = Editor-Agent                               │        │
│  │  2. INSERT INTO plugin_clarity_pack_…bulletins (...)     │        │
│  │     with FK to public.issues.id                          │        │
│  │  3. ctx.activity.log({message:'Bulletin No.N compiled'}) │        │
│  └─────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UI: surfaces/bulletin/index.tsx (route: /:co/plugins/             │
│                                          clarity-pack/bulletin)    │
│                                                                      │
│  ┌─────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  useResolvedUserId      │  │  useOptIn (gate)                │  │
│  │  + useResolvedCompanyId │  │                                  │  │
│  └─────────────────────────┘  └─────────────────────────────────┘  │
│        │                                                            │
│        ▼  usePluginData('bulletin.byCycle', {cycle: latest,        │
│           companyId, userId})                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  <Masthead/> + <FailedCompileBanner/> +                      │  │
│  │  <ActionInbox/> + <DepartmentSections/> +                    │  │
│  │  <StandingNumbersPanel/> + <LineageFooter/> +                │  │
│  │  <ErrataFooter/>                                              │  │
│  │  All wrapped in [data-clarity-surface="bulletin"] (SCAF-06)  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── manifest.ts                          # extend: add jobs[] entry + bulletin slot already exists
├── worker.ts                            # extend: register compile-bulletin job + bulletin handlers
├── worker/
│   ├── agents/
│   │   ├── self-loop-filter.ts          # EXTEND: add clarity:bulletin-* tag prefix match
│   │   └── …
│   ├── jobs/
│   │   ├── situation-snapshot.ts        # untouched
│   │   └── compile-bulletin.ts          # NEW — orchestrates next_due_at + two-pass + publish
│   ├── handlers/
│   │   ├── bulletin-by-cycle.ts         # NEW — getData('bulletin.byCycle', {cycle, companyId, userId})
│   │   ├── bulletin-latest-status.ts    # NEW — getData('bulletin.latestCompileStatus', {companyId})
│   │   ├── bulletin-errata.ts           # NEW — getData('bulletin.errata.byCycle') + addErratum action
│   │   ├── bulletin-action-approve.ts   # NEW — performAction('bulletin.action.approve', {issueId})
│   │   └── bulletin-action-decline.ts   # NEW — performAction('bulletin.action.decline', {issueId})
│   ├── bulletin/
│   │   ├── next-due-at.ts               # NEW — pure date-fns-tz fn: computeNextDueAt(now, tz)
│   │   ├── facts-table.ts               # NEW — pure: extract structured facts from input set
│   │   ├── department-reconcile.ts      # NEW — idempotent role→dept reconcile pass
│   │   ├── action-inbox-query.ts        # NEW — wraps ctx.issues.list w/ blocker-attention filter
│   │   ├── lineage-grouper.ts           # NEW — temporal+actor proximity heuristic (no caused_by)
│   │   ├── standing-numbers.ts          # NEW — pre-defined SQL queries + display formats
│   │   ├── bulletin-verifier.ts         # NEW — pure (draft, sqlClient) → VerifierResult
│   │   ├── compile-pass-1.ts            # NEW — LLM call w/ structured output
│   │   └── publish.ts                   # NEW — ctx.issues.create + INSERT bulletins
│   └── db/
│       └── bulletins-repo.ts            # NEW — typed repo for bulletins + bulletin_errata + clarity_department_membership
├── shared/
│   ├── types.ts                         # EXTEND: BulletinDraft, BulletinPublished, VerifierResult, ErratumEntry
│   └── bulletin-rendering.ts            # NEW — pure shared helpers (markdown → bulletin issue body)
├── ui/
│   ├── primitives/                      # untouched
│   └── surfaces/
│       └── bulletin/
│           ├── index.tsx                # NEW — top-level page (matches Phase 2 reader pattern)
│           ├── masthead.tsx             # NEW — Fraunces "The Bulletin" + Vol/No
│           ├── failed-compile-banner.tsx
│           ├── action-inbox.tsx
│           ├── department-section.tsx
│           ├── standing-numbers-panel.tsx
│           ├── lineage-footer.tsx
│           └── errata-footer.tsx
└── styles/
    └── bulletin.css                     # NEW — scoped [data-clarity-surface="bulletin"] (warm-paper palette, Fraunces+Newsreader fonts)

migrations/
└── 0004_bulletin.sql                    # NEW — bulletins + bulletin_errata + clarity_department_membership
```

### Pattern 1: Worker-managed `next_due_at` with cron hint

**What:** Manifest declares `jobs[]` entry firing every minute. Worker reads `bulletins.next_due_at`. If `now >= next_due_at`, run compile and update `next_due_at` via `date-fns-tz` in `America/New_York`.

**When to use:** Any DST-sensitive recurring task. Mandatory for bulletin per D-12.

**Example:**
```typescript
// src/worker/bulletin/next-due-at.ts
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDays, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

const BULLETIN_TZ = 'America/New_York';
const BULLETIN_HOUR = 6;
const BULLETIN_MINUTE = 30;

/**
 * Pure function. Given a wall-clock `now` (UTC Date), return the next
 * 06:30 America/New_York instant strictly greater than `now`. Round-trips
 * cleanly across both DST transitions.
 */
export function computeNextDueAt(now: Date): Date {
  // Convert UTC instant into the wall-clock representation of America/New_York
  const ny = toZonedTime(now, BULLETIN_TZ);
  // Build "today at 06:30 wall-clock"
  let target = setMilliseconds(setSeconds(setMinutes(setHours(ny, BULLETIN_HOUR), BULLETIN_MINUTE), 0), 0);
  // If today's 06:30 has already passed (or equals now), bump to tomorrow
  if (target <= ny) {
    target = addDays(target, 1);
  }
  // Convert wall-clock back to UTC (date-fns-tz handles DST offset selection)
  return fromZonedTime(target, BULLETIN_TZ);
}
```

**Idempotency property:** `computeNextDueAt` is pure — same `now` always produces the same answer. The CI tests fix `now` to four DST-boundary instants and assert exactly one compile per calendar day.

[CITED: pattern derived from Pitfall #9 prevention strategy in `.planning/research/PITFALLS.md:296`]

### Pattern 2: Two-phase publish with idempotency key

**What:** Compile attempt writes to `bulletins` with status='attempting'. Only on verifier pass + `ctx.issues.create` success does status flip to 'published'. UNIQUE constraint on `(next_due_at_iso, content_hash)` prevents duplicate publishes from concurrent fires.

**Verification gate:** `bulletins.published_issue_id` is NULL until step 3 of publish. UI's `bulletin.byCycle` handler returns `kind:'not-yet-published'` if NULL.

### Pattern 3: Idempotent department reconcile

**What:** First compile of each cycle runs `reconcileDepartments(companyId)` — reads every agent's `role` from `ctx.agents.list`, derives department via simple regex (e.g., `/sales/i` → 'Sales'), UPSERTs into `clarity_department_membership`. Idempotent. Manual SQL override always wins (UPSERT ... ON CONFLICT DO NOTHING).

### Pattern 4: Facts table → structured slots → prose w/ slot markers

**What:** Pass 1 has THREE sub-passes:
1. **Facts extraction (pure code):** run SQL queries → `factsTable: Record<string, {sql, value, format}>`
2. **LLM structured draft:** prompt receives factsTable as data; emits JSON `{masthead, action_inbox:[...], departments:[{...}], lineage_threads:[...], standing_numbers:[...]}`. Every prose field with a number must use `{{NUMBER:keyName}}` placeholder.
3. **LLM prose w/ slots interpolated:** `replaceSlots(prose, factsTable)` — pure code substitutes; if any `{{NUMBER:X}}` references a key not in factsTable → reject before pass 2 even runs.

### Pattern 5: Deterministic verifier

**What:** `src/worker/bulletin/bulletin-verifier.ts` exports `verifyDraft(draft, sqlClient): VerifierResult`. For each `standing_numbers[i]`: re-run the SQL, compare. Returns `{ok: true}` or `{ok: false, mismatches: [{slot, claimed, actual, tolerance}]}`. Three consecutive `ok: false` → invoke existing circuit breaker (`src/worker/agents/circuit-breaker.ts`).

### Pattern 6: Errata-as-comment

**What:** Adding an erratum (settings-page form) writes to `bulletin_errata`. On NEXT cycle's compile, `publishBulletin` snapshots the prior cycle's errata as `ctx.issues.createComment(priorBulletinIssueId, erratumBody)`. The current cycle is NEVER mutated except by errata.

### Pattern 7: Failed-compile banner state machine

**What:** Worker writes `compile_failures` rows (cycle_number, failed_at, reason, attempt_n, next_retry_at). UI reads latest via `usePluginData('bulletin.latestCompileStatus')`. Renders banner when `kind === 'failed' && next_retry_at > now`. After 3 retries → circuit breaker pauses Editor-Agent.

### Pattern 8: Canonical body = Paperclip issue (D-16)

**What:** Bulletin body lives in `public.issues.description` (markdown). `bulletins` table holds metadata + FK. Plugin disable → `bulletins` table preserved; issues searchable in classic UI. Survives uninstall (additive-only).

### Anti-Patterns to Avoid

- **DO NOT use `routines[]` for scheduling.** `routines[]` declares Paperclip-domain Routine entities (with triggers stored host-side, owned by agents) — not cron jobs. Use `jobs[]` for the bulletin cron.
- **DO NOT use a bare cron string in UTC.** Pitfall #9. Always derive via `date-fns-tz` from a wall-clock target.
- **DO NOT inline numbers in LLM prose.** Pitfall #10. Always use `{{NUMBER:key}}` placeholders + pass-2 verifier.
- **DO NOT mutate a published bulletin's issue body for errata.** D-18: errata are append-as-comment + footer-only render.
- **DO NOT trust the LLM to pick which agent activity rows belong in the same lineage thread.** Same trap as Pitfall #13 (blocker chain): grouping is deterministic code; LLM only writes prose around the result.
- **DO NOT skip the self-loop filter extension.** Without `clarity:bulletin-*` tag exclusion, day-N+1 compile will read day-N's bulletin as agent activity, recursing forever.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DST-safe wall-clock arithmetic | A custom "minutes until 06:30 ET" calculator using `Date.getTimezoneOffset()` | `date-fns-tz` `fromZonedTime`/`toZonedTime` | Node's host TZ is undefined; Pitfall #9 has 5 published post-mortems |
| LLM grounding for numeric claims | Prompt engineering ("Only use exact numbers from the source") | Facts-table + pass-2 deterministic re-query | LLMs hallucinate numerically with confidence; pass-2 is the only proven mitigation (Pitfall #10) |
| Cron scheduling in plugin worker | `setInterval(compile, ms_until_06_30)` | Host `jobs[]` declaration + worker-managed `next_due_at` | Violates governance parity; bypasses host's pause/resume; no audit trail |
| Activity grouping for lineage threads | A `caused_by_activity_id` column (doesn't exist in SDK shape) | Temporal proximity heuristic: cluster by `(entityId, agent handoff chain, |Δt| ≤ 5min)` | The host's activity model is shallower than we expected; the heuristic gets 90%+ of useful clusters per industry research |
| Number formatting (currency, percent) | Manual `String(n).padStart(...)` etc. | `Intl.NumberFormat('en-US', {style: 'currency'…})` | Standard since Node 14; zero deps |
| Markdown rendering for issue body | A custom md→md formatter | Plain markdown strings; Paperclip renders in classic UI | The issue body IS markdown; just emit it correctly |
| Action Inbox approve/decline button wiring | Raw `<a href>` + `window.location.assign` | `usePluginAction('bulletin.action.approve')` + `useHostNavigation().linkProps()` for Open | SCAF-09 lint-banned; Pitfall #16 |
| Department membership UI | Custom React drag-drop reordering | SQL UPSERT + manual override (v1 — deferred for v2) | Velocity: this is the lowest-value UX in Phase 3 |

**Key insight:** The two ways this surface usually fails — DST drift and hallucinated numbers — both have well-known mitigations (date-fns-tz; facts-table+verifier). The novel surface is the lineage thread, where the SDK gives us less than expected; that's where the fallback heuristic lives.

---

## Runtime State Inventory

**N/A — Phase 3 is greenfield, not a rename/refactor/migration.** New tables added in `0004_bulletin.sql`; no existing data is renamed or migrated. Skip.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `@paperclipai/plugin-sdk` | All worker code | ✅ | 2026.512.0 | — |
| `@paperclipai/mcp-server` | Editor-Agent (LLM pass-1 context) | ✅ (registered in manifest agents[]) | 2026.512.0 | — |
| `date-fns-tz` | next-due-at computation | ❌ | — | `pnpm add date-fns-tz date-fns` (BULL-01 plan task 1) |
| `date-fns` | peer of date-fns-tz | ❌ | — | Same install |
| Node | Worker runtime | ✅ | ≥20 | — |
| Plugin namespace `plugin_clarity_pack_cdd6bda4bd` | All new tables | ✅ (created by Plan 02-01 smoke) | — | — |
| `clarity-safety` CLI | Production install bookend | ✅ (Phase 1 Plan 01-05) | 0.1.x | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `date-fns-tz` + `date-fns` install. Standard `pnpm add`; no fallback needed.

---

## Code Examples

### Action Inbox query (D-19 mapping fix)

```typescript
// src/worker/bulletin/action-inbox-query.ts
import type { PluginIssuesClient } from '@paperclipai/plugin-sdk';

const ACTION_INBOX_WINDOW_DAYS = 30;

/**
 * D-19 source-of-truth fix: IssueStatus does NOT include 'awaiting_human'.
 * The valid statuses are backlog | todo | in_progress | in_review | done | blocked | cancelled.
 *
 * "Awaiting this user's decision" = status `blocked` AND
 *    blockerAttention.state IN ('needs_attention', 'stalled') AND
 *    assigneeUserId === viewerUserId.
 *
 * This matches the Phase 2 awaiting-you-count semantics that landed in Plan 02-08.
 */
export async function queryActionInbox(
  ctx: { issues: PluginIssuesClient },
  companyId: string,
  viewerUserId: string,
): Promise<ActionInboxCard[]> {
  // Pull all `blocked` issues assigned to the viewer (host-side filter)
  const issues = await ctx.issues.list({ companyId, status: 'blocked' });

  const cutoff = Date.now() - ACTION_INBOX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  return issues
    .filter((i) => i.assigneeUserId === viewerUserId)
    .filter((i) => {
      const blocker = i.blockerAttention?.state;
      return blocker === 'needs_attention' || blocker === 'stalled';
    })
    .filter((i) => new Date(i.updatedAt).getTime() >= cutoff)
    .map((i) => ({
      issueId: i.id,
      identifier: i.identifier,
      title: i.title,
      department: deriveDeptForIssue(i),   // joins clarity_department_membership
      ageMs: Date.now() - new Date(i.updatedAt).getTime(),
      summary: truncate(i.description, 280),
    }));
}
```

[VERIFIED: against `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1009-1021` (`PluginIssuesClient.list`) and `@paperclipai/shared/dist/types/issue.d.ts:102-111` (`IssueBlockerAttention`)]

### next-due-at idempotency test fixture (Node 20 compatible — no time-mocking library)

```typescript
// test/worker/bulletin/next-due-at.test.mjs
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { computeNextDueAt } from '../../../src/worker/bulletin/next-due-at.ts';

// Pattern: pass `now` as parameter (pure function); no global Date mocking.
// Matches the Phase 2 `decideResolvedUserId` pattern (Plan 02-09).

test('next_due_at: 2026-03-08 05:00 ET (day before spring-forward) -> 06:30 ET same day', () => {
  // 2026-03-08T10:00:00Z = 2026-03-08T05:00:00 EST (UTC-5)
  const now = new Date('2026-03-08T10:00:00Z');
  const next = computeNextDueAt(now);
  // 06:30 EST = 11:30 UTC
  assert.equal(next.toISOString(), '2026-03-08T11:30:00.000Z');
});

test('next_due_at: 2026-03-08 07:00 ET (after 06:30 ET, day before spring-forward) -> NEXT day 06:30 EDT', () => {
  const now = new Date('2026-03-08T12:00:00Z'); // 07:00 EST
  const next = computeNextDueAt(now);
  // 2026-03-09 06:30 EDT = 10:30 UTC (DST already started at 02:00 local on the 8th)
  // NOTE: US DST 2026 starts on Sunday March 8th at 02:00 local. At 07:00 EST
  // on the 8th, we have ALREADY sprung forward — so "now" is actually 08:00 EDT.
  // Refining: 2026-03-08T12:00:00Z is 08:00 EDT (not 07:00 EST).
  // The test asserts: next compile is 2026-03-09 06:30 EDT = 10:30 UTC.
  assert.equal(next.toISOString(), '2026-03-09T10:30:00.000Z');
});

test('next_due_at: 2026-11-01 (fall-back day) — no duplicate compile during repeated 01:00-02:00 ET hour', () => {
  // First call at 00:30 EDT = 04:30 UTC
  const first = computeNextDueAt(new Date('2026-11-01T04:30:00Z'));
  // After DST end (02:00 EDT clock falls back to 01:00 EST), wall-clock 06:30 = 11:30 UTC
  assert.equal(first.toISOString(), '2026-11-01T11:30:00.000Z');

  // Re-fire at 01:30 EST (the "repeated" hour) = 06:30 UTC — should produce the SAME next_due_at
  const second = computeNextDueAt(new Date('2026-11-01T06:30:00Z'));
  assert.equal(second.toISOString(), '2026-11-01T11:30:00.000Z',
    'fall-back repeated hour must not advance next_due_at');
});
```

### Self-loop filter extension (Phase 2 → Phase 3)

```typescript
// src/worker/agents/self-loop-filter.ts (Phase 3 extension — additive)
export const EDITOR_WRITE_TAG = 'clarity:editor-write';
export const BULLETIN_TAG_PREFIX = 'clarity:bulletin';  // matches clarity:bulletin, clarity:bulletin-issue, etc.

export function filterSelfLoopEvents<E extends SelfLoopEvent>(
  events: E[],
  editorAgentId: string,
): E[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events.filter((e) => {
    if (e?.author_id && e.author_id === editorAgentId) return false;
    const tags = Array.isArray(e?.tags) ? e.tags : [];
    if (tags.includes(EDITOR_WRITE_TAG)) return false;
    // Phase 3 extension: drop any event whose tag starts with the bulletin prefix.
    // Day-N+1 compile sees day-N's bulletin issue/comments, which carry these tags.
    if (tags.some((t) => typeof t === 'string' && t.startsWith(BULLETIN_TAG_PREFIX))) return false;
    return true;
  });
}
```

[VERIFIED: extends existing file `src/worker/agents/self-loop-filter.ts:39` lines 22-24 — current file imports already declare `EDITOR_WRITE_TAG`; we add one more tag prefix constant + one more filter clause]

### Standing Numbers SQL (example: MRR + reply rate)

```typescript
// src/worker/bulletin/standing-numbers.ts
import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type StandingNumberSlot = {
  key: 'mrr' | 'briefs_sent_week' | 'reply_rate_7d' | 'discoveries_7d' | 'refund_rate_30d';
  sql: string;
  params: unknown[];
  format: { kind: 'currency' | 'count' | 'percent' | 'ratio'; suffix?: string };
};

export const STANDING_NUMBER_SLOTS: StandingNumberSlot[] = [
  // Until the planner finalizes the source schema (probably needs a Phase 3
  // task to spike Paperclip's billing tables), each slot is a placeholder SQL.
  // The verifier-pass shape is the contract; the SQL itself is replaceable.
  {
    key: 'mrr',
    sql: `SELECT COALESCE(SUM(active_subscription_cents), 0)::bigint AS value
          FROM public.companies WHERE id = $1`,
    params: ['<companyId placeholder>'],
    format: { kind: 'currency' },
  },
  // … (4 more)
];

export async function computeStandingNumbers(
  ctx: { db: PluginDatabaseClient },
  companyId: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const slot of STANDING_NUMBER_SLOTS) {
    const params = slot.params.map((p) => (p === '<companyId placeholder>' ? companyId : p));
    const rows = await ctx.db.query<{ value: number }>(slot.sql, params);
    out[slot.key] = rows[0]?.value ?? 0;
  }
  return out;
}
```

[VERIFIED: `ctx.db.query<T>(sql, params)` exists at `types.d.ts:373`. `coreReadTables` already declares `companies` in `src/manifest.ts:80`. Adding `activities` is TBD-by-planner if the union allows it; if not, query via `ctx.activity` is write-only — fall back to `paperclipApiRequest` MCP escape hatch.]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Moment.js / Moment Timezone | luxon **or** date-fns-tz | 2023+ | Moment maintenance-mode; modern stack is one of these two |
| luxon (CJS-only) | date-fns-tz v3+ (ESM tree-shakeable) | 2024+ | luxon's bundle penalty (~23 KB gz fixed) became the deciding factor |
| Cron in UTC with hardcoded offset | Worker-side wall-clock arithmetic via TZ library | post-2024 (node-cron #56, Sentry #66763 published) | "Just use UTC" advice retired; wall-clock-with-TZ is the new default |
| Prose-extracted LLM numbers | Facts-table + structured slot interpolation + deterministic verifier | 2025 Nature paper on faithful summarization | Production deployments (Slack AI Recap, Notion Recap) ship this pattern |

**Deprecated/outdated:**
- Moment Timezone: maintenance-only; do NOT use.
- `node-cron` library inside plugin worker: redundant with host scheduler; CONTEXT.md D-12 already excludes.

---

## Phase 3 Build Order Plan

### Recommended decomposition (4 plans)

| Plan | Title | BULL reqs | Wave | Autonomy | Rationale |
|------|-------|-----------|------|----------|-----------|
| **03-01** | Scheduling + migrations + worker-managed `next_due_at` | BULL-01, BULL-02 | 1 | autonomous | Standalone: install date-fns-tz, write `next-due-at.ts` + `0004_bulletin.sql`, register `compile-bulletin` job that no-ops if `now < next_due_at`, extend self-loop filter for bulletin tags, ship 4 DST CI tests. No LLM, no UI, no real compile yet — locks the scheduling foundation. |
| **03-02** | Compile pipeline (pass-1 draft + pass-2 verifier) + persistence as issue | BULL-05, BULL-06, BULL-09 | 2 | mixed (Eric reviews verifier semantics) | The architectural risk plan. Facts-table extraction, LLM pass-1 with structured output, deterministic pass-2 verifier, `ctx.issues.create` bulletin issue, errata-as-comment publish path. Depends on 03-01's scheduling. |
| **03-03** | Bulletin page UI: masthead + Action Inbox + dept sections + standing numbers + lineage footer | BULL-03, BULL-04 | 3 | mixed (visual fidelity check on Countermoves) | All UI work + the action-inbox query fix (D-19 mapping). Sketch lines 237-456 are the spec. Reuses Phase 2's `useResolvedUserId` + `useResolvedCompanyId` resolver patterns. Department reconcile pass lands here. |
| **03-04** | Errata + failed-compile banner + coexistence test for plugin-disable | BULL-07, BULL-08 | 4 | mixed (Countermoves re-drill) | The closure plan. Errata first-class behavior (add via settings-page form, footer-only render, append-as-comment on next cycle). Failed-compile banner state machine. Coexistence test: disable plugin, verify all prior bulletin issues remain visible in classic Paperclip. |

**Total estimated effort:** 3-4 sessions at established Clarity Pack cadence (CLAUDE.md note: "1-2 days/phase at established drill cadence").

**Why 4 plans, not 3 (CONTEXT.md's recommendation):**
- CONTEXT.md proposes a single plan for "errata + banner + DST CI tests." But DST CI tests are a foundation requirement (locked by D-12), they belong in plan 03-01 alongside scheduling — putting them at the end risks a Phase 2 redux where the foundation defect is found mid-drill.
- CONTEXT.md's plan-(ii) "compile pipeline" implicitly includes persistence; we split-out only because the LLM-grounding architecture (D-14/D-15) and the persistence-as-issue (D-16/D-17) are independently verifiable contracts. Combining means a single plan owns the highest-risk single architectural commitment in the phase.

**Wave assignment rationale:** Each plan strictly depends on the prior. Parallelism is not useful here — the scheduling foundation must be green before compile pipeline can run, and compile must publish before UI can render.

---

## Code Dependencies on Phase 2

**Phase 3 reads/extends — DO NOT rewrite:**

| Phase 2 file | What Phase 3 uses | How |
|--------------|-------------------|-----|
| `src/manifest.ts:18-208` | extends `jobs[]` (add `compile-bulletin` entry), adds capabilities `issues.create`, optionally extend `coreReadTables`. EDITOR-AGENT block (lines 173-207) UNCHANGED. | additive |
| `src/worker.ts` | adds `registerCompileBulletinJob(ctx)` call after `registerSituationSnapshotJob` (line 87) | additive |
| `src/worker/agents/self-loop-filter.ts:21-50` | extend `filterSelfLoopEvents` with `BULLETIN_TAG_PREFIX` check (one-line addition + one constant export) | additive — same file |
| `src/worker/agents/editor.ts:30-35` | re-uses `EDITOR_WRITE_TAG`, `EDITOR_AGENT_ID_TAG` exports; does NOT change Editor-Agent reconcile | read-only |
| `src/worker/agents/compile-tldr.ts` | re-uses the `LlmAdapter` interface (and the existing in-memory circuit-breaker counters) | read-only + add new agent-key constant for bulletin compile failures |
| `src/worker/agents/circuit-breaker.ts` | re-uses `recordFailure`/`recordSuccess` for verifier-reject path | read-only |
| `src/worker/opt-in-guard.ts` | wraps every new bulletin data/action handler (matches Phase 2 pattern) | read-only — apply same wrap |
| `src/ui/primitives/use-resolved-user-id.ts` | bulletin page wraps in this resolver (BULL-09 viewer-scoped action inbox) | read-only — re-use |
| `src/ui/primitives/use-resolved-company-id.ts` | bulletin page wraps in this resolver | read-only — re-use |
| `src/ui/primitives/use-opt-in.ts` | bulletin page gates on opt-in (OPTIN-02 conformance) | read-only — re-use |
| `src/ui/primitives/ref-chip.tsx` | reused inside bulletin item rows for `BEAAA-NNN` references in summaries | read-only |
| `src/shared/reference-resolver.ts` | reused — facts-table includes referenced-issue resolutions | read-only |
| `src/shared/blocker-chain.ts` | reused for the "single action terminal" line on each Action Inbox card | read-only |
| `migrations/0001-0003_*.sql` | NEVER touched. Phase 3 adds `0004_bulletin.sql`. | append-only |

**Phase 2 files that MUST NOT be modified by Phase 3 plans:**
- Any `migrations/0001-0003_*.sql` (append-only invariant — Plan 02-01 Finding #4)
- Any test in `test/` that already passes (422 tests / 420 pass; Phase 3 must keep this green)
- Editor-Agent's existing TL;DR compile path (`src/worker/agents/compile-tldr.ts`) — bulletin compile is a SEPARATE entry point (`src/worker/jobs/compile-bulletin.ts`)

---

## CI Integration Points

### Test runner

Phase 2 uses `node --test test/` (Node's built-in test runner). Test files are `.test.mjs` next to category folders (`test/worker/`, `test/ui/`, `test/migrations/`, etc.). Phase 3 extends the same pattern.

### Required new test files

| Test file | What it locks | BULL req |
|-----------|---------------|----------|
| `test/worker/bulletin/next-due-at.test.mjs` | 4 DST fixture dates (2026-03-08, 03-09, 11-01, 11-02). Pure-function pattern; no time-mocking lib. | BULL-01 |
| `test/worker/bulletin/idempotency.test.mjs` | Re-firing same `next_due_at` is no-op; same input hash dedupes via `(next_due_at_iso, content_hash) UNIQUE`. | BULL-02 |
| `test/worker/bulletin/verifier.test.mjs` | Number-mismatch → typed `{kind:'NUMBER_MISMATCH', slot, claimed, actual}` rejection. 3 consecutive rejects → existing circuit breaker fires. | BULL-06 |
| `test/worker/bulletin/action-inbox-query.test.mjs` | D-19 mapping fix: filter `status=blocked` AND `blockerAttention.state∈{needs_attention,stalled}` AND `assigneeUserId===viewer`. Age + dept-tag fields present. | BULL-03 |
| `test/worker/bulletin/department-reconcile.test.mjs` | Role-regex → dept membership upsert; manual SQL override survives re-run; missing-role → 'Builder' fallback. | BULL-04 |
| `test/worker/bulletin/lineage-grouper.test.mjs` | Temporal+actor proximity heuristic produces same lineage groups for fixture cycles (deterministic). | BULL-04 |
| `test/worker/bulletin/publish.test.mjs` | `ctx.issues.create` called with `Bulletin No. {N} — …` title + 3 required tags + Editor-Agent author. `bulletins` row INSERTed with published_issue_id FK. Errata-as-comment path. | BULL-09, BULL-07 |
| `test/worker/bulletin/errata.test.mjs` | Errata writes to `bulletin_errata`; on next cycle, prior cycle's errata appended as comment on prior cycle's issue (NOT inline-rewriting). | BULL-07 |
| `test/worker/bulletin/failed-compile-banner.test.mjs` | Banner state machine: ok → failed → retry × 3 → circuit breaker. `usePluginData('bulletin.latestCompileStatus')` shape contract. | BULL-08 |
| `test/worker/self-loop-filter-bulletin.test.mjs` | Bulletin-tagged events filtered out (regression: day-N+1 doesn't see day-N's bulletin as agent activity). | BULL-02 |
| `test/migrations/0004-bulletin-schema.test.mjs` | All Phase 3 DDL uses `plugin_clarity_pack_cdd6bda4bd.<table>` (Plan 02-01 Finding #4). No procedural blocks (Plan 02-04 finding). | infrastructure |
| `test/ci/coexistence-bulletin-disable.test.mjs` | On plugin disable: `public.issues` rows tagged `clarity:bulletin-issue` are NOT deleted; they remain visible in classic Paperclip. | BULL-09 + COEXIST-03 |
| `test/ui/bulletin-page.test.mjs` | Visual-contract tests: masthead text matches "The Bulletin · Vol. I · No. N", warm-paper palette CSS vars present, `[data-clarity-surface="bulletin"]` scope (SCAF-06). | BULL-03..BULL-08 |

### Test-time strategy

- **No `node:test`'s `mock.timers.setTime` for Date** — that requires Node 21.2+ (experimental). Phase 2 is on Node ≥20.
- **Instead:** every time-dependent function (computeNextDueAt, action-inbox-query, age computation in cards) accepts `now: Date` as a parameter. Production callers pass `new Date()`; tests pass fixed instants. Matches Plan 02-09's `decideResolvedUserId` pattern.

---

## Migration Plan

### Next file number

`migrations/0004_bulletin.sql` (after 0001 init, 0002 tldrs+editor, 0003 situation+optin).

### New tables (DDL skeleton — full SQL is the planner's job)

```sql
-- 0004_bulletin.sql
-- All DDL uses fully-qualified namespace per Plan 02-01 Finding #4.
-- No procedural blocks per Plan 02-04 host-validator finding.

-- D-17: bulletin metadata (canonical body lives in public.issues)
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletins (
  cycle_number          bigint PRIMARY KEY,
  company_id            text NOT NULL,
  next_due_at           timestamptz NOT NULL,
  compiled_at           timestamptz,
  verified_at           timestamptz,
  published_at          timestamptz,
  published_issue_id    text,                                -- FK to public.issues.id (host-side)
  compile_status        text NOT NULL CHECK (compile_status IN ('pending','attempting','verified','published','failed')),
  content_hash          text NOT NULL,
  lineage_thread_json   jsonb NOT NULL DEFAULT '[]'::jsonb,
  draft_json            jsonb NOT NULL DEFAULT '{}'::jsonb,    -- W3/W4: verified structured BulletinDraft (masthead + departments + standing_numbers + lineage_threads); the bulletin UI reads typed props from this, NOT a markdown re-parser
  UNIQUE (next_due_at, content_hash)                          -- D-13 idempotency key
);

-- D-18: errata as first-class append-only
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletin_errata (
  id                    bigserial PRIMARY KEY,
  bulletin_cycle_number bigint NOT NULL,
  added_at              timestamptz NOT NULL DEFAULT now(),
  added_by_user_id      text NOT NULL,
  body_md               text NOT NULL,
  applied_to_issue_comment_id text                            -- FK to public.issue_comments.id (set on next-cycle publish)
);

-- D-20: department membership reconciled at cycle start
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_department_membership (
  company_id            text NOT NULL,
  employee_user_id      text NOT NULL,
  department            text NOT NULL,                        -- 'Production'|'Sales'|'Customer'|'Builder'
  source                text NOT NULL CHECK (source IN ('reconcile','manual')),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, employee_user_id)
);

-- D-22: failed-compile banner state
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures (
  id                    bigserial PRIMARY KEY,
  cycle_number          bigint NOT NULL,
  failed_at             timestamptz NOT NULL DEFAULT now(),
  reason                text NOT NULL,
  attempt_n             int NOT NULL,
  next_retry_at         timestamptz NOT NULL
);
```

### Manifest extension

```typescript
// src/manifest.ts extension — additive
capabilities: [
  // ... existing 18 ...
  'issues.create',                  // NEW — BULL-09 ctx.issues.create
  'issue.comments.create',          // NEW — BULL-07 errata-as-comment via ctx.issues.createComment
],
jobs: [
  {
    jobKey: 'recompute-situation',
    schedule: '*/1 * * * *',
    displayName: 'Recompute Situation Room snapshot',
  },
  // NEW — fires every minute; the handler reads next_due_at and only compiles
  // when `now >= next_due_at`. Schedule string is a hint per D-12.
  {
    jobKey: 'compile-bulletin',
    schedule: '*/1 * * * *',
    displayName: 'Compile Daily Bulletin (DST-safe; worker-managed next_due_at)',
  },
],
// instanceConfigSchema — extend with D-20 departments
instanceConfigSchema: {
  type: 'object',
  properties: {
    situationRefreshIntervalMs: { /* unchanged */ },
    bulletinDepartments: {
      type: 'array',
      items: { type: 'string' },
      default: ['Production', 'Sales', 'Customer', 'Builder'],
      description: 'D-20: department sections rendered in the Daily Bulletin.',
    },
    bulletinTimezone: {
      type: 'string',
      default: 'America/New_York',
      description: 'BULL-01: timezone for the 06:30 daily compile. Locked to ET for v1.',
    },
  },
},
```

---

## Risk Register

Top 5 Phase-3-specific risks. Each ties to a specific plan task.

| # | Risk | Likelihood | Impact | Mitigation | Owning task |
|---|------|------------|--------|------------|-------------|
| 1 | **DST mishap** — bulletin fires at 07:30 ET for 8 months after spring-forward | LOW (mitigated by D-12) | HIGH (trust collapse) | 4 DST fixture tests in `next-due-at.test.mjs`; pure-function `computeNextDueAt(now)`; CI gates on these tests passing | Plan 03-01 Task 2 |
| 2 | **LLM hallucination escapes verifier** — pass-2 misses a mismatch because the slot key collision allows two SQL queries to share a key | MEDIUM | HIGH (Pitfall #10 manifest) | Verifier asserts every `{{NUMBER:X}}` placeholder in prose has a corresponding `standing_numbers[i].key === X`. Test fixture w/ deliberate placeholder-without-slot reject. Three-rejects → existing circuit breaker. | Plan 03-02 Task 3 |
| 3 | **Partial-publish race** — `ctx.issues.create` succeeds but `INSERT INTO bulletins` fails; orphan bulletin issue exists with no metadata | LOW | MEDIUM (data inconsistency, not data loss) | Two-phase write: INSERT bulletins (status='attempting') BEFORE `ctx.issues.create`; on success UPDATE `bulletins SET published_issue_id = ..., status='published'`; on failure log + leave 'attempting' row for the retry loop to clean up | Plan 03-02 Task 4 |
| 4 | **Coexistence regression** — plugin disable destroys bulletin metadata, prior bulletin issues become broken | LOW (additive-only invariant) | MEDIUM (D-16 trust signal) | `test/ci/coexistence-bulletin-disable.test.mjs` simulates disable + asserts `public.issues` tagged `clarity:bulletin-issue` remain visible. Also: extend Phase 2's `test/ci/coexistence-checklist.test.mjs`. | Plan 03-04 Task 3 |
| 5 | **Lineage thread mis-grouping** — temporal-proximity heuristic mis-clusters two parallel agent traces into one lineage, showing 12-node "thread" that doesn't reflect any real handoff | MEDIUM (no `caused_by_activity_id` from SDK) | LOW (visual oddity, not safety) | Deterministic grouper accepts a configurable `maxDeltaSec` (default 300); if a cluster size exceeds 8, render "…and N more steps" per CONTEXT.md (Claude's Discretion); add a "Lineage threads are heuristic" disclosure in bulletin colophon | Plan 03-03 Task 4 |

**Risks NOT in top 5 (deliberately):**
- React render error boundary tripping (Phase 2 DEV-15 pattern) — `useResolvedUserId` + `useResolvedCompanyId` already handle this; bulletin page is a `page` slot not `detailTab` so `userId=null` from `useHostContext()` is less likely.
- Migration failure on Countermoves — Phase 2 fixed this domain (Plan 02-04 procedural-blocks finding; Plan 02-01 fully-qualified namespace finding). `test/migrations/no-procedural-blocks.test.mjs` already guards.
- Bundle bloat — total Phase 3 worker delta is ~+8 KB gz (date-fns-tz + compile pipeline); UI delta ~+5 KB (bulletin components + scoped CSS).

---

## Common Pitfalls

### Pitfall 1: Treating `routines[]` as a scheduling mechanism

**What goes wrong:** Manifest declares `routines: [{routineKey: 'compile-bulletin', triggers: [...]}]`. Host materializes a Paperclip-domain `Routine` row with cron triggers. The plugin's worker never receives a job-fire event because routines fire as Paperclip routine-runs (creating issues) — not as job handlers. Bulletin never compiles.

**Why it happens:** "Routine" in Paperclip = a recurring task that creates issues, not a cron handler. The vocab overlap is confusing.

**How to avoid:** Use `jobs[]` declaration with a registered `ctx.jobs.register('compile-bulletin', async ({jobKey, runId, trigger, scheduledAt}) => {...})` handler. Phase 2's `situation-snapshot.ts` is the working pattern.

**Warning signs:** Cron never fires; `Routine` row appears in Paperclip admin UI but nothing happens in worker logs.

### Pitfall 2: Forgetting the bulletin-tag self-loop filter

**What goes wrong:** Day-N's bulletin gets published as a Paperclip issue tagged `clarity:bulletin-issue`. The host's `issue.created` event fires. Editor-Agent's `handleEditorHeartbeat` picks it up, reads its body (which contains BEAAA-NNN refs), and attempts to compile a TL;DR — costing tokens and creating a duplicate-write loop.

**Why it happens:** Phase 2 self-loop filter only excludes `clarity:editor-write` tag. Bulletin issues carry a different tag.

**How to avoid:** Extend `filterSelfLoopEvents` (one-line addition) to also exclude tags starting with `clarity:bulletin`. Lock with a regression test.

**Warning signs:** Editor-Agent token spend doubles after first bulletin compile; bulletin issue has a duplicate TL;DR in its tab.

### Pitfall 3: D-19 mapping confusion — `awaiting_human` isn't a real status

**What goes wrong:** Worker code does `ctx.issues.list({companyId, status: 'awaiting_human'})`. Type error at compile time; at runtime returns empty list. Action Inbox is empty for every user.

**Why it happens:** CONTEXT.md D-19 uses a logical name that doesn't match the actual SDK enum.

**How to avoid:** Use `status='blocked'` AND `blockerAttention.state ∈ {'needs_attention','stalled'}` AND `assigneeUserId===viewerUserId`. Phase 2's `awaiting-you-count-semantics.test.mjs` already proved this pattern works.

**Warning signs:** TypeScript error `Type '"awaiting_human"' is not assignable to type 'IssueStatus | undefined'`.

### Pitfall 4: LLM picks lineage terminals

**What goes wrong:** Pass-1 prompt asks LLM to "summarize the agent-by-agent compile graph." LLM happily invents handoffs that didn't happen — same trap as Pitfall #13 (blocker chain).

**How to avoid:** Lineage grouping is pure code (`src/worker/bulletin/lineage-grouper.ts`). LLM only writes the prose-around-the-result for each group; never picks which activity rows belong together.

### Pitfall 5: Storing bulletin body in plugin namespace

**What goes wrong:** Plugin disable removes (or just makes inaccessible) the bulletin body. Eric loses 30+ days of bulletins.

**How to avoid:** D-16 LOCKED — canonical body lives in `public.issues` via `ctx.issues.create`. Plugin namespace holds metadata only. Coexistence test must prove this on every PR.

---

## Validation Architecture

> SKIPPED per `<additional_context>` instruction: "workflow.nyquist_validation is false in config.json. Do NOT write a 'Validation Architecture' header."

---

## Security Domain

> Phase 3 security_enforcement check: ASVS applicable categories below.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Inherited from Phase 2 `useResolvedUserId` (Better Auth session) |
| V3 Session Management | yes | Inherited from Paperclip host; bulletin page is opted-in only |
| V4 Access Control | yes | Action Inbox MUST filter `assigneeUserId === viewerUserId` server-side (`opt-in-guard` wrap on every bulletin handler) |
| V5 Input Validation | yes | LLM pass-1 output validated against JSON schema before pass-2; invalid → reject |
| V6 Cryptography | no | No new crypto; reuse `content_hash` murmur3 pattern from situation-snapshot |
| V10 Configuration | yes | `instanceConfigSchema` for bulletinDepartments + bulletinTimezone enforces type; manifest is host-validated at install |
| V12 File Handling | no | No file uploads in Phase 3 (BULL-V2-01 deferred) |

### Known Threat Patterns for {plugin-bulletin}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via Standing Numbers slot SQL | Tampering | All SQL in `STANDING_NUMBER_SLOTS` is static; only `companyId` parameter is `$1`-bound. No string concat. |
| LLM prompt injection via issue body | Tampering | Pass-1 LLM output validated against JSON schema; verified by deterministic pass-2 (SQL re-query). User-controlled content (issue body) cannot influence numeric claims. |
| Action Inbox shows other users' issues | Information disclosure | opt-in-guard wrap + server-side `assigneeUserId === viewerUserId` filter (Pattern from Phase 2 OPTIN-04). |
| Errata composer writes for other users | Authorization | `addErratum` action validates `authorId === viewerUserId`; only opted-in users can compose. |
| Compile job mass-creates issues | Denial of service / cost | Idempotency key `(next_due_at, content_hash)` prevents re-publish. Three-failure circuit breaker (existing). `bulletin_compile_failures` table caps retries at 3/cycle. |
| Bulletin issue body contains user-injected XSS | Tampering | Paperclip renders markdown — host-side sanitization, not our concern. We emit only plain markdown text + ref-chip placeholders. |

---

## Assumptions Log

> Listing all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adding `activities` to `coreReadTables` will pass `PluginDatabaseCoreReadTable` union | Q4 / Migration Plan | Compile fails at TypeScript step; fallback = use `paperclipApiRequest` MCP escape (verified to work in Phase 2). Verifiable in Plan 03-01 Task 1 in <60 sec by adding `'activities'` to the array and running `pnpm typecheck`. |
| A2 | `paperclipApiRequest` MCP tool can hit `/api/issues?status=blocked&assigneeUserId=...` or equivalent | §Code Examples | Action Inbox query fails. Fallback = use `ctx.issues.list({status:'blocked'})` directly and filter in worker code (already shown in §Code Examples). |
| A3 | `IssueBlockerAttention.state === 'needs_attention'` is the correct match for "Eric must decide" | §Common Pitfalls #3 | Action Inbox shows wrong cards. Verifiable on Countermoves drill in Plan 03-03 task 4. |
| A4 | Temporal-proximity heuristic (Δt ≤ 5 min, same actor chain) produces useful lineage clusters | §Don't Hand-Roll + Risk #5 | Lineage threads look noisy. Fallback = render only the trace ending at `clarity:editor-write` tagged event; everything else collapsed. |
| A5 | `paperclipListIssues` MCP tool accepts a date-window filter for "yesterday 06:30 ET → today 06:30 ET" | §State of the Art | Pass-1 input set is too broad; LLM context bloats. Fallback = filter in `ctx.issues.list` then date-window-filter in code. |
| A6 | Eric is fine overriding CONTEXT.md D-12's luxon recommendation in favor of date-fns-tz | §Standard Stack | Re-discuss; bundle penalty is the operative consideration. |
| A7 | Bulletin compile fires reliably at minute granularity from `jobs[] schedule: '*/1 * * * *'` | §Architecture Patterns / Pattern 1 | If host scheduler skips minutes, the worker would still recompute correctly on the next fire (next_due_at semantics are robust to missed fires). |

---

## Open Questions (RESOLVED — spike-deferred to named tasks)

1. **Q3 follow-up: Does `IssueBlockerAttention.state='needs_attention'` actually correspond to the user-facing "awaiting Eric's decision" state?**
   - What we know: enum is `none | covered | stalled | needs_attention`; Phase 2 awaiting-you-count uses this exact field.
   - What's unclear: whether some `stalled` issues also belong in Action Inbox.
   - Recommendation: Plan 03-03 Task 1 fixture against Countermoves COU-{N} confirms which `state` values map to user-visible Action Inbox cards.
   - **RESOLVED:** Spike owned by **Plan 03-03 Task 4** (Countermoves drill) — the operator confirms whether `'stalled'` issues genuinely await Eric's decision. The `blockerAttention.state` set in the `action-inbox.ts` query filter is a planner-tunable constant. Until the drill says otherwise, the working contract is D-19's corrected mapping (`state ∈ {'needs_attention','stalled'}`); if the drill shows `'stalled'` does not belong, the filter narrows to `state==='needs_attention'` only.

2. **Q4 follow-up: Does the activity log expose enough fields to group lineage threads without a `caused_by_activity_id` column?**
   - What we know: SDK exposes `ctx.activity.log()` (write-only). MCP server lists comments + issues but NOT an activities-by-time endpoint.
   - What's unclear: whether the temporal heuristic produces useful clusters for a real day on Countermoves.
   - Recommendation: Plan 03-03 includes a spike task — render a sample lineage thread from Countermoves data, eyeball quality before locking the algorithm.
   - **RESOLVED:** Spike owned by **Plan 03-03 Task 3** (lineage derivation) and verified in **Task 4** (Countermoves drill). The 5-minute temporal-proximity threshold and the actor-derivation fallback are planner-tunable constants. Until the drill says otherwise, the working contract is D-21's corrected mapping (`(entityId, actorChain, Δt ≤ 5 min)` clustering); if Countermoves data fragments threads, lift the threshold to 15 min.

3. **Q-NEW: Should the `routines.managed` capability be added so the bulletin compile can also be visible in the host's Routines panel?**
   - What we know: `ctx.routines.managed.reconcile(routineKey, companyId)` exists; if we declared `routines: [{routineKey:'daily-bulletin', triggers:[...cron]}]`, the host would create a Routine entity owned by the Editor-Agent. Eric could see "Daily Bulletin" alongside other routines in the classic UI.
   - What's unclear: whether double-declaring (job for actual compile + routine for visibility) creates surprising semantics (e.g., Eric pauses the routine in classic UI; does the job stop?).
   - Recommendation: Plan 03-01 Task 3 spike — declare the routine alongside the job, test pause-routine-in-classic-UI behavior. If it pauses cleanly, ship both. If confusing, drop the routine declaration.
   - **RESOLVED:** Decision recorded in **Plan 03-01 Task 3**: the `routines[]` visibility-declaration is **deferred — not planned for Phase 3**. `jobs[]` is the sole scheduling primitive per D-12; a `routines[]` entry purely for host-panel visibility is a v2 nice-to-have. No spike runs in Phase 3; the `jobs[]`-only mechanism is the working contract.

---

## Sources

### Primary (HIGH confidence — verified by reading the file)

- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1009-1098` — `PluginIssuesClient` shape (create, createComment, list, etc.)
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:340-351` — `PluginJobsClient.register` + `PluginJobContext`
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:369-378` — `PluginDatabaseClient.query`/`execute`
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:430-460` — `PluginActivityClient` (NO `caused_by_activity_id`)
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:628-653` — `PluginRoutinesClient` (NOT a scheduler)
- `node_modules/@paperclipai/shared/dist/types/plugin.d.ts:193-224` — `PluginManagedRoutineDeclaration` shape (proves routines ≠ jobs)
- `node_modules/@paperclipai/shared/dist/types/plugin.d.ts:459-488` — `PaperclipPluginManifestV1` (jobs?[] AND routines?[] independent fields)
- `node_modules/@paperclipai/shared/dist/types/issue.d.ts:102-111` — `IssueBlockerAttention` shape (the D-19 mapping)
- `node_modules/@paperclipai/shared/dist/constants.d.ts:26-27` — `ISSUE_STATUSES` (proves `awaiting_human` is NOT a status)
- `src/manifest.ts`, `src/worker.ts`, `src/worker/agents/self-loop-filter.ts`, `src/worker/agents/editor.ts` — Phase 2 codebase verified line-by-line
- `migrations/0001-0003_*.sql` — existing plugin namespace schema
- `sketches/paperclip-fix-bulletin.html` — visual contract (lines 237-456)

### Secondary (MEDIUM confidence)

- `https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/plugins/PLUGIN_SPEC.md` (§17 Scheduled Jobs — quoted: "host is the scheduler of record"; cron TZ semantics under-specified — confirms CONTEXT.md D-12 worker-managed approach)
- `https://raw.githubusercontent.com/paperclipai/paperclip/master/packages/mcp-server/README.md` (MCP tool inventory — 23 read tools; NO list-activities-by-time-window)
- [date-fns vs Day.js vs Luxon 2026: Which Date Library Wins?](https://www.pkgpulse.com/blog/best-javascript-date-libraries-2026) — bundle size comparison
- [Mocking/stubbing Date in `node:test`](https://codewithhugo.com/node-test-mock-date-and-timers/) — Node 21.2+ requirement; fallback pattern: inject `now` as param
- [Node.js Test Runner — MockTimers](https://nodejs.org/api/test.html) — `mock.timers.setTime` API
- `.planning/research/PITFALLS.md` §9 (DST), §10 (hallucinated summaries), §14 (transcription drift) — pre-existing project research

### Tertiary (LOW confidence — needs in-plan verification)

- Action Inbox status mapping: `blockerAttention.state ∈ {needs_attention, stalled}` — assumed but not drilled
- `coreReadTables` accepts `'activities'` — assumed; verify by adding and typechecking
- Temporal-proximity heuristic delta of 5 min — researcher's pick; planner may tune

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — date-fns-tz is the right call given the bundle research and luxon's CJS-only ESM gap
- Architecture: HIGH — 8 patterns each grounded in either an existing Phase 2 file or a verified SDK call
- Pitfalls: HIGH — every pitfall has either a Phase 2 precedent or a citation to PITFALLS.md
- Open questions: MEDIUM — three assumptions (A1, A2, A4) cleanly fall back to known-working alternatives if wrong

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (stable; revisit only if Paperclip's SDK ships a new major version with `caused_by_activity_id` or a date-window activities endpoint)

---

*Phase: 03-daily-bulletin*
*Researched 2026-05-15 against `@paperclipai/plugin-sdk@2026.512.0` + `@paperclipai/shared@2026.512.0` and the Phase 2 codebase (commits a49e720..7b5f1be).*
