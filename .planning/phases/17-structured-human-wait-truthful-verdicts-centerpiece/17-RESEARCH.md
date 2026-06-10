# Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE) - Research

**Researched:** 2026-06-10
**Domain:** Deterministic blocker-chain classification engine + additive plugin-namespace persistence + Editor-Agent populator + Reader legibility surgery
**Confidence:** HIGH (all anchors quoted from real source; zero new packages; the only MEDIUM item is the D-12 host-route confirmation, resolved below to "link issues only")

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-13) — research THESE, do not relitigate

- **D-01:** Editor-Agent (the only AI) interprets employee prose, detects "blocked on a human decision," writes a STRUCTURED row to an additive plugin-namespace table. Pure engine reads that row → `AWAITING_HUMAN`. **No new employee-agent behavior** — the signal is derived from comments employee agents already produce.
- **D-02:** Engine stays AI-free (SC4). AI produces the *data row* (like `ownerUserId`/TL;DRs today); classification is deterministic.
- **D-03:** Detection tuned for **HIGH PRECISION, not recall.** A missed wait falls back to today's conservative Watch floor; a false positive erodes trust. Precision wins.
- **D-04:** The wait is **re-derived each compile** (SWR-cached, re-evaluated on the next reactive pass). Clears automatically when comments no longer show an open wait or the issue leaves blocked. NOT sticky-until-explicit-resolution.
- **D-05:** Row captures `{ polished decision one-liner (the "what"), owner user id (the "who") }`. The Needs-you row reads **"`<owner> to decide: <one-liner>`"**. One-liner produced via the SAME `polishTldr` already used in `build-employees-rollup.ts` — voice parity by construction.
- **D-06:** Structured-wait owner is **ALWAYS the company's primary human** (the founder), ignoring any issue-level human assignee, for the structured-wait path only. Single-operator simplification. Resolve GENERICALLY — no company-prefix or name literals. **D-06 applies ONLY to the new structured-wait signal**; native `blocked+human-owned` (WAIT-03) keeps its own native `ownerUserId`.
- **D-07:** When an issue has BOTH a structured wait AND an agent assignee, the **structured wait WINS** → `AWAITING_HUMAN`. Extends the engine's existing "awaiting beats agent ownership" rule (`blocker-chain.ts:305-307`). Ranks at priority 0 alongside native `AWAITING_HUMAN`.
- **D-08:** **REUSES the existing `AWAITING_HUMAN` terminal kind** — NO 9th kind. The 8-kind union and `pickTopChains` ranking stay unchanged. Decision one-liner goes in the label; existing `reply` affordance.
- **D-09:** Remaining blocked-no-edge classes keep their honest terminals: `blocked+agent-owned` → `AWAITING_AGENT_STUCK`; `blocked+unowned` → `UNOWNED`. WAIT-03 verifies all four classify truthfully.
- **D-10:** Extend the existing SC5 cross-surface consistency guard into a FULL matrix (every surface × every terminal kind). Keep `blocker-chain.ts` pure (determinism + AI-token grep guards still pass). Planner decides matrix encoding/CI placement; coordinates with Phase 20.
- **D-11:** Breadcrumb — **DROP the root company-mission goal segment entirely** (its `goal.title` is the whole 1k+ char mission). Truncate any OTHER long segment to a short label.
- **D-12:** Breadcrumb links — **link only confirmed-routable segments, plain text otherwise.** Add `/<companyPrefix>/` prefix to URLs we KNOW route (confirmed `/<prefix>/issues/<id>`); plain non-clickable text otherwise. Zero dead links. `companyPrefix` via `extractCompanyPrefixFromPathname(useHostLocation().pathname)`.
- **D-13:** Ref-cards — **lead plain-English, demote machine codes.** Human title / what's-going-on first; move `BEAAA-NNN` to a subtle secondary position; translate `Stuck`/`Standby` status code-chips into plain words. Keep identifiers recoverable.

### Claude's Discretion
- Exact plugin-namespace table shape (columns, indexes) + migration number — additive-only, plugin namespace.
- Exact Editor-Agent prompt/heuristic for high-precision human-wait detection.
- Exact SC5 matrix encoding and where in CI it runs.
- Precise breadcrumb-segment truncation length and ref-card visual treatment.

### Deferred Ideas (OUT OF SCOPE)
- A 9th terminal kind (`AWAITING_HUMAN_DECISION`) — rejected for v1.5.0 (D-08).
- Multi-operator owner routing — out (D-06).
- A deterministic agent-emitted marker grammar / Clarity MCP tool for employee agents — not now.
- Phase 18 legibility (Open ↗ → Reader, partial-hash UUID, "Looks done — close it?") and Phase 19 action-card async re-arch — separate phases.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WAIT-01 | Agents have a STRUCTURED way to declare "blocked on a human decision X" | Area 3 (additive table `0018`) + Area 4 (Editor-Agent populator). Producer/consumer split mirrors the TL;DR cache exactly. |
| WAIT-02 | Deterministic engine classifies a structured human-wait as `AWAITING_HUMAN` (needs-you), not Watch | Area 1 (engine branch at `blocker-chain.ts:305-307`) + Area 2 (nodeMeta carries the signal on BOTH builders). |
| WAIT-03 | Every blocked-no-edge class classified truthfully | Area 1 + Area 9. The 12-08 fix already classifies agent-owned/human-owned/unowned correctly; structured-wait is the 4th case. |
| WAIT-04 | SC5 guard extended into a FULL surface × terminal-kind matrix | Area 9 (`test/worker/blocked-no-edge-verdict-consistency.test.mjs` is the seed; extend to 4 surfaces × 8 kinds). |
| (seeded) D-11/D-12 | Reader breadcrumb mission-dump + 404 fix | Area 7 (`issue-reader.ts:357-429` deriveAncestry, `breadcrumb.tsx`). |
| (seeded) D-13 | Reader ref-card de-coding | Area 8 (`ref-card.tsx:72-104`). |
</phase_requirements>

---

## Summary

The classification engine (`src/shared/blocker-chain.ts`) is a small, pure, deterministic DFS that flattens a blocker DAG to exactly one of 8 terminal kinds. It reads a `nodeMeta` map injected by the worker — it never does I/O, never reads a clock, never imports AI. The structured-human-wait signal must therefore arrive **as a field on `nodeMeta`**, written by the worker before the engine runs, exactly the way `ownerUserId`/`assigneeAgentId`/`agentState` already arrive. The cleanest seam (zero engine surface change beyond one branch) is to add an optional `structuredWaitOwnerUserId: string | null` field to the engine's `nodeMeta` shape and check it FIRST in the leaf cascade (`blocker-chain.ts:305-307`), emitting `AWAITING_HUMAN` with the founder as `userId` and the decision one-liner in the `label`. Because it reuses `AWAITING_HUMAN` (D-08), `pickTopChains` priority-0 ranking and `classifyVerdict` need **no change at all** — they already map `AWAITING_HUMAN → {needs-you, reply, needsYou:true}`.

The persistence + populator follow the existing TL;DR/action-card producer/consumer pattern 1:1: a new additive plugin-namespace table (migration **`0018`**, plugin schema `plugin_clarity_pack_cdd6bda4bd`), a repo file mirroring `action-cards-repo.ts`, an Editor-Agent detection pass that runs inside the same heartbeat governance (wake-governor, opt-in scope gate, self-loop filter, op-issue handoff) the TL;DR compile already uses, and a SWR re-derive that self-clears (D-04). The pure engine is the consumer. **Two read paths must both merge the row into `nodeMeta` identically** (`org-blocked-backlog.ts` + `flatten-blocker-chain.ts`) — this is the SC5 parity trap and the single largest landmine.

The two Reader fold-ins are surgical: `deriveAncestry()` (`issue-reader.ts:357-429`) builds prefix-less URLs (`/issues/`, `/goals/`, `/projects/`) that 404, and dumps the mission `goal.title`; `breadcrumb.tsx` renders every segment as a clickable `<a>`. `ref-card.tsx:72-104` leads with `card.id` (`BEAAA-NNN`) and renders raw `Stuck`/`Standby` pills.

**Primary recommendation:** Add `structuredWaitOwnerUserId` to the engine `nodeMeta` type + one leaf-cascade branch at line 305; ship migration `0018_structured_human_wait.sql` + `clarity-human-wait-repo.ts`; wire detection into the Editor-Agent heartbeat producer + the situation-room prefetch consumer; merge the row into `nodeMeta` in BOTH BFS builders; resolve the founder via `clarity_agent_owners.owner_user_id` (instance-agnostic, already the opt-in mechanism); fix the two Reader files; extend `blocked-no-edge-verdict-consistency.test.mjs` to the full matrix.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Structured-wait detection (prose → row) | API/Worker (Editor-Agent) | — | The only AI in the system; runs in worker process under governance (D-01/D-02). |
| Structured-wait persistence | Database (plugin namespace) | — | Additive-only `plugin_clarity_pack_cdd6bda4bd` table (SC1, coexistence #3/#6). |
| Classification (row → terminal) | Shared pure engine (`blocker-chain.ts`) | — | Deterministic, AI-free (SC4). Reads `nodeMeta`. |
| nodeMeta assembly (inject the wait) | API/Worker (both BFS builders) | — | The worker is where I/O + clock are legitimate; engine reads no clock. |
| Founder resolution (the "who") | API/Worker | Database (`clarity_agent_owners`) | Instance-agnostic via the existing opt-in owner table (D-06). |
| Verdict render (the "what" one-liner) | Browser (Reader/SR/Bulletin/Chat) | — | Surfaces read the structured verdict fields, never re-derive (SC5). |
| Breadcrumb / ref-card legibility | Browser (Reader UI) | API/Worker (`deriveAncestry` URL build) | URL prefix + mission-drop split across worker (URL) + UI (render gate). |

---

## Standard Stack

**No new packages.** This phase is additive SQL + TypeScript inside the existing plugin. Stack pins are forced by CLAUDE.md (React 19 peer-only, TS ^5.7.3, esbuild ^0.27.3, ESM, Node ≥20, Drizzle host-side, `@paperclipai/plugin-sdk@2026.512.0`). The DB write path is `ctx.db.execute` (DML in plugin namespace) + `ctx.db.query` (SELECT-only), per the existing repos.

### Package Legitimacy Audit

> **N/A — this phase installs ZERO external packages.** All work is additive SQL migrations + TypeScript against already-installed, already-pinned dependencies. No `npm install`, no registry fetch, no slopcheck needed. (If the planner later decides to add a tiny detection helper lib — it should NOT — that would require the gate; the recommendation is to hand-write the heuristic, see Don't Hand-Roll.)

---

## Architecture Patterns

### System Architecture Diagram (structured-wait data flow)

```
   employee-agent comments (prose: "I need Eric to decide X")
            │
            ▼
   ┌─────────────────────────────────────────────┐
   │ Editor-Agent heartbeat producer pass (D-01)  │  src/worker/agents/editor.ts
   │  - reads comments (already does, for TL;DRs) │  (alongside the TL;DR compile loop)
   │  - HIGH-PRECISION detect "blocked on human   │
   │    decision" (LLM via op-issue handoff)      │  governed by wake-governor + opt-in gate
   │  - resolve founder = clarity_agent_owners    │  (Phase 16.1, no-storm)
   │  - polishTldr(one-liner)                     │  polishTldr from compile-tldr.ts
   └───────────────┬─────────────────────────────┘
                   │  upsert / delete (self-clear, D-04)
                   ▼
   ┌─────────────────────────────────────────────┐
   │ ADDITIVE plugin-namespace table  (mig 0018)  │  plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
   │  { company_id, issue_id, owner_user_id,      │
   │    decision_one_liner, content_hash,         │
   │    generated_at, compiled_by_agent_id }      │
   └───────────────┬─────────────────────────────┘
                   │  SELECT (one query/company in the prefetch)
                   ▼
   ┌─────────────────────────────────────────────┐
   │ situation-room.ts prefetch  +  BOTH builders │  org-blocked-backlog.ts / flatten-blocker-chain.ts
   │  merge wait → nodeMeta[issueId]              │  IDENTICAL field set (SC5 parity!)
   │   .structuredWaitOwnerUserId = founder       │
   │   (+ carry the one-liner for the label)      │
   └───────────────┬─────────────────────────────┘
                   │  flattenBlockerChain(input)   [PURE — no I/O, no clock, no AI]
                   ▼
   ┌─────────────────────────────────────────────┐
   │ blocker-chain.ts leaf cascade  (line ~305)   │  NEW first branch:
   │  structuredWait present → AWAITING_HUMAN     │  beats status==='awaiting', ownerUserId,
   │   userId = founder, label = "<who> to        │  assigneeAgentId (D-07 wins over agent)
   │   decide: <one-liner>"                        │
   └───────────────┬─────────────────────────────┘
                   │  classifyVerdict (UNCHANGED) → needs-you / reply / needsYou:true
                   ▼
        Reader · Situation Room · Bulletin · Chat  (read verdict; SC5 one verdict everywhere)
```

### Pattern 1: Engine reads worker-injected nodeMeta (the producer/consumer split)
**What:** The engine never fetches. The worker assembles `nodeMeta` (status, ownerUserId, assigneeAgentId, agentState) and the engine classifies. The structured wait is just one more injected field.
**Where it plugs in:** `BlockerChainInput.nodeMeta` value shape at `blocker-chain.ts:25-39`:
```ts
// src/shared/blocker-chain.ts:25-39  (the engine nodeMeta value type)
nodeMeta: Record<string, {
  ownerUserId: string | null;
  etaIso: string | null;
  status: string;
  assigneeAgentId?: string | null;
  agentState?: 'working' | 'stuck' | null;
  // ADD (D-07): the founder user id when a structured human-wait exists for this
  // node; null/absent otherwise. Optional → every pre-17 caller stays type-clean.
  structuredWaitOwnerUserId?: string | null;
  // ADD (D-05): the polished decision one-liner for the AWAITING_HUMAN label.
  structuredWaitOneLiner?: string | null;
}>
```

### Pattern 2: The leaf-cascade branch (D-07, beats agent ownership)
**Where:** `blocker-chain.ts:305-360`. The cascade order today is: external → `status==='awaiting' && ownerUserId` → `ownerUserId` → `assigneeAgentId` → `etaIso` → UNOWNED. Insert the structured-wait check as the **first** branch after the EXTERNAL guards (i.e. before line 308), so it wins over both `status==='awaiting'` and `assigneeAgentId`:
```ts
// INSERT at src/shared/blocker-chain.ts ~line 305 (immediately after the two EXTERNAL guards,
// before the `meta?.status === 'awaiting'` branch). D-07: structured wait beats agent ownership.
if (meta?.structuredWaitOwnerUserId != null) {
  const terminal: Terminal = {
    kind: 'AWAITING_HUMAN',
    userId: meta.structuredWaitOwnerUserId,
    // D-05: the rendered "<owner> to decide: <one-liner>" comes from scrubHumanAction +
    // the wording layer; the engine label carries the one-liner so the scrub/label has it.
    label: meta.structuredWaitOneLiner
      ? `${meta.structuredWaitOwnerUserId} to decide: ${meta.structuredWaitOneLiner}`
      : `${meta.structuredWaitOwnerUserId} to act on ${current}`,
  };
  return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
}
```
**Why this is the entire engine change:** `classifyVerdict` (lines 60-93) already maps `AWAITING_HUMAN → { tier:'needs-you', actionAffordance:'reply', needsYou:true }`. `pickTopChains` (lines 398-425) already ranks `AWAITING_HUMAN = 0`. **No 9th kind, no ranking change, no verdict-map change** (D-08 satisfied by construction). The `Terminal` union (`types.ts:43-51`) is unchanged.

### Pattern 3: Additive plugin-namespace repo (mirror action-cards-repo.ts)
The repo, table, and idempotency follow `action-cards-repo.ts` + `0015_action_cards.sql` exactly (quoted in Area 3). `ctx.db.execute` does the INSERT … ON CONFLICT; `ctx.db.query` reads. UNIQUE = the idempotency key. The host validator rejects standalone `CREATE INDEX` and any `UPDATE`/non-DDL in the migration — the inline `UNIQUE(...)` is the only index mechanism (see `0013` + `0015` headers).

### Anti-Patterns to Avoid
- **Importing AI tokens into `blocker-chain.ts`** — the grep guard (`test/shared/blocker-chain.test.mjs:408-415`) fails the build on `/openai|anthropic|claude_local|llm|gpt|completion/i`. The engine change is pure data-field reads only.
- **Writing the wait on only ONE read path.** Both `org-blocked-backlog.ts` (SR) and `flatten-blocker-chain.ts` (Reader) must merge the row into `nodeMeta[startId]` identically, or the SC5 matrix diverges (the exact BEAAA-972 bug class).
- **Making the wait sticky.** D-04 requires self-clear: re-derive each compile; delete/no-write when the wait is gone. Do NOT add explicit-resolution state.
- **A second human-assignee override for native human-owned issues.** D-06 scope note: the structured-wait founder override applies ONLY to the structured-wait branch; native `blocked+human-owned` keeps its own `ownerUserId`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BFS edge/nodeMeta build | A third walker | EXPORTED `buildEdges` (`org-blocked-backlog.ts:293`) + `walkBlockerChain` (`flatten-blocker-chain.ts:302`) | Two walkers already exist and MUST stay in lockstep (SC5). A third diverges. |
| Founder resolution | A new "primary user" query / company-prefix literal | `clarity_agent_owners.owner_user_id` SELECT (see Area 6) | Already the instance-agnostic opt-in mechanism (`opted-in-company-set.ts:110-115`). |
| Decision one-liner voice | A new polish function | `polishTldr(input)` (`compile-tldr.ts:370`) | D-05 demands voice parity by construction. |
| UUID→name scrub on the label | A new scrub | `scrubHumanAction` (`scrub-human-action.ts`) | Single source of truth; NO_UUID_LEAK already enforced. |
| LLM op-issue handoff for detection | A new delivery layer | `startAgentTask`/`pollAgentTaskResult` + op-issue pattern (`editor.ts:305-329`) | The TL;DR compile already proves this path; the consume-before-spawn + drainer machinery is built. |
| Idempotent cache write | Read-then-write | `INSERT … ON CONFLICT (…) DO …` (`action-cards-repo.ts:65-69`) | Server-side dedup, no race. |
| Wake governance / no-storm | New guard | `checkAndRecordWake` / opt-in scope gate / self-loop filter (Phase 16.1) | The storm fix is built and live-verified; reuse it verbatim. |

**Key insight:** The structured-wait row is structurally a sibling of the TL;DR cache and the action-card cache. Every hard part (op-issue LLM delivery, idempotency, governance, scrub, voice, founder resolution) already exists. The phase is composition, not invention — the ONLY genuinely-new code is (a) one engine branch, (b) one table + repo, (c) one detection prompt, (d) the nodeMeta merge on two paths, (e) two Reader files.

---

## Per-Area Findings

### Area 1 — The engine cascade integration point (D-07/D-08/D-09)

**File:** `src/shared/blocker-chain.ts`

- **`classifyVerdict(terminal)` — lines 60-93.** Exhaustive `switch` over the 8 kinds with a `const _exhaustive: never` guard. `AWAITING_HUMAN → { tier:'needs-you', actionAffordance:'reply', needsYou:true }` (lines 66-67). **No change needed for D-08.** Adding a 9th kind here would be a compile error — which is exactly why D-08 reuses `AWAITING_HUMAN`.
- **`flattenBlockerChain` leaf selection — lines 274-360.** Cascade after the two EXTERNAL guards (284-303):
  1. `meta?.status === 'awaiting' && meta.ownerUserId != null` → `AWAITING_HUMAN` (lines 308-315) — **this is the existing "awaiting beats agent ownership" rule D-07 extends.**
  2. `meta?.ownerUserId != null` → `AWAITING_HUMAN` (318-325)
  3. `meta?.assigneeAgentId != null` → `AWAITING_AGENT_WORKING|STUCK` (330-344)
  4. `meta?.etaIso != null && ownerUserId == null` → `SELF_RESOLVING` (345-352)
  5. else → `UNOWNED` (356-360)
  **Insert the structured-wait branch BEFORE step 1** (it must win over a nominal agent assignee AND over a native `status==='awaiting'` row, since the structured wait names the actual decision). Quoted insert in Pattern 2 above.
- **`pickTopChains` — lines 398-425.** `AWAITING_HUMAN = 0` (line 405). **No change** (D-08).
- **`nodeMeta` value shape — lines 25-39.** Add `structuredWaitOwnerUserId?` + `structuredWaitOneLiner?` (both optional → backward type-clean). This is the ONLY type edit in the engine.
- **Determinism:** the new branch is a pure field read returning a deterministic terminal — the 100-run `JSON.stringify` test (`test/shared/blocker-chain.test.mjs:287-309`) stays green as long as the injected fields are deterministic per input (they are; the worker resolves them before the call).

### Area 2 — How nodeMeta is built today (the SC5 dual-path parity trap)

**Canonical nodeMeta shape:** `EdgeNodeMeta` at `org-blocked-backlog.ts:60-66`:
```ts
type EdgeNodeMeta = {
  ownerUserId: string | null; etaIso: string | null; status: string;
  assigneeAgentId: string | null; agentState: 'working' | 'stuck' | null;
};
```
The Reader mirror is `WalkOutput.nodeMeta` at `flatten-blocker-chain.ts:93-105` — an **inline duplicate** of that exact field set (a `flatten-blocker-chain-parity.test.mjs` pins they agree). **Both must gain `structuredWaitOwnerUserId` + `structuredWaitOneLiner`.**

Three write sites assemble `nodeMeta[startId]` and ALL must merge the structured wait the same way:
1. **SR org backlog:** `org-blocked-backlog.ts:365-371` (blocker targets) — but the ROOT meta is injected in the **rollup**, see #3.
2. **Reader root meta:** `flatten-blocker-chain.ts:354-360` (`walkBlockerChain` attaches root meta for the empty-edges blocked-root case — the BEAAA-972 fix at lines 311-365).
3. **SR rollup root meta:** `build-employees-rollup.ts:441-451` (injects the focus/root issue's own meta before `flattenBlockerChain`).

**The merge mechanism (recommended):** the structured wait is keyed by **issue id** and applies to the ROOT issue (the blocked issue the operator sees), so merge it where the ROOT meta is set — sites #2 and #3 — and (for SR backlog) where the row is built. Because the prefetch (Area 3) already builds a `Map<issueId, waitRow>` once per company, each write site does a cheap `waitMap.get(startId)` and sets the two fields. **This is the single biggest landmine: a wait merged on #3 but not #2 reproduces the exact cross-surface divergence SC5 exists to kill.** Pin it with the extended matrix test (Area 9).

### Area 3 — The plugin-namespace table + repo pattern (D-01/SC1)

- **Migration numbering:** latest is `0017_loop_governor.sql`; `0012` is intentionally skipped. **New migration is `0018_structured_human_wait.sql`.** Additive-only, idempotent (`CREATE TABLE IF NOT EXISTS`), plugin schema literal `plugin_clarity_pack_cdd6bda4bd` (no template substitution — `0013`/`0015` headers state the host validator requires fully-qualified names).
- **Validator constraints (from `0013`/`0015` headers, HIGH confidence):** DDL statements only (no `UPDATE` in the migration — the upsert lives in the repo); **no standalone `CREATE INDEX`** (the host `extractQualifiedRefs` regex doesn't recognize it) → the index comes from an inline `UNIQUE(...)`; **apostrophe-free `COMMENT ON` bodies** (greedy string-literal strip hazard); file ends on a semicolon-terminated statement.
- **Recommended table shape** (mirrors `0015_action_cards.sql:48-63`):
```sql
-- migrations/0018_structured_human_wait.sql  (ADDITIVE-ONLY, plugin namespace)
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_human_waits (
  id                   bigserial PRIMARY KEY,
  company_id           text NOT NULL,
  issue_id             text NOT NULL,           -- the blocked issue (root) the wait grounds in
  owner_user_id        text NOT NULL,           -- the founder (D-06), resolved generically
  decision_one_liner   text NOT NULL,           -- polishTldr-voiced "what" (D-05)
  content_hash         text NOT NULL,           -- SWR idempotency (re-derive each compile, D-04)
  generated_at         timestamptz NOT NULL DEFAULT now(),
  compiled_by_agent_id text NOT NULL,           -- governance parity audit field
  source_revisions     text[] NOT NULL DEFAULT '{}',
  UNIQUE (company_id, issue_id)                  -- one live wait per issue per company; ON CONFLICT upsert
);
```
  **Index note:** the per-snapshot read is `WHERE company_id = $1` returning all live waits for the company (then a `Map<issue_id, row>`). The inline `UNIQUE(company_id, issue_id)` btree covers point lookups AND the company scan-prefix adequately for v1 (bounded N blocked issues, same reasoning as `0013`'s "PK + bounded scan"). No separate index migration.
- **Repo file:** `src/worker/db/clarity-human-wait-repo.ts`, mirroring `action-cards-repo.ts` (upsert via `ctx.db.execute` + `ON CONFLICT (company_id, issue_id) DO UPDATE`, a `listClarityHumanWaitsForCompany(ctx, companyId)` SELECT returning the row set, and a delete/clear path for D-04 self-clear). `text[]` columns bind via `toPgTextArrayLiteral` + `$N::text[]` (the v0.6.5 Bug 2 fix; `action-cards-repo.ts:23,81`).
- **Self-clear (D-04):** because the wait is `UNIQUE(company_id, issue_id)` and re-derived each compile, the producer either upserts the current wait or **deletes** the row when detection no longer fires / the issue left blocked. A `DELETE … WHERE company_id=$1 AND issue_id=$2` is DML in the repo (allowed via `ctx.db.execute`), NOT in the migration. Consider a "last-seen-compile" staleness sweep so an issue the Editor never revisits doesn't strand a wait (mirror the SWR freshness window `WARM_FRESHNESS_WINDOW_MS` in `editor.ts:427`).

### Area 4 — The Editor-Agent populator path (D-01..D-04)

**File:** `src/worker/agents/editor.ts`

- **Where it hooks in:** `handleEditorHeartbeat` (lines 246-397) already, per issue: `ctx.issues.get` (261) → recursion guard `isOwnOperationIssue` (270) → `ctx.issues.listComments` (278) → builds `inputs` (279-285) → `prepareTldrCompile` (293) → `startAgentTask`/`pollAgentTaskResult` op-issue handoff (305-318) → `finalizeTldr` (320). **The structured-wait detection is a sibling step in this same per-issue loop** — it reads the SAME comments already fetched, runs a HIGH-PRECISION detection prompt through the SAME op-issue delivery layer, and on a positive result upserts the `clarity_human_waits` row (else deletes any stale one for D-04 self-clear).
- **Governance reuse (Phase 16.1, no-storm):** the heartbeat already runs under the wake-governor (`checkAndRecordWake`, `editor.ts:533`), the opt-in scope gate (`ensureSeeded`/`isCompanyOptedIn`, `editor.ts:577-579`), and the self-loop filter (`filterSelfLoopEvents`, line 250). Detection must NOT add a new wake path — it rides the existing bounded-warm/heartbeat pull. **Degrade-safe floor:** when the Editor is down, no rows are written → issues fall to the conservative Watch floor (NOT a fabricated needs-you) — exactly the D-03 precision posture.
- **Op-issue origin kind:** follow `operationOriginKind('tldr-compile')` → add a new `human-wait-detect` operation kind in the same `plugin:clarity-pack:operation:` namespace (`OPERATION_ORIGIN_KIND_PREFIX`, `agent-task-delivery.ts`) so it is auto-excluded from the board AND from re-compilation (the `isOwnOperationIssue` guard at line 224-229 covers the whole namespace).
- **Re-derive / self-clear (D-04):** key the row by `content_hash` over the same comment-input set the TL;DR uses (`tldrContentHash` pattern, `compile-tldr.ts`). On each compile: detection fires → upsert; detection negative OR issue not blocked → delete. SWR-cached so two heartbeats over the same unchanged inputs are a no-op (the `prepareTldrCompile` cache-hit short-circuit at `editor.ts:303` is the model).
- **High-precision prompt (Claude's discretion):** the detection prompt should return a structured `{ isHumanWait: boolean, decisionOneLiner: string | null }` and only set `isHumanWait` when the prose **names a decision/question awaiting a specific person** (D-03). Default to `false` on ambiguity. (Mirror the bulletin's structured-JSON extraction `extractJsonObject`, `compile-pass-1.ts:297`, for robust parse-out-of-prose.)

### Area 5 — `polishTldr` / Reader-voice helper (D-05)

**Signature:** `export function polishTldr(input: string): string` — `compile-tldr.ts:370-378`. Pure: `isoDateToHuman → stripRestatedParenAfterRef → stripParensAroundLoneRef → applyJargonGlossary`. Returns `''` on empty/non-string input. **Usage model:** see `build-employees-rollup.ts:384-385` — `polishTldr(rawFocus)` then truncate to ≤80 chars with `…`. Apply the same to the detection one-liner before writing the row, so the persisted `decision_one_liner` is already voice-parity. The render `"<owner> to decide: <one-liner>"` is composed in the wording layer (`blockerLine` in `live-blocker-panel.tsx:83-113` for Reader; the SR/Bulletin/Chat read the same scrubbed `awaitedPartyLabel`).

### Area 6 — Resolving "the company's primary human" generically (D-06)

**The instance-agnostic founder = `clarity_agent_owners.owner_user_id`.** This table (migration `0013`) records operator-claimed agent ownership and is ALREADY the mechanism the opt-in scope gate uses to map a company → its human (`opted-in-company-set.ts:16-39,110-115`):
```sql
-- the existing instance-agnostic user↔company mapping (opted-in-company-set.ts:110-115)
SELECT DISTINCT company_id FROM plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners
WHERE owner_user_id = ANY($1::text[])
```
For D-06, run the inverse: `SELECT owner_user_id FROM plugin_clarity_pack_cdd6bda4bd.clarity_agent_owners WHERE company_id = $1` and pick the primary (e.g. the most-frequent / earliest `set_at` owner, or — for the solo-operator v1.5.0 lock — the single owner). `listClarityAgentOwnersForCompany(ctx, companyId)` (`clarity-agent-owners-repo.ts:84-94`) already returns `{ agent_id, owner_user_id }[]` for a company — reuse it and take the distinct `owner_user_id`. **No company-prefix or name literal.** Fallback when no owner row exists: skip writing the wait (degrade-safe; the issue falls to the conservative floor) rather than guess a user.
*(Note: the bulletin's `prepareForName` uses the company NAME as a stand-in, NOT a real user id — `compile-pass-1.ts:249-272` — so it is NOT the right source for the wait owner. Use `clarity_agent_owners`.)*

### Area 7 — [EXPLICIT RESEARCH ITEM, D-12] Host goal/project page routes

**File:** `src/worker/handlers/issue-reader.ts` `deriveAncestry()` (lines 357-429).
- **The bug:** URLs are built **prefix-less**: `parent.url = /issues/${parentKey}` (376), `project.url = /projects/${p.id}` (394), `milestone(goal).url = /goals/${g.id}` (414). Per memory `paperclip-issue-url-pattern`, host issue routes are `/<companyPrefix>/issues/<identifier>` — so ALL THREE 404 today. The mission-dump is `ancestry.milestone.title = goal.title` (413), where `goal.title` IS the entire 1k+ char company mission (memory `reader-breadcrumb-legibility-bug`; `index.tsx:351-358` documents the BEAAA-828 pathology).

**Host-route confirmation table (D-12 = link only confirmed-routable):**

| Segment | Worker URL today | Confirmed host route? | Verdict |
|---------|------------------|------------------------|---------|
| **Issue / parent** | `/issues/<key>` | **YES** — `/<companyPrefix>/issues/<identifier>` confirmed in 30+ live-used call sites (`ref-chip.tsx:216`, `employee-row.tsx:238`, `live-blocker-panel.tsx:171`, `reply-in-place.tsx:227`, etc.) AND memory `paperclip-issue-url-pattern` | **LINK** — prefix it to `/<companyPrefix>/issues/<parentIdentifier>` (use the issue *identifier*, not the UUID — the issue route keys on identifier per `ref-chip.tsx:216` using `card.id`). |
| **Project** | `/projects/<id>` | **NO confirmed route.** `[VERIFIED: codebase grep]` — ZERO code anywhere in `src/ui` links to `/<prefix>/projects/...`; only `deriveAncestry` emits the prefix-less form. `[CITED: github paperclipai/paperclip doc/SPEC.md]` mentions "Project/Initiative Views" as a feature but defines **no URL route**. | **PLAIN TEXT** — render non-clickable (truncated label). Do not guess a route. |
| **Goal / milestone** | `/goals/<id>` | **NO confirmed route.** Same as projects: no code links to it; SPEC.md does not define a goals route. | **DROP entirely (D-11)** — the root mission goal is dropped regardless; any non-root goal segment renders **plain text**, not a link. |

**Conclusion (HIGH confidence on issues, the rest by absence-of-evidence + D-12's own "plain text otherwise" rule):** Only the **issue/parent** segment is safe to link (`/<companyPrefix>/issues/<identifier>`). Project and goal/milestone segments render as plain, non-clickable text. The breadcrumb component (`breadcrumb.tsx:33-46`) currently wraps EVERY segment in `<a {...nav.linkProps(s.url)}>` — it must conditionally render `<a>` only when the segment is flagged routable, `<span>` otherwise. Cleanest: add `routable: boolean` (or `url: string | null`) to `AncestrySegment` (set in `deriveAncestry`), and have `breadcrumb.tsx` branch on it. `companyPrefix` reaches the breadcrumb via `extractCompanyPrefixFromPathname(useHostLocation().pathname)` (already imported/used in `reader/index.tsx:53,251-252`; `ref-card.tsx:27,47-48`). Note the worker's `deriveAncestry` does NOT have the pathname — either (a) build the `/<prefix>/issues/<identifier>` URL in the UI from the identifier + the UI-resolved prefix, or (b) have the worker emit a prefix-less canonical and let `breadcrumb.tsx` prepend the prefix. Option (b) keeps the worker instance-agnostic; recommend it.

### Area 8 — Ref-card de-coding (D-13)

**File:** `src/ui/surfaces/reader/ref-card.tsx` (72-104). Current `RefCard` header (79-85):
```tsx
<header className="clarity-ref-card-header">
  <span className="clarity-ref-card-id">{card.id}</span>        {/* BEAAA-NNN FIRST */}
  <strong className="clarity-ref-card-title">{card.title}</strong>
  <StatePill state={statusToPill(card.status)} age={0} />        {/* "Stuck"/"Standby" */}
</header>
<p className="clarity-ref-card-owner">Owner: {card.ownerUserId ?? 'unassigned'}</p>
```
- **`statusToPill` (29-42)** maps `in_progress→'Working'`, `blocked→'Stuck'`, `done/todo/default→'Standby'`. The `StatePill` (`state-pill.tsx:20-32`) renders `humaniseState(state) · age`. D-13 wants these translated to plain words or dropped — e.g. `blocked → "needs attention"` / `in_progress → "in progress"` / `done → "done"` rather than the code-chip vocabulary `Stuck`/`Standby`.
- **D-13 changes (UI-only, within the visual contract):** (1) lead with `card.title` (move `<strong>` first); (2) demote `card.id` to a subtle secondary position — the sketch skill says IDs render in **Geist Mono, uppercase, letter-spaced, de-emphasized** (`SKILL.md` type direction) and chips are **title-forward** (`inline-references.md`) — keep `data-ref-id={card.id}` (line 80) so it stays recoverable; (3) translate/drop the status chip into plain English. Owner line (86) already degrades to `'unassigned'` (NO_UUID_LEAK ok).
- **Scope guard:** D-13 is text/label substitution within the existing card structure — NOT a redesign. Tailwind is inherited from host CSS (no new stylesheet); any new class is a local utility only.

### Area 9 — The existing SC5 cross-surface consistency guard (D-10/SC4) + how to extend it

- **The current guard:** `test/worker/blocked-no-edge-verdict-consistency.test.mjs` (Phase 12 SC5 fix for BEAAA-972). It runs the **Reader path** (`walkBlockerChain` → `buildHandlerResult`) AND the **Situation-Room path** (`buildEmployeesRollup`) against ONE synthetic root per matrix case and asserts they agree on `terminal.kind`. Today's `MATRIX` (lines 159-193) has **3 cases**: `blocked+agent-owned → AWAITING_AGENT_STUCK`, `blocked+human-owned → AWAITING_HUMAN`, `blocked+no-owner → UNOWNED`, plus a NOT-blocked regression (232-253) and a NO_UUID_LEAK assertion (259-285).
- **The determinism + AI-token guards (must stay green):** `test/shared/blocker-chain.test.mjs:287-309` (100-run `JSON.stringify` equality) and `:408-415` (grep guard banning `/openai|anthropic|claude_local|llm|gpt|completion/i` in the engine source).
- **D-10 extension — FULL surface × terminal-kind matrix (4 surfaces × 8 kinds):**
  1. **Add the 4th blocked-no-edge case** to `MATRIX`: `structured-human-wait → AWAITING_HUMAN` (a synthetic root with a `clarity_human_waits` row whose owner=founder; assert it WINS even when an agent assignee is present, the D-07 core assertion).
  2. **Widen surfaces from 2 to 4.** Today only Reader + SR are exercised. Add the **Bulletin** and **Chat** surfaces. These read the verdict via the same `BlockerChainResult` fields (`needsYou`/`tier`/`actionAffordance`/`awaitedPartyLabel`), so the matrix can assert the verdict object equality at the producer boundary rather than rendering each UI. Recommended encoding: a table-driven test `for (surface of [reader, sr, bulletin, chat]) for (kind of EIGHT_KINDS) assert sameVerdict`. The 8 kinds: `AWAITING_HUMAN, AWAITING_AGENT_WORKING, AWAITING_AGENT_STUCK, SELF_RESOLVING, UNOWNED, EXTERNAL, CYCLE, UNCLASSIFIED`.
  3. **Keep `blocker-chain.ts` pure** — the matrix test exercises the worker builders + engine, never adds I/O/AI to the engine. The grep guard + determinism test are unchanged and must still pass.
  4. **Phase 20 coordination:** D-10 says the planner decides CI placement and "coordinates with Phase 20's CI codification" (HYG-01 = "SC5 full-matrix coverage runs in CI"). Phase 17 SHIPS the matrix test; Phase 20 wires it into the CI gate. Keep the test self-contained (node:test, no external harness) so Phase 20 only adds a CI invocation, not a rewrite.

### Area 10 — Reusable superseded input (`_superseded-legibility-16-18-misscope`)

`16-CONTEXT.md` (A5) locked a **shared verdict-WORDING helper** consumed by BOTH Reader and SR — landed as `blockerLine()` at `live-blocker-panel.tsx:83-113` (HIGH confidence: it exists in current source with all 8 kinds, reading `data.awaitedPartyLabel`/`data.degradeReason`, never the raw `terminal.label`). **Reuse, don't rebuild:** the `"<owner> to decide: <one-liner>"` rendering for the structured wait reuses the `AWAITING_HUMAN` arm (`live-blocker-panel.tsx:86-87` returns `data.awaitedPartyLabel`) — so the one-liner just needs to be IN the scrubbed `awaitedPartyLabel`, which the engine label + `scrubHumanAction` already carry. **Stale/superseded (ignore):** the LEG-01 `agent#<hex>` fallback fix, the CHT-/run· chat-chip humanization, and the focusLine-from-tldr-cache work were that phase's scope (now folded into v1.4.2 + Phase 16/18) — NOT Phase 17. Only the "ONE shared wording helper, Reader+SR in lockstep" principle is load-bearing here.

---

## Files to Create

| File | Purpose |
|------|---------|
| `migrations/0018_structured_human_wait.sql` | Additive plugin-namespace `clarity_human_waits` table (Area 3). |
| `src/worker/db/clarity-human-wait-repo.ts` | Typed upsert/list/delete repo mirroring `action-cards-repo.ts` (Area 3). |
| `src/worker/agents/human-wait-detect.ts` (suggested) | The HIGH-PRECISION detection step (prompt build + op-issue delivery + `{isHumanWait, decisionOneLiner}` parse), mirroring `compile-tldr.ts` (Area 4). Keep detection logic out of `editor.ts` for testability. |
| `test/worker/structured-human-wait-verdict.test.mjs` (suggested) | Engine-level D-07/D-08 assertions (structured wait → AWAITING_HUMAN, wins over agent). |

## Files to Modify

| File | Change | Area |
|------|--------|------|
| `src/shared/blocker-chain.ts` | Add `structuredWaitOwnerUserId?`/`structuredWaitOneLiner?` to `nodeMeta` value type (25-39); add the structured-wait leaf branch at ~305 (before the `status==='awaiting'` branch). NO 9th kind, NO ranking/verdict-map change. | 1 |
| `src/worker/handlers/org-blocked-backlog.ts` | Add the two fields to `EdgeNodeMeta` (60-66); merge the prefetched wait into the ROOT issue's nodeMeta in `buildOrgBlockedBacklog`. | 2 |
| `src/worker/handlers/flatten-blocker-chain.ts` | Add the two fields to `WalkOutput.nodeMeta` (93-105); merge the wait into `nodeMeta[startId]` in `walkBlockerChain` root-meta block (354-360). | 2 |
| `src/worker/situation/build-employees-rollup.ts` | Merge the wait into the focus/root nodeMeta (441-451) before `flattenBlockerChain`. | 2 |
| `src/worker/handlers/situation-room.ts` | In the shared prefetch (~287-431), add one `SELECT … FROM clarity_human_waits WHERE company_id=$1` → `Map<issueId, waitRow>`, threaded into both builders' ctx (same pattern as `nameByUuid`/`edgeGraph`). | 2/3 |
| `src/worker/agents/editor.ts` | In `handleEditorHeartbeat` per-issue loop (259-352), call the detection step on the comments already fetched; upsert/delete the wait row (self-clear, D-04). | 4 |
| `src/worker/handlers/issue-reader.ts` | `deriveAncestry` (357-429): emit prefix-less canonical + `routable` flag; DROP the root mission goal segment (D-11); truncate long titles. | 7 |
| `src/ui/surfaces/reader/breadcrumb.tsx` | Conditional `<a>` (routable issue/parent, prefixed via `extractCompanyPrefixFromPathname`) vs `<span>` (plain text). | 7 |
| `src/ui/surfaces/reader/ref-card.tsx` | Title-first, demote `card.id` (keep `data-ref-id`), translate/drop `statusToPill` chip vocabulary. | 8 |
| `test/worker/blocked-no-edge-verdict-consistency.test.mjs` | Add the `structured-human-wait` matrix case + widen to 4 surfaces × 8 kinds (D-10). | 9 |
| `test/worker/handlers/flatten-blocker-chain-parity.test.mjs` | Update the nodeMeta same-shape assertion to include the two new fields. | 2 |

## Additive-Migration Recommendation

`migrations/0018_structured_human_wait.sql` — one `CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_human_waits (...)` with an inline `UNIQUE (company_id, issue_id)`, an apostrophe-free `COMMENT ON TABLE`, semicolon-terminated. NO `CREATE INDEX`, NO `UPDATE`, NO `public.*` reference. The upsert/delete (DML) lives in the repo via `ctx.db.execute`. This satisfies additive-only (coexistence #3) and clean-uninstall-preserves-data (#6) by construction.

---

## Common Pitfalls

### Pitfall 1: SC5 dual-path divergence (the BEAAA-972 bug class, again)
**What goes wrong:** The wait is merged into `nodeMeta` on the SR path but not the Reader path (or vice-versa) → the same issue reads `AWAITING_HUMAN` in the Situation Room and `AWAITING_AGENT_STUCK` in the Reader. **Why:** there are THREE root-meta write sites (`flatten-blocker-chain.ts:354`, `build-employees-rollup.ts:441`, and the SR backlog) and they are deliberately kept in lockstep manually. **Avoid:** merge via a single shared helper `applyStructuredWait(nodeMeta, startId, waitMap)` imported by all three; pin with the extended matrix test (Area 9). **Warning sign:** the parity test (`flatten-blocker-chain-parity.test.mjs`) or the matrix test fails for the `structured-human-wait` row only.

### Pitfall 2: AI token sneaks into the engine
**What goes wrong:** A planner adds a detection import or a comment containing `llm`/`gpt`/etc. to `blocker-chain.ts` → the grep guard (`test/shared/blocker-chain.test.mjs:410`) fails the build. **Avoid:** the engine change is PURE field reads. Detection lives entirely in the worker/`editor.ts` producer.

### Pitfall 3: False-positive human-wait (trust erosion, D-03)
**What goes wrong:** Low-precision detection fabricates a needs-you item → the centerpiece tier shows a fake action and the operator stops trusting it. **Avoid:** prompt returns `false` on ambiguity; only fire when a decision/question is clearly addressed to a specific person; default to the conservative Watch floor on a miss.

### Pitfall 4: Sticky waits (D-04 violation)
**What goes wrong:** The wait persists after the human replied / the issue unblocked → a stale needs-you row. **Avoid:** re-derive each compile; delete on negative detection or non-blocked status; add a staleness sweep so an un-revisited issue's wait expires (mirror `WARM_FRESHNESS_WINDOW_MS`).

### Pitfall 5: Migration validator rejection
**What goes wrong:** A standalone `CREATE INDEX`, an `UPDATE`, an apostrophe in a comment, or a `public.*` reference → the host plugin-database validator rejects `0018` at install and the plugin won't load. **Avoid:** copy the `0015` structure exactly (inline UNIQUE, DDL-only, apostrophe-free comment).

### Pitfall 6: Linking the wrong breadcrumb segment (D-12 dead link)
**What goes wrong:** Prefixing `/projects/` or `/goals/` to "fix" them → still 404 because those host routes are unconfirmed. **Avoid:** link ONLY the issue/parent segment; render project/goal as plain text (Area 7 table). Zero dead links is the D-12 success bar.

### Pitfall 7: Two-source version bump
**What goes wrong:** Bumping only `package.json` ships the new code under the old label (the host reads `dist/manifest.js` built from `src/manifest.ts`). **Avoid:** bump BOTH `package.json` AND the hardcoded literal in `src/manifest.ts` (memory `plugin-version-bump-two-sources`).

---

## Runtime State Inventory

> This phase is additive code + one new table, NOT a rename/migration. Most categories are N/A, but the structured-wait row IS new runtime state to seed/clear.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | NEW: `clarity_human_waits` rows (plugin namespace). No existing data renamed. | Migration `0018` creates the empty table; populated live by the Editor-Agent. None to backfill. |
| Live service config | None — no n8n/external service config involved. | None — verified by absence of any external-service write in the phase scope. |
| OS-registered state | None — no cron/Task Scheduler/pm2 changes. The detection rides the existing Editor heartbeat. | None. |
| Secrets/env vars | Optional: a tunable freshness/staleness window (e.g. `CLARITY_HUMAN_WAIT_TTL_MS`) mirroring `CLARITY_WARM_MAX_ROWS`. Code-read only; no secret. | None (env var optional, default-safe). |
| Build artifacts | The plugin bundle (`dist/`) rebuilds; version label in `package.json` + `src/manifest.ts` must both bump (Pitfall 7). | Rebuild + two-source version bump on deploy. |

---

## Environment Availability

> This phase is code/SQL only — no NEW external tool dependency. The deploy path (BEAAA local-tarball, bookended DO snapshot) is the established one.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Editor-Agent (managed agent) | structured-wait detection | ✓ (live on BEAAA) | v1.5.1 | If down → no rows written → conservative Watch floor (degrade-safe, D-03) |
| Plugin Postgres namespace | `clarity_human_waits` table | ✓ | host PG 17 | none needed (additive) |
| Op-issue LLM delivery layer | detection prompt | ✓ (TL;DR compile uses it) | — | timeout → no wait written |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none blocking — the only soft dependency (Editor-Agent) already degrades safely.

---

## Security Domain

> No `security_enforcement` key in `.planning/config.json` (treat as enabled), but this phase has **no auth/session/crypto surface** and installs **zero packages**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth code; the plugin trust model (same-origin trusted JS) is host-owned and out of scope (CLAUDE.md). |
| V3 Session Management | no | None. |
| V4 Access Control | yes (light) | The wait owner is resolved via `clarity_agent_owners` (the operator's own claim); no cross-company leak — every query is `WHERE company_id = $1` parameterized (multi-company discriminator, `0013`/`0015` discipline). |
| V5 Input Validation | yes | The detection LLM output is parsed defensively (`extractJsonObject` pattern); SQL is parameterized (`$N` binds, `text[]` via cast) — no string interpolation of issue/comment content into SQL. NO_UUID_LEAK scrub on the rendered label. |
| V6 Cryptography | no | None. |

### Known Threat Patterns for {worker SQL + plugin-namespace writes}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via comment/issue text | Tampering | Parameterized `ctx.db.execute`/`query` only; `text[]` via `toPgTextArrayLiteral` + `$N::text[]` cast (existing repo pattern). |
| Cross-company wait leak | Information disclosure | Every read/write `WHERE company_id = $1`; `UNIQUE(company_id, issue_id)` scopes rows per company. |
| Prose-injection fabricating a needs-you (prompt manipulation) | Spoofing | HIGH-PRECISION detection + degrade-safe floor (a fabricated wait is the D-03 false-positive risk, mitigated by precision tuning + the Editor's governance caps). |
| Raw UUID leak into rendered wait label | Information disclosure | `scrubHumanAction` on the label; the existing NO_UUID_LEAK render guard. |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Blocked issue conservatively parked in Watch | Structured wait → honest AWAITING_HUMAN (needs-you) | Phase 17 (this) | The BEAAA-972 deep fix. |
| Empty-edges blocked root → EXTERNAL "no active blockers" (Reader) vs UNOWNED (SR) — divergent | Both route through the engine via injected root meta | Phase 12 (12-08) | The SC5 dual-path fix Phase 17 extends to the 4th (structured) case. |
| `agent#<hex>` raw-hash labels | `scrubHumanAction` → human name / "an agent" | Phase 16 / v1.4.2 | Already shipped; the wait label inherits it. |

**Deprecated/outdated:** the superseded `_superseded-legibility-16-18-misscope` phase docs (16-18 mis-scope) — only the "one shared wording helper" principle (now `blockerLine`) is still load-bearing (Area 10).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The founder is recoverable as the `clarity_agent_owners.owner_user_id` for the company. If NO agent ownership has been claimed, there is no row → no wait written. | Area 6 / D-06 | On a fresh company with zero claimed ownership, structured waits won't fire until an owner is claimed. Mitigation: degrade-safe floor; document the prerequisite. `[ASSUMED]` — verify on BEAAA that Eric's ownership is claimed (it is, per Phase 6.1 ROOM-09). |
| A2 | `/<companyPrefix>/projects/<id>` and `/<companyPrefix>/goals/<id>` are NOT routable host pages. Based on zero codebase usage + SPEC.md silence (absence of evidence). | Area 7 / D-12 | If those routes DO exist, we render plain text where a link was possible (a missed enhancement, NOT a dead link) — strictly safe per D-12's "plain text otherwise". `[ASSUMED]` — could confirm live by visiting `/<prefix>/goals/<id>` on BEAAA, but D-12's own rule makes plain-text the safe default regardless. |
| A3 | One live structured wait per (company, issue) is sufficient (UNIQUE key). | Area 3 | If an issue could need multiple distinct human decisions simultaneously, the model collapses them. For the single-operator v1.5.0 lock this is fine; revisit if multi-decision issues appear. `[ASSUMED]` |
| A4 | Detection runs in the Editor heartbeat per-issue loop without a new wake path (rides existing governance). | Area 4 | If detection needs its own schedule, the no-storm guarantee must be re-verified. `[ASSUMED]` — the heartbeat already iterates every relevant issue, so no new wake is needed. |

---

## Open Questions (RESOLVED)

1. **Primary-human tie-break when multiple owners exist for a company.**
   - What we know: `clarity_agent_owners` can hold multiple `(agent_id, owner_user_id)` rows per company.
   - What's unclear: which `owner_user_id` is "the founder" if two distinct humans claimed agents.
   - Recommendation: for v1.5.0 single-operator, pick the distinct owner (there is one); if >1, take the earliest `set_at` or the most-frequent. Planner decides; document the rule. Low risk on BEAAA (solo).
   - **RESOLVED (plan 17-01/T3):** deterministic solo-operator default — take the single owner; if >1 distinct `owner_user_id`, pick earliest `set_at` (else lexicographically smallest), documented in a code comment in `founder-resolution.ts`.

2. **Staleness sweep cadence for D-04 self-clear.**
   - What we know: re-derive each compile clears a wait when the Editor revisits the issue.
   - What's unclear: an issue the Editor never revisits (no new comments) could strand a wait.
   - Recommendation: add a TTL on read (treat a wait older than N minutes as expired) OR a per-company sweep in the prefetch. Mirror `WARM_FRESHNESS_WINDOW_MS`.
   - **RESOLVED (plan 17-03/T1):** detection rides the existing heartbeat with a `content_hash` cache-hit short-circuit (mirrors `prepareTldrCompile`); self-clear on negative/non-blocked re-derive; the un-revisited-issue sweep follows the `WARM_FRESHNESS_WINDOW_MS` pattern already in `editor.ts:427`.

3. **SC5 matrix encoding for the Bulletin + Chat surfaces.**
   - What we know: Reader + SR are exercised today via their worker builders; Bulletin/Chat read the same verdict object.
   - What's unclear: whether to assert at the verdict-object boundary (cheap, recommended) or render each UI.
   - Recommendation: assert `BlockerChainResult` equality at the producer boundary for all 4 surfaces (they all consume the same engine output) — render-level tests are heavier and Phase-20-territory.
   - **RESOLVED (plan 17-05/T2):** assert verdict-object equality at the PRODUCER boundary for all 4 surfaces; render-level coverage deferred to Phase 20's CI codification (matches D-10).

---

## Project Constraints (from CLAUDE.md)

- **Additive-only plugin-namespace migrations**; plugin disable leaves data intact; `--purge` opt-in (coexistence #3/#6). → `0018` is `CREATE TABLE IF NOT EXISTS` only.
- **`blocker-chain.ts` stays PURE** — determinism + AI-token grep guards must pass (SC4). → engine change is pure field reads.
- **No AI in the deterministic floor**; degrade-safe (no AI dependency). → Editor down ⇒ conservative Watch floor.
- **Instance-agnostic** — no company-prefix or name literals. → founder via `clarity_agent_owners`; URL prefix via `extractCompanyPrefixFromPathname`.
- **Editor-Agent governance parity** — caps, pause/terminate, no-storm (Phase 16.1). → detection rides the existing heartbeat/wake-governor/opt-in gate.
- **Two-source version bump** — `package.json` AND `src/manifest.ts`.
- **Tailwind inherited from host** — no second stylesheet; ref-card changes are text/label + local utility classes only.
- **Bookended-by-snapshots** — the BEAAA install/upgrade is bookended by a verified DO snapshot (the established deploy mechanic).
- **MemPalace** — query `clarity_pack` before asserting past events; file new drawers at end of substantive work.

---

## Sources

### Primary (HIGH confidence)
- `src/shared/blocker-chain.ts` (lines 25-39, 60-93, 274-360, 398-425) — engine contract, leaf cascade, verdict map, ranking.
- `src/shared/types.ts` (43-51) — the 8-kind `Terminal` union + `BlockerChainResult`.
- `src/worker/handlers/org-blocked-backlog.ts` (60-66 EdgeNodeMeta, 293-378 buildEdges) — SR nodeMeta build.
- `src/worker/handlers/flatten-blocker-chain.ts` (93-105 WalkOutput, 302-445 walkBlockerChain, 311-365 root-meta BEAAA-972 fix) — Reader nodeMeta build.
- `src/worker/situation/build-employees-rollup.ts` (370-378 polishTldr usage, 441-451 root-meta inject) — SR rollup + D-05 voice.
- `src/worker/agents/editor.ts` (246-397 heartbeat producer, 305-329 op-issue handoff, 495-553 bounded warm + wake-governor) — populator path + governance.
- `src/worker/agents/compile-tldr.ts` (370-378 `polishTldr`) — the voice helper.
- `src/worker/db/clarity-agent-owners-repo.ts` (84-94) + `src/worker/opted-in-company-set.ts` (110-115) — founder resolution (D-06).
- `src/worker/db/action-cards-repo.ts` + `migrations/0015_action_cards.sql` + `migrations/0013_clarity_agent_owners.sql` — additive table/repo pattern + validator constraints.
- `src/worker/handlers/issue-reader.ts` (357-429 deriveAncestry) — prefix-less URLs + mission-dump source.
- `src/ui/surfaces/reader/breadcrumb.tsx`, `ref-card.tsx` (29-104), `index.tsx` (53,251-252,351-358) — Reader render + companyPrefix source.
- `src/ui/surfaces/reader/live-blocker-panel.tsx` (76-113) — `blockerLine` shared wording helper (Area 10).
- `test/worker/blocked-no-edge-verdict-consistency.test.mjs` — the SC5 guard to extend.
- `test/shared/blocker-chain.test.mjs` (287-309 determinism, 408-415 AI-token grep) — purity guards.
- 30+ codebase call sites confirming `/<companyPrefix>/issues/<identifier>` (ref-chip, employee-row, reply-in-place, live-blocker-panel).
- `.claude/skills/sketch-findings-clarity-pack/SKILL.md` — title-forward chips, Geist Mono for IDs (D-13 direction).

### Secondary (MEDIUM confidence)
- `[CITED: github.com/paperclipai/paperclip/blob/master/doc/SPEC.md]` — "Project/Initiative Views" feature exists but defines no URL route (D-12 absence-of-evidence for project/goal routes).
- Memories: `reader-breadcrumb-legibility-bug`, `paperclip-issue-url-pattern`, `plugin-version-bump-two-sources`, `v150-scope-locked`, `phase-16.1-loop07-gap`.

### Tertiary (LOW confidence)
- None — every load-bearing claim is anchored to source or an explicit memory/citation.

---

## Metadata

**Confidence breakdown:**
- Engine integration (Area 1/2): HIGH — exact lines quoted; the change is one branch + two optional fields; D-08 satisfied by reusing AWAITING_HUMAN.
- Persistence/repo (Area 3): HIGH — mirrors two existing tables; validator constraints quoted from migration headers.
- Editor populator (Area 4): HIGH on the hook point + governance (existing heartbeat); MEDIUM on the exact detection prompt (Claude's discretion, D-03).
- Founder resolution (Area 6): HIGH — the `clarity_agent_owners` mapping is the existing opt-in mechanism.
- Host routes (Area 7/D-12): HIGH for issues (30+ live sites + memory); MEDIUM-by-absence for projects/goals → plain-text default is safe per D-12.
- Ref-card/breadcrumb (Area 8): HIGH — current render structure quoted.
- SC5 matrix (Area 9): HIGH — the seed test exists; extension is mechanical.

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable internal codebase; re-verify only if the SDK version or migration count changes).

## RESEARCH COMPLETE
