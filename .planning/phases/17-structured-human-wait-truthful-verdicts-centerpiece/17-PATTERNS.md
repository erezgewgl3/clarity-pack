# Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE) - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 14 (4 create + 10 modify)
**Analogs found:** 14 / 14 (every file has a live in-repo analog — this phase is composition, not invention)

> **READ FIRST — SC5 parity trap.** Three root-meta write sites (`flatten-blocker-chain.ts`, `build-employees-rollup.ts`, `org-blocked-backlog.ts`) must merge the structured-wait row into `nodeMeta` **identically**. Merge via ONE shared helper `applyStructuredWait(nodeMeta, startId, waitMap)`. A wait merged on one path but not the others reproduces the exact BEAAA-972 cross-surface divergence SC5 exists to kill. Pin it with the extended matrix test. See the trap callout at the end.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `migrations/0018_structured_human_wait.sql` (NEW) | migration | CRUD | `migrations/0015_action_cards.sql` | exact |
| `src/worker/db/clarity-human-wait-repo.ts` (NEW) | repo (db) | CRUD | `src/worker/db/action-cards-repo.ts` | exact |
| `src/worker/agents/human-wait-detect.ts` (NEW, suggested) | service (AI producer) | transform/request-response | `src/worker/agents/compile-tldr.ts` (`polishTldr` + structured-JSON extraction) | role-match |
| `test/worker/structured-human-wait-verdict.test.mjs` (NEW, suggested) | test | event-driven (pure) | `test/worker/blocked-no-edge-verdict-consistency.test.mjs` | role-match |
| `src/shared/blocker-chain.ts` (MOD) | engine (pure) | transform | (self — extends own cascade @305) | exact |
| `src/worker/handlers/org-blocked-backlog.ts` (MOD) | handler | CRUD/transform | (self — `EdgeNodeMeta` @60) | exact |
| `src/worker/handlers/flatten-blocker-chain.ts` (MOD) | handler | CRUD/transform | (self — `WalkOutput.nodeMeta` @93) | exact |
| `src/worker/situation/build-employees-rollup.ts` (MOD) | service (rollup) | CRUD/transform | (self — root-meta inject @441) | exact |
| `src/worker/handlers/situation-room.ts` (MOD) | handler (prefetch) | CRUD | self prefetch (`nameByUuid`/`edgeGraph` Map pattern) | exact |
| `src/worker/agents/editor.ts` (MOD) | service (agent producer) | event-driven | self heartbeat loop @259 (TL;DR sibling step) | exact |
| `src/worker/handlers/issue-reader.ts` (MOD) | handler | request-response | self `deriveAncestry` @357 | exact |
| `src/ui/surfaces/reader/breadcrumb.tsx` (MOD) | component | request-response | self render @33 | exact |
| `src/ui/surfaces/reader/ref-card.tsx` (MOD) | component | request-response | self render @79 | exact |
| `test/worker/blocked-no-edge-verdict-consistency.test.mjs` (MOD) | test | event-driven (pure) | self `MATRIX` @159 | exact |
| `test/worker/handlers/flatten-blocker-chain-parity.test.mjs` (MOD) | test | event-driven (pure) | self same-shape assertion | exact |

---

## Pattern Assignments

### `migrations/0018_structured_human_wait.sql` (migration, CRUD)

**Analog:** `migrations/0015_action_cards.sql` (verified read; lines 48-66)

**Why this analog:** `0015` is the most recent additive plugin-namespace cache table built for the exact same producer/consumer model (Editor-Agent writes, engine/UI reads). It encodes ALL the host-validator constraints this phase must obey: DDL-only, fully-qualified namespace literal, inline `UNIQUE` (NOT standalone `CREATE INDEX`), apostrophe-free `COMMENT ON`, `text[]` columns for `source_revisions`.

**Header validator-constraints block to mirror** (`0015` lines 10-26) — copy this discipline verbatim:
```sql
-- Validator legality mirrors 0002 + 0014:
--   - Every DDL statement targets the deterministic plugin namespace literally
--     (plugin_clarity_pack_cdd6bda4bd) -- host validator requires fully qualified
--     schema names with NO template substitution.
--   - CREATE TABLE IF NOT EXISTS for idempotent re-install.
--   - The idempotency / index key is an INLINE UNIQUE (...) inside CREATE TABLE.
--     A standalone create-index statement is NOT recognized by extractQualifiedRefs.
--   - create / alter / comment statements ONLY -- no procedural blocks, no UPDATE.
--   - COMMENT ON body text is apostrophe-free (greedy string-literal strip hazard).
```

**Table-shape pattern** (`0015` lines 48-66 → adapt):
```sql
CREATE TABLE IF NOT EXISTS plugin_clarity_pack_cdd6bda4bd.clarity_human_waits (
  id                   bigserial PRIMARY KEY,
  company_id           text NOT NULL,
  issue_id             text NOT NULL,           -- the blocked (root) issue the wait grounds in
  owner_user_id        text NOT NULL,           -- the founder (D-06), resolved generically
  decision_one_liner   text NOT NULL,           -- polishTldr-voiced "what" (D-05)
  content_hash         text NOT NULL,           -- SWR idempotency (re-derive each compile, D-04)
  generated_at         timestamptz NOT NULL DEFAULT now(),
  compiled_by_agent_id text NOT NULL,           -- governance parity audit field
  source_revisions     text[] NOT NULL DEFAULT '{}',
  UNIQUE (company_id, issue_id)                  -- one live wait per issue per company; ON CONFLICT upsert
);

COMMENT ON TABLE plugin_clarity_pack_cdd6bda4bd.clarity_human_waits IS
  'Editor-Agent structured human-wait cache (WAIT-01). One live row per issue per company. UNIQUE(company_id, issue_id) = upsert idempotency key. Additive plugin-namespace table -- plugin disable leaves data intact. issue_id is key/dispatch only.';
```

**Divergence note:** `0015` uses a 3-col idempotency key `(company_id, source_issue_id, content_hash)` with `ON CONFLICT DO NOTHING` (append-on-change). This phase wants ONE LIVE row per issue (D-04 self-clear), so the key is `(company_id, issue_id)` with `ON CONFLICT DO UPDATE` (upsert-in-place). Drop the `CHECK (... IN (...))` enum columns and `decision_options jsonb` — not needed here. Keep `source_revisions text[]` (binds via `$N::text[]`). Latest migration on disk is `0017_loop_governor.sql`; `0012` is intentionally skipped — next number is `0018`.

---

### `src/worker/db/clarity-human-wait-repo.ts` (repo, CRUD)

**Analog:** `src/worker/db/action-cards-repo.ts` (verified read; full file) + `clarity-agent-owners-repo.ts` for the upsert+readback / list-for-company shapes.

**Why this analog:** `action-cards-repo.ts` is the 1:1 structural template for a plugin-namespace cache repo — same `{ db: PluginDatabaseClient }` ctx, same `ctx.db.execute` (DML) / `ctx.db.query` (SELECT-only) split, same `toPgTextArrayLiteral` + `$N::text[]` binding fix. `clarity-agent-owners-repo.ts` shows the `ON CONFLICT DO UPDATE` upsert (D-04 wants update-in-place, NOT `DO NOTHING`) and the `list…ForCompany` SELECT.

**Imports + ctx + row-type pattern** (`action-cards-repo.ts` lines 21-49):
```ts
import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';
import { toPgTextArrayLiteral } from './tldr-cache.ts';   // REUSE verbatim, never re-implement

export type ClarityHumanWaitRow = {
  company_id: string;
  issue_id: string;
  owner_user_id: string;
  decision_one_liner: string;
  content_hash: string;
  generated_at: string;       // ISO
  compiled_by_agent_id: string;
  source_revisions: string[];
};
export type ClarityHumanWaitRepoCtx = { db: PluginDatabaseClient };
```

**Upsert pattern — use `ON CONFLICT DO UPDATE`** (combine `action-cards-repo.ts` lines 65-84 binding with `clarity-agent-owners-repo.ts` lines 56-65 update-set):
```ts
export async function upsertClarityHumanWait(
  ctx: ClarityHumanWaitRepoCtx, row: ClarityHumanWaitRow,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
       (company_id, issue_id, owner_user_id, decision_one_liner, content_hash, generated_at, compiled_by_agent_id, source_revisions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
     ON CONFLICT (company_id, issue_id) DO UPDATE SET
       owner_user_id        = EXCLUDED.owner_user_id,
       decision_one_liner   = EXCLUDED.decision_one_liner,
       content_hash         = EXCLUDED.content_hash,
       generated_at         = EXCLUDED.generated_at,
       compiled_by_agent_id = EXCLUDED.compiled_by_agent_id,
       source_revisions     = EXCLUDED.source_revisions`,
    [row.company_id, row.issue_id, row.owner_user_id, row.decision_one_liner,
     row.content_hash, row.generated_at, row.compiled_by_agent_id,
     toPgTextArrayLiteral(row.source_revisions)],
  );
}
```

**List-for-company pattern** (the prefetch consumer; `clarity-agent-owners-repo.ts` lines 84-94):
```ts
export async function listClarityHumanWaitsForCompany(
  ctx: ClarityHumanWaitRepoCtx, companyId: string,
): Promise<ClarityHumanWaitRow[]> {
  return ctx.db.query<ClarityHumanWaitRow>(
    `SELECT company_id, issue_id, owner_user_id, decision_one_liner, content_hash, generated_at, compiled_by_agent_id, source_revisions
     FROM plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
     WHERE company_id = $1`,
    [companyId],
  );
}
```

**Self-clear delete (D-04)** — DML in the repo, NEVER in the migration:
```ts
export async function deleteClarityHumanWait(
  ctx: ClarityHumanWaitRepoCtx, companyId: string, issueId: string,
): Promise<void> {
  await ctx.db.execute(
    `DELETE FROM plugin_clarity_pack_cdd6bda4bd.clarity_human_waits
     WHERE company_id = $1 AND issue_id = $2`,
    [companyId, issueId],
  );
}
```

**Divergence note:** `action-cards-repo.ts` reads "most-recent per source" (`ORDER BY generated_at DESC LIMIT 1`). This repo reads ALL live waits for the company in one shot (one row per issue by construction of the UNIQUE key) → a `Map<issue_id, row>` in the prefetch. Bind `source_revisions` via `toPgTextArrayLiteral` + `$N::text[]` (v0.6.5 Bug 2 — the host bridge does NOT pass JS arrays natively).

---

### `src/worker/db/...` founder resolution (the "who", D-06)

**Analog / REUSE — do not build a new query:** `listClarityAgentOwnersForCompany(ctx, companyId)` (`clarity-agent-owners-repo.ts` lines 84-94, verified read) already returns `{ agent_id, owner_user_id }[]` for a company.

**Pattern:** take the distinct `owner_user_id` (solo-operator v1.5.0 lock → there is one). If >1, tie-break by earliest `set_at` (Open Question 1). **Fallback:** no owner row → skip writing the wait (degrade-safe; issue falls to the conservative floor). **No company-prefix or name literal.** Do NOT use the bulletin's `prepareForName` (it returns the company NAME, not a user id — `compile-pass-1.ts:249-272`).

---

### `src/shared/blocker-chain.ts` (engine, pure — ONE branch + two optional fields)

**Analog:** the engine's OWN existing cascade (verified read; lines 25-39 nodeMeta type, 60-93 classifyVerdict, 305-360 leaf cascade). The new branch is a structural sibling of the existing `status==='awaiting' && ownerUserId` branch at 308-315.

**nodeMeta type edit — add two OPTIONAL fields** (`blocker-chain.ts` lines 25-39; optional keeps every pre-17 caller type-clean exactly as `assigneeAgentId?`/`agentState?` did):
```ts
nodeMeta: Record<string, {
  ownerUserId: string | null;
  etaIso: string | null;
  status: string;
  assigneeAgentId?: string | null;
  agentState?: 'working' | 'stuck' | null;
  // ADD (D-07): founder user id when a structured human-wait exists for this node.
  structuredWaitOwnerUserId?: string | null;
  // ADD (D-05): the polished decision one-liner for the AWAITING_HUMAN label.
  structuredWaitOneLiner?: string | null;
}>;
```

**The leaf-cascade branch — INSERT at ~line 305**, immediately AFTER the two EXTERNAL guards (lines 284-303) and BEFORE the `status==='awaiting'` branch (line 308), so it wins over both `status==='awaiting'` AND `assigneeAgentId` (D-07). Mirror the exact shape of the existing 308-315 branch:
```ts
// D-07: a structured human-wait beats agent ownership AND status==='awaiting'.
// The Editor-Agent named the actual decision; that is the truthful needs-you.
if (meta?.structuredWaitOwnerUserId != null) {
  const terminal: Terminal = {
    kind: 'AWAITING_HUMAN',                       // D-08: REUSE, no 9th kind
    userId: meta.structuredWaitOwnerUserId,
    label: meta.structuredWaitOneLiner
      ? `${meta.structuredWaitOwnerUserId} to decide: ${meta.structuredWaitOneLiner}`
      : `${meta.structuredWaitOwnerUserId} to act on ${current}`,
  };
  return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
}
```

**Why this is the ENTIRE engine change:** `classifyVerdict` (lines 66-67, verified) already maps `AWAITING_HUMAN → { tier:'needs-you', actionAffordance:'reply', needsYou:true }`. `pickTopChains` already ranks `AWAITING_HUMAN = 0`. **No verdict-map change, no ranking change, no `Terminal` union change** (D-08 satisfied by construction).

**Purity guard — MUST stay green:** the new branch is pure field reads → deterministic terminal. The 100-run `JSON.stringify` determinism test and the AI-token grep guard (`test/shared/blocker-chain.test.mjs:408-415` banning `/openai|anthropic|claude_local|llm|gpt|completion/i`) stay green ONLY if NO AI token/import enters this file. Detection lives entirely in the worker.

---

### `src/worker/handlers/flatten-blocker-chain.ts` (handler — Reader path nodeMeta)

**Analog:** OWN `WalkOutput.nodeMeta` type (verified read; lines 93-105) + root-meta write block (lines 354-360, the BEAAA-972 empty-edges fix).

**Type edit — add the two fields to the inline duplicate** (lines 93-105):
```ts
nodeMeta: Record<string, {
  ownerUserId: string | null;
  etaIso: string | null;
  status: string;
  assigneeAgentId: string | null;
  agentState: 'working' | 'stuck' | null;
  structuredWaitOwnerUserId: string | null;   // ADD — keep field set in lockstep with EdgeNodeMeta (SC5)
  structuredWaitOneLiner: string | null;       // ADD
}>;
```

**Root-meta merge** (after the existing `nodeMeta[startId] = {...}` block at lines 354-360) — call the shared helper, do NOT inline-duplicate the merge:
```ts
nodeMeta[startId] = { ownerUserId: ..., etaIso: ..., status: rootStatus,
                      assigneeAgentId, agentState,
                      structuredWaitOwnerUserId: null, structuredWaitOneLiner: null };
applyStructuredWait(nodeMeta, startId, waitMap);   // SC5 — IDENTICAL on all three sites
```

---

### `src/worker/situation/build-employees-rollup.ts` (service — SR rollup root nodeMeta)

**Analog:** OWN root-meta inject (verified read; lines 441-451). Mirror the field set + the same `applyStructuredWait` call:
```ts
nodeMeta[focusIssue.id] = { ownerUserId: ..., etaIso: ..., status: rootStatus,
                            assigneeAgentId: rootAssigneeAgentId, agentState: rootAgentState,
                            structuredWaitOwnerUserId: null, structuredWaitOneLiner: null };
applyStructuredWait(nodeMeta, focusIssue.id, waitMap);   // SC5 — IDENTICAL
```
This file also owns `polishTldr` voice usage (lines 384-385: `polishTldr(rawFocus)` then truncate ≤80 chars) — the SAME treatment the detection one-liner must get before it is persisted (D-05 voice parity).

---

### `src/worker/handlers/org-blocked-backlog.ts` (handler — SR backlog `EdgeNodeMeta`)

**Analog:** OWN `EdgeNodeMeta` type (verified read; lines 60-66). Add the two fields so the type stays in lockstep with the Reader mirror (the comment at line 58 explicitly states "flatten-blocker-chain.ts mirrors this exact field set (SC5)"):
```ts
type EdgeNodeMeta = {
  ownerUserId: string | null; etaIso: string | null; status: string;
  assigneeAgentId: string | null; agentState: 'working' | 'stuck' | null;
  structuredWaitOwnerUserId: string | null;   // ADD (SC5)
  structuredWaitOneLiner: string | null;        // ADD
};
```
Merge the prefetched wait into the ROOT issue's meta via the same `applyStructuredWait` helper.

---

### `src/worker/handlers/situation-room.ts` (handler — shared prefetch)

**Analog:** OWN prefetch `Map`-build pattern (`nameByUuid` / `edgeGraph` are built once per company and threaded into both builders' ctx). Add one SELECT and one Map, threaded identically:
```ts
const waitRows = await listClarityHumanWaitsForCompany(ctx, companyId);
const waitMap = new Map(waitRows.map((w) => [w.issue_id, w]));   // Map<issueId, ClarityHumanWaitRow>
// thread waitMap into BOTH builders' ctx alongside nameByUuid/edgeGraph
```
One query per company per snapshot. Both builders read the SAME `waitMap` — that is what guarantees SC5 parity.

---

### `src/worker/agents/editor.ts` + `src/worker/agents/human-wait-detect.ts` (NEW) (agent producer)

**Analog:** the OWN heartbeat per-issue TL;DR loop (verified read; `editor.ts` lines 259-330) + `compile-tldr.ts` `polishTldr` (lines 370-378).

**Where it hooks in:** the detection is a SIBLING step inside the SAME per-issue loop — it reads the SAME `comments` already fetched at line 278, runs HIGH-PRECISION detection through the SAME op-issue delivery layer, then upserts/deletes the wait row. The existing loop structure to mirror:
```ts
for (const issueId of issueIds) {
  const issue = await ctx.issues.get(issueId, payload.companyId);
  if (isOwnOperationIssue(issue)) continue;                 // recursion guard — REUSE
  const comments = await ctx.issues.listComments(issueId, payload.companyId);
  // ── EXISTING: TL;DR compile (prepareTldrCompile → startAgentTask → pollAgentTaskResult → finalizeTldr)
  // ── NEW SIBLING STEP (human-wait-detect.ts): same comments, HIGH-PRECISION detect,
  //    on positive → upsertClarityHumanWait; on negative OR not-blocked → deleteClarityHumanWait (D-04 self-clear)
}
```

**Op-issue handoff pattern to reuse** (`editor.ts` lines 305-329) — add a NEW operation kind `human-wait-detect` in the same `plugin:clarity-pack:operation:` namespace so the `isOwnOperationIssue` guard (line 270) auto-excludes it:
```ts
const started = await startAgentTask(ctx, {
  agentId, companyId, operationKind: 'human-wait-detect',
  operationId: `human-wait-${issueId}`, title: `Detect human-wait — ${issueId}`, prompt,
});
const poll = await pollAgentTaskResult(ctx, { operationIssueId: started.operationIssueId, companyId, operationKind: 'human-wait-detect', agentId });
```

**Detection-output parse + voice** (`compile-tldr.ts:370-378` + `extractJsonObject` pattern, `compile-pass-1.ts:297`): prompt returns `{ isHumanWait: boolean, decisionOneLiner: string | null }`; default `false` on ambiguity (D-03 high-precision). Pass the one-liner through `polishTldr(input)` then truncate ≤80 chars BEFORE persisting, so the stored `decision_one_liner` is voice-parity by construction.

**Governance — RIDE the existing heartbeat, add NO new wake path:** the loop already runs under `checkAndRecordWake` (wake-governor), the opt-in scope gate (`ensureSeeded`/`isCompanyOptedIn`), and `filterSelfLoopEvents` (Phase 16.1, live-verified). Detection inherits all of it. Editor down → no rows written → conservative Watch floor (degrade-safe, D-03).

**Divergence note:** keep detection logic in a NEW `human-wait-detect.ts` (prompt-build + delivery + parse), NOT inline in `editor.ts`, for testability — mirrors how `compile-tldr.ts` is separate from the heartbeat dispatcher.

---

### `src/worker/handlers/issue-reader.ts` (handler — `deriveAncestry`, D-11/D-12)

**Analog:** OWN `deriveAncestry` (verified read; lines 357-429). Three prefix-less URLs that 404 today and the mission-dump:
- parent: `url: \`/issues/${parentKey}\`` (line 376) — **the only routable segment**
- project: `url: \`/projects/${p.id}\`` (line 394) — **no confirmed host route → plain text**
- goal/milestone: `url: \`/goals/${g.id}\`` (line 414) + `title: g.title` (the 1k+ char mission) — **DROP the root mission goal (D-11); any non-root goal → plain text**

**Changes:** (1) emit a prefix-less canonical issue path + a `routable: boolean` flag per segment (recommend Option (b): worker stays instance-agnostic, UI prepends `/<companyPrefix>/`); set `routable: true` ONLY for the issue/parent segment, `false` for project/goal. (2) Drop the root mission goal segment entirely. (3) Truncate any other long title to a short label. Add `routable` (or `url: string | null`) to `AncestrySegment`.

**Host-route confirmation (D-12 research item, RESOLVED):** issue route `/<companyPrefix>/issues/<identifier>` is HIGH-confidence (30+ live call sites + memory `paperclip-issue-url-pattern`, and use the issue *identifier* not UUID). Project + goal routes are unconfirmed (zero codebase usage, SPEC.md silent) → plain text. Zero dead links is the D-12 bar.

---

### `src/ui/surfaces/reader/breadcrumb.tsx` (component — conditional link, D-12)

**Analog:** OWN render (verified read; lines 30-46). Today EVERY segment is wrapped in `<a {...nav.linkProps(s.url)}>` (lines 37-41) — that is the 404. Add the `routable` flag to `AncestrySegment` (line 12) and branch:
```tsx
export type AncestrySegment = { id: string; title: string; url: string | null; routable: boolean };
// ...
{segments.map((s, i) => (
  <React.Fragment key={s.id}>
    {s.routable && s.url
      ? <a {...nav.linkProps(`/${companyPrefix}/issues/${s.url}`)} className="clarity-breadcrumb-segment">{s.title}</a>
      : <span className="clarity-breadcrumb-segment clarity-breadcrumb-segment--plain">{s.title}</span>}
    {i < segments.length - 1 ? <span className="clarity-breadcrumb-sep">·</span> : null}
  </React.Fragment>
))}
```
`companyPrefix` via `extractCompanyPrefixFromPathname(useHostLocation().pathname)` — already imported/used in `reader/index.tsx` and `ref-card.tsx:27,47-48`. Keep `useHostNavigation().linkProps` (SCAF-09 — no raw `<a href>`).

---

### `src/ui/surfaces/reader/ref-card.tsx` (component — de-code, D-13)

**Analog:** OWN `RefCard` render (verified read; lines 79-104) + `statusToPill` (lines 29-42). Today: `card.id` (BEAAA-NNN) renders FIRST (line 82), then title, then a `StatePill` showing `Stuck`/`Standby` (line 84).

**Changes (UI-only, within visual contract — NOT a redesign):**
1. Lead with `card.title` (move `<strong>` first); demote `card.id` to a subtle secondary position. KEEP `data-ref-id={card.id}` (line 80) so the identifier stays recoverable. Sketch skill direction: IDs in Geist Mono, uppercase, letter-spaced, de-emphasized; chips title-forward.
2. Translate/drop the status chip vocabulary in `statusToPill` (lines 29-42): `blocked → "needs attention"`, `in_progress → "in progress"`, `done → "done"` — out of the code-chip `Stuck`/`Standby` vocabulary.
3. Owner line (86) already degrades to `'unassigned'` (NO_UUID_LEAK ok) — leave it.

Tailwind inherited from host; any new class is a local utility only. No new stylesheet.

---

### `test/worker/blocked-no-edge-verdict-consistency.test.mjs` (test — SC5 full matrix, D-10)

**Analog:** OWN `MATRIX` (verified read; lines 159-193) — today 3 cases (`agent-owned→AWAITING_AGENT_STUCK`, `human-owned→AWAITING_HUMAN`, `no-owner→UNOWNED`) run across Reader + SR paths asserting `terminal.kind` agreement.

**Extension (D-10):**
1. Add the 4th case `structured-human-wait → AWAITING_HUMAN` — a synthetic root WITH a structured wait AND an agent assignee; assert the wait WINS (the D-07 core assertion).
2. Widen from 2 surfaces (Reader + SR) to 4 (+ Bulletin + Chat). All four consume the same `BlockerChainResult` fields — assert verdict-object equality at the producer boundary (cheap; render-level is Phase-20 territory).
3. Loop encoding: `for (surface of [reader, sr, bulletin, chat]) for (kind of EIGHT_KINDS) assert sameVerdict`. The 8 kinds: `AWAITING_HUMAN, AWAITING_AGENT_WORKING, AWAITING_AGENT_STUCK, SELF_RESOLVING, UNOWNED, EXTERNAL, CYCLE, UNCLASSIFIED`.
4. Keep self-contained (`node:test`, no external harness) — Phase 20 only adds a CI invocation.

**Existing case shape to mirror** (`MATRIX` entry, lines 166-178):
```js
{ name: 'blocked + human-owned',
  root: () => ({ id: ROOT_UUID, identifier: 'BEAAA-973', title: 'Approve the budget',
                 status: 'blocked', assigneeAgentId: null, assigneeUserId: HUMAN_UUID,
                 ownerUserId: HUMAN_UUID, lastActivityAt: ... }),
  expectKind: 'AWAITING_HUMAN' },
```

---

### `test/worker/handlers/flatten-blocker-chain-parity.test.mjs` (test — same-shape pin)

**Analog:** OWN same-shape assertion. Update it to include `structuredWaitOwnerUserId` + `structuredWaitOneLiner` so the parity test still pins `EdgeNodeMeta` ≡ `WalkOutput.nodeMeta` after both gain the two fields.

---

## Shared Patterns

### `applyStructuredWait` helper (the SC5 anti-divergence primitive)
**Source:** NEW (the single largest risk-reduction in the phase). Imported by all THREE root-meta write sites.
**Apply to:** `flatten-blocker-chain.ts:354`, `build-employees-rollup.ts:441`, `org-blocked-backlog.ts` root meta.
```ts
// pure: reads the prefetched waitMap, mutates the node's two fields in place
export function applyStructuredWait(
  nodeMeta: Record<string, { structuredWaitOwnerUserId: string | null; structuredWaitOneLiner: string | null }>,
  startId: string,
  waitMap: Map<string, { owner_user_id: string; decision_one_liner: string }>,
): void {
  const w = waitMap.get(startId);
  if (!w) return;
  nodeMeta[startId].structuredWaitOwnerUserId = w.owner_user_id;
  nodeMeta[startId].structuredWaitOneLiner = w.decision_one_liner;
}
```

### Plugin-namespace DB access (`ctx.db`)
**Source:** `action-cards-repo.ts`, `clarity-agent-owners-repo.ts`
**Apply to:** the new repo. `ctx.db.query` = SELECT-only; `ctx.db.execute` = DML (INSERT/UPDATE/DELETE), returns only `{ rowCount }` (no RETURNING). `text[]` via `toPgTextArrayLiteral` + `$N::text[]`. Every read/write `WHERE company_id = $1` (multi-company discriminator).

### Voice parity (`polishTldr`)
**Source:** `compile-tldr.ts:370-378`
**Apply to:** the detection one-liner before persistence, AND already used in `build-employees-rollup.ts:384-385`. `polishTldr(input)` then truncate ≤80 chars with `…`.

### Op-issue LLM delivery + governance
**Source:** `editor.ts:305-329` (`startAgentTask`/`pollAgentTaskResult`), Phase 16.1 wake-governor / opt-in gate / self-loop filter.
**Apply to:** the new `human-wait-detect` operation kind. Ride the existing heartbeat; add NO new wake path.

### UUID scrub on rendered labels (NO_UUID_LEAK)
**Source:** `scrub-human-action.ts` (`scrubHumanAction`), `blockerLine` shared wording helper (`live-blocker-panel.tsx:83-113`).
**Apply to:** the structured-wait label flows through the existing `AWAITING_HUMAN` arm (`awaitedPartyLabel`) — the one-liner just needs to be IN the scrubbed label. No new scrub.

---

## No Analog Found

None. Every file has a live in-repo analog. The only "new" code is composition: one engine branch, one table + repo, one detection prompt, the nodeMeta merge helper on three paths, and two Reader files.

---

## SC5 PARITY TRAP — EXPLICIT FLAG

**This is the single largest landmine and the exact BEAAA-972 bug class.** The structured wait must be merged into `nodeMeta[rootId]` on ALL THREE root-meta write sites:

| # | Site | Line | Path |
|---|------|------|------|
| 1 | `flatten-blocker-chain.ts` | ~354 (`nodeMeta[startId] = {...}`) | Reader |
| 2 | `build-employees-rollup.ts` | ~441 (`nodeMeta[focusIssue.id] = {...}`) | Situation Room (rollup) |
| 3 | `org-blocked-backlog.ts` | root meta | Situation Room (backlog) |

A wait merged on one but not the others → the SAME issue reads `AWAITING_HUMAN` in the Situation Room and `AWAITING_AGENT_STUCK` in the Reader. **Mitigation (mandatory): one shared `applyStructuredWait(nodeMeta, startId, waitMap)` helper called identically at all three sites, fed by ONE `waitMap` built once in the `situation-room.ts` prefetch.** Pin it with the extended `blocked-no-edge-verdict-consistency.test.mjs` matrix (the `structured-human-wait` row must agree across Reader + SR + Bulletin + Chat) AND the updated `flatten-blocker-chain-parity.test.mjs` same-shape assertion. **Warning sign:** the parity test or the matrix test fails for the `structured-human-wait` row only.

**Second trap (engine purity):** do NOT add any AI import/token/comment (`llm`/`gpt`/`openai`/`anthropic`/`claude_local`/`completion`) to `blocker-chain.ts` — the grep guard (`test/shared/blocker-chain.test.mjs:408-415`) fails the build. The engine change is PURE field reads only.

---

## Metadata

**Analog search scope:** `migrations/`, `src/worker/db/`, `src/worker/handlers/`, `src/worker/agents/`, `src/worker/situation/`, `src/shared/`, `src/ui/surfaces/reader/`, `test/worker/`
**Files read for excerpt extraction:** `0015_action_cards.sql`, `action-cards-repo.ts`, `clarity-agent-owners-repo.ts`, `blocker-chain.ts` (25-129, 274-368), `flatten-blocker-chain.ts` (90-105, 340-369), `org-blocked-backlog.ts` (58-69), `build-employees-rollup.ts` (438-457), `issue-reader.ts` (357-429), `breadcrumb.tsx`, `ref-card.tsx` (20-104), `editor.ts` (259-333), `compile-tldr.ts` (368-381), `blocked-no-edge-verdict-consistency.test.mjs` (155-204)
**Pattern extraction date:** 2026-06-10
