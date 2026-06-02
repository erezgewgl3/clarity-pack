# Phase 11: Honest Blocker Taxonomy (engine) - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 13 source files (8 Tier-A/B that read the engine contract + 5 Tier-C/UI) + 1 engine test
**Analogs found:** 13 / 13 (this is an *extend-in-place* refactor — every "new" file already exists; the only genuinely new artifact is the `classifyVerdict()` function, whose pattern analog is in-repo)

> RESEARCH.md already located every analog with `file:line` and disproved 3 CONTEXT false positives. This map turns that into concrete copy-from excerpts per file. The dominant pattern is **extend the existing pure contract, do not re-implement** — the engine, the scrub, the BFS, the ranking, and the test are all existing shared primitives.

---

## File Classification

| File (modified) | Role | Data Flow | Closest Analog (often = itself, extended) | Match Quality |
|---|---|---|---|---|
| `src/shared/types.ts` | model (type contract) | transform | `Terminal` union + `BlockerChainResult` *in this same file* | exact (self-extend) |
| `src/shared/blocker-chain.ts` | service (pure engine) | transform / graph-walk | the existing `flattenBlockerChain` cascade L147-181 | exact (self-extend) |
| **NEW** `classifyVerdict()` (in `blocker-chain.ts`) | utility (pure mapping) | transform | `humanize-snapshot.ts` exhaustive `switch`+`never` L155-172; `classify-employee-state.ts` pure total fn | exact idiom match |
| `src/shared/scrub-human-action.ts` | utility (sanitizer) | transform | itself — the 4-step scrub L46-76 | exact (self-extend) |
| `src/worker/handlers/org-blocked-backlog.ts` | handler (worker) | request-response / graph build | `buildEdges` nodeMeta build L211-226 | exact (self-extend) |
| `src/worker/handlers/flatten-blocker-chain.ts` | handler (worker) | request-response / graph build | shared `buildEdges` (collapse target); its own `walkBlockerChain` L74-127 | role-match (kill duplicate) |
| `src/worker/situation/build-employees-rollup.ts` | service (worker rollup) | transform / triage | its own re-triage filter L463-465; split-identity L329-353 | exact (self-extend) |
| `src/worker/situation/classify-employee-state.ts` | utility (pure classifier) | transform | itself — **the liveness-compute precedent** (injected `nowMs`) | exact (reuse as input source) |
| `src/worker/jobs/humanize-snapshot.ts` | job (dead, compiled) | transform | itself — exhaustive switch L155-172 (compile gate) | exact (self-extend) |
| `src/ui/surfaces/situation-room/employee-row.tsx` | component | request-response | `isUnowned = chain.ownerName === UNASSIGNED` L137 (string-match to kill) | role-match (migrate) |
| `src/ui/surfaces/situation-room/needs-you-banner.tsx` | component | request-response | partition filters L67-72 (string-match to kill) | role-match (migrate) |
| `src/ui/surfaces/situation-room/owner-picker-popover.tsx` | component | request-response | presentational; no type read | partial (gating only) |
| `src/ui/surfaces/situation-room/{index.tsx, org-blocked-backlog-banner-types.ts}` | component / types | request-response | type-passthrough | partial (type widen) |
| `src/ui/surfaces/reader/live-blocker-panel.tsx` | component | request-response | `terminal.kind === 'HUMAN_ACTION_ON'` special-case L34/81/91 | role-match (migrate) |
| `test/shared/blocker-chain.test.mjs` | test | transform | itself — per-kind cases + determinism + grep guard | exact (the analog for ALL new engine tests) |

---

## Pattern Assignments

### `src/shared/types.ts` (model / transform) — the Wave-0 contract

**Analog:** the existing union in this same file. Land this FIRST so the `never`-exhaustiveness compile error becomes the live migration checklist (Pitfall 1).

**Current shape to extend** (L38-49):
```typescript
export type Terminal =
  | { kind: 'HUMAN_ACTION_ON'; userId: string; label: string } // PRIM-05
  | { kind: 'SELF_RESOLVING'; etaIso: string; label: string }
  | { kind: 'EXTERNAL'; label: string }
  | { kind: 'CYCLE'; cycleNodes: string[]; label: string }; // PRIM-04

export type BlockerChainResult = {
  startId: string;
  pathIds: string[]; // BEAAA ids from start to terminal (inclusive)
  terminal: Terminal; // exactly one
  isStale: boolean; // computed against a max-age threshold
};
```

**What changes (D-05 / D-13 / D-15):**
- `Terminal` 4→8 variants: rename `HUMAN_ACTION_ON` → `AWAITING_HUMAN`; add `AWAITING_AGENT_WORKING`, `AWAITING_AGENT_STUCK`, `UNOWNED`, `UNCLASSIFIED`.
- Enrich `BlockerChainResult` with `needsYou: boolean`, `tier: 'needs-you' | 'in-motion' | 'watch'`, `actionAffordance: 'reply' | 'nudge' | 'assign' | 'open' | 'none'`, optional `degradeReason`, plus split-identity `awaitedPartyLabel` (display) / `targetAgentUuid?` / `targetIssueUuid?` (mutation-only).
- Follow the in-file commenting convention: every optional field carries a `// Plan 11-…` provenance comment and a one-line rationale (see the `LineageThread` enrichment block L120-130, which already models the additive-optional pattern with a NO_UUID_LEAK note on `ownerAgentId`).

**Convention to copy from `LineageThread.ownerAgentId`** (L127-129) — the split-identity comment idiom for a UUID-only field:
```typescript
/** … carried ONLY as the chat-deep-link target, NEVER rendered as visible text (NO_UUID_LEAK). */
ownerAgentId?: string | null;
```
Apply verbatim shape to `targetAgentUuid` / `targetIssueUuid` (D-15).

---

### `src/shared/blocker-chain.ts` (pure engine / graph-walk) — extend the cascade

**Analog:** the existing leaf-terminal cascade in this same file. The DFS walk above it (L49-146) is UNCHANGED — TAX-02 is satisfied by the walk continuing *through* agent nodes; only the leaf branch grows.

**Imports pattern** (L1-14) — preserve the PRIM-03 header comment exactly; the grep guard scans this file:
```typescript
import type { BlockerChainResult, Terminal } from './types.ts';
```

**Input shape to extend (D-01)** — add two per-node fields, nothing else:
```typescript
// Current (L22-31):
export type BlockerChainInput = {
  startId: string;
  edges: BlockerEdge[];
  nodeMeta: Record<string, { ownerUserId: string | null; etaIso: string | null; status: string }>;
  viewerUserId: string;
  maxAgeMs?: number;
};
// D-01 ADD to nodeMeta value: assigneeAgentId?: string | null; agentState?: 'working' | 'stuck' | null;
```

**Core pattern — the leaf cascade to extend** (L147-181, verbatim; this is the skeleton D-07 slots into):
```typescript
if (meta?.ownerUserId != null && meta.status === 'awaiting') {
  const terminal: Terminal = {
    kind: 'HUMAN_ACTION_ON',
    userId: meta.ownerUserId,
    label: `${meta.ownerUserId} to act on ${current}`,
  };
  return { startId: input.startId, pathIds, terminal, isStale: false };
}
if (meta?.etaIso != null && meta.ownerUserId == null) {
  const terminal: Terminal = { kind: 'SELF_RESOLVING', etaIso: meta.etaIso, label: `Self-resolving by ${meta.etaIso}` };
  return { startId: input.startId, pathIds, terminal, isStale: false };
}
// Fallback: deterministic unowned terminal. (the __unowned__ LIE — D-11 removes this)
const terminal: Terminal = { kind: 'HUMAN_ACTION_ON', userId: '__unowned__', label: `Owner unknown — assign ${current} first` };
return { startId: input.startId, pathIds, terminal, isStale: false };
```

**D-07 awaiting-first cascade ordering** (insert agent branch between user-owner and SELF_RESOLVING; replace the `__unowned__` fallback with real `UNOWNED`):
1. `lastReason === 'external'` → EXTERNAL (UNCHANGED, L120)
2. all outgoing external → EXTERNAL (UNCHANGED, L134)
3. `status === 'awaiting'` → `AWAITING_HUMAN`
4. `ownerUserId != null` → `AWAITING_HUMAN` (widen — was gated on `status==='awaiting'`)
5. `assigneeAgentId != null` → `AWAITING_AGENT_WORKING | _STUCK` by `agentState` (D-04: missing ⇒ `_STUCK`)
6. `etaIso != null && no owner` → `SELF_RESOLVING` (UNCHANGED, L160)
7. else → `UNOWNED` (REPLACES `__unowned__`)

> **Determinism guard (SC4):** new branches read ONLY `nodeMeta` string fields — no `Date.now()`, no `new Date()`, no cadence math. `agentState` arrives pre-resolved. Keep the existing edge sort (L59-61). See Shared Pattern: Determinism below.

**`pickTopChains` priority switch to update** (L215-228) — Pitfall 6: the new kinds must NOT fall through to `default: 99`:
```typescript
const priority = (c: BlockerChainResult): number => {
  switch (c.terminal.kind) {
    case 'HUMAN_ACTION_ON': return 0;
    case 'SELF_RESOLVING':  return 1;
    case 'EXTERNAL':        return 2;
    case 'CYCLE':           return 3;
    default:                return 99;
  }
};
return [...chains].sort((a, b) => priority(a) - priority(b)).slice(0, max);
```
Re-rank so needs-you kinds (`AWAITING_HUMAN`, `UNOWNED`) lead, in-motion/watch follow. Keep the `[...chains].sort(...)` copy-then-sort (purity test L181-190).

---

### NEW `classifyVerdict()` (pure mapping, D-14) — lives in `blocker-chain.ts` or a pure sibling

**Best analog (idiom):** `humanize-snapshot.ts:155-172` exhaustive `switch (t.kind)` with `const _exhaustive: never = t`. This is the repo's established *total-function-over-the-union* pattern. The new fn is a pure table mapping `Terminal['kind']` → `{ tier, actionAffordance, needsYou }`.

**Exhaustive-switch + never-guard pattern to copy** (humanize-snapshot.ts L154-172, verbatim):
```typescript
let newTerminal: Terminal;
switch (t.kind) {
  case 'HUMAN_ACTION_ON':
    newTerminal = { kind: 'HUMAN_ACTION_ON', userId: t.userId, label: newLabel };
    break;
  case 'SELF_RESOLVING':
    newTerminal = { kind: 'SELF_RESOLVING', etaIso: t.etaIso, label: newLabel };
    break;
  case 'EXTERNAL':
    newTerminal = { kind: 'EXTERNAL', label: newLabel };
    break;
  case 'CYCLE':
    newTerminal = { kind: 'CYCLE', cycleNodes: t.cycleNodes, label: newLabel };
    break;
  default: {
    // Exhaustiveness — TS narrows to `never`.
    const _exhaustive: never = t;
    throw new Error(`humanizeChain: unhandled terminal kind: ${JSON.stringify(_exhaustive)}`);
  }
}
```
Copy this `switch` + `const _exhaustive: never` shape for `classifyVerdict`. The `never` guard makes a future kind addition compile-gated (the intended D-14 behavior).

**Secondary analog (pure-total-fn discipline):** `classify-employee-state.ts:39-62` — a pure function returning exactly one of a fixed enum set for every input, with module-local const windows and a one-line provenance header. Mirror its purity comment (`// Pure: no SDK import, no I/O, no wall-clock read`).

**The verdict table to encode (RESEARCH §"kind→{tier, affordance, needsYou} Mapping", from design-seed §3 Section 1):**

| Terminal kind | `tier` | `actionAffordance` | `needsYou` |
|---|---|---|---|
| `AWAITING_HUMAN` | `needs-you` | `reply` | `true` |
| `AWAITING_AGENT_WORKING` | `in-motion` | `none` | `false` |
| `AWAITING_AGENT_STUCK` | `watch` | `nudge` | `false` |
| `SELF_RESOLVING` | `watch` | `none` | `false` |
| `EXTERNAL` | `watch` | `open` | `false` |
| `CYCLE` | `watch` | `open` | `false` |
| `UNOWNED` | `needs-you` | `assign` | `true` |
| `UNCLASSIFIED` | `watch` | `open` | `false` |

> Use neutral vocabulary only (`working`/`stuck`/`tier`/`affordance`/`reply`/`nudge` are all grep-safe). The AI-token guard scans `blocker-chain.ts` — do not introduce `llm`/`gpt`/`completion`/`openai`/`anthropic`/`claude_local` identifiers or comments.

---

### `src/worker/handlers/org-blocked-backlog.ts` (worker handler) — agent-ownership injection

**Analog:** its own `buildEdges` nodeMeta build. The data is ALREADY on the wire (`IssueLike.assigneeAgentId` L123) — this is wiring, not a new fetch (Specifics §2).

**The exact injection point** (L211-219, verbatim) — extend the `blockedBy` cast (L202-210) and the `nodeMeta[toId]` literal:
```typescript
for (const blocker of blockedBy) {
  const toId = blocker.id ?? blocker.issueId ?? blocker.key ?? '';
  if (!toId) continue;
  edges.push({ from: id, to: toId, reason: 'blocks' });
  nodeMeta[toId] = {
    ownerUserId: blocker.assigneeUserId ?? blocker.ownerUserId ?? null,
    etaIso: blocker.etaIso ?? null,
    status: blocker.status ?? 'awaiting',
    // D-01 ADD: assigneeAgentId: blocker.assigneeAgentId ?? null,
    // D-01 ADD: agentState: <worker-computed liveness, or null>
  };
  if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) {
    queue.push({ id: toId, depth: depth + 1 });
  }
}
```

**Defensive-cast convention to follow (Pitfall 7, V5):** add `assigneeAgentId?: string | null` to the inline `blockedBy` cast type (L202-210) and read it with `?? null`, exactly as `ownerUserId`/`etaIso` are read today. A missing field falls through the cascade to `UNOWNED`/`SELF_RESOLVING` — conservative-correct.

**Degrade pattern — emit UNCLASSIFIED instead of dropping** (the existing try/catch at L271-291): today a thrown `buildEdges`/`flatten` does `continue` (silent drop). Per TAX-03/D-09, emit an `UNCLASSIFIED` row with `degradeReason` instead. The existing `ctx.logger?.warn?.(...)` calls stay.

**`need_you` re-triage:** key on `verdict.needsYou` (D-13), not the `HUMAN_ACTION_ON`+`UNOWNED_SENTINEL` viewer-match at L332/L370-374.

---

### `src/worker/handlers/flatten-blocker-chain.ts` (worker handler) — fix the EXTERNAL lie + collapse duplicate BFS

**Analog (collapse target):** the EXPORTED shared `buildEdges` in `org-blocked-backlog.ts:167-226`. Per Don't-Hand-Roll, this handler's private `walkBlockerChain` (L74-127) is the duplicate that risks SC5 drift (Pitfall 2). Collapse it into the shared `buildEdges` so liveness/agent capture lives in ONE worker location; if the collapse exceeds the wave budget, thread the identical `nodeMeta` field set and add a same-shape test.

**The `graceful()` EXTERNAL lie to fix (D-10 / Pitfall 3)** — L129-141, verbatim:
```typescript
function graceful(startId: string, label: string): BlockerChainResult {
  // EXTERNAL is the closest semantic for "no chain to flatten" or "relations
  // unavailable" — the UI surface renders a non-actionable banner ...
  const terminal: Terminal = { kind: 'EXTERNAL', label };
  return { startId, pathIds: startId ? [startId] : [], terminal, isStale: false };
}
```
**Change:** the walk-FAILURE call sites (L49 missing-params, L57 "Relations unavailable") emit `UNCLASSIFIED` + `degradeReason`. Distinguish the **empty-graph** case (L61 "No active blockers" — genuinely no blockers, may render no panel) from **walk failure** (UNCLASSIFIED). Do NOT collapse both to one kind.

---

### `src/worker/situation/build-employees-rollup.ts` (worker rollup) — re-triage off verdict + reuse split-identity

**Analog:** its own re-triage filter (the exact string-match D-14 kills) and its own `leafIssueUuid` split-identity (the D-15 precedent).

**The string-match to replace (D-13/D-14)** — L463-465, verbatim:
```typescript
const unowned = rows.filter(
  (r) => r.group === 'needs_you' && r.blockerChain && r.blockerChain.ownerName === 'Unassigned',
);
// REPLACE WITH: filter on r.blockerChain.verdict.needsYou (or verdict.tier === 'needs-you')
```

**Split-identity precedent to mirror for D-15** — L329-353, verbatim (this is the proven v1.3.0 R3 fix: human id rendered, UUID carried separately for mutation):
```typescript
// leafIssueUuid is the MUTATION id (the issue UUID), carried alongside the
// human leafIssueId. UUID candidate chain: leaf.id → leafNodeId → focusIssue.id.
// NEVER an .identifier.
const leafNodeId = picked.pathIds[picked.pathIds.length - 1];
let leafIssueUuid: string | null =
  (typeof leafNodeId === 'string' && leafNodeId.length > 0 ? leafNodeId : null) ??
  (typeof focusIssue.id === 'string' && focusIssue.id.length > 0 ? focusIssue.id : null);
// ...
blockerChain = { rootIssueId, leafIssueId, leafIssueUuid, humanAction, ownerName, ownerAgentId };
```
The verdict's `targetAgentUuid`/`targetIssueUuid` (D-15) follow this same human-id-vs-UUID split. `awaitedPartyLabel` is the rendered string (scrubbed); the `*Uuid` fields are dispatch-only.

**Degrade pattern** — the existing chain-build try/catch at L365-373 sets `blockerChain = null`. Per D-09, emit an `UNCLASSIFIED` verdict so the row shows the honest fallback line (not a silent null). The `ctx.logger?.warn?.(...)` call stays.

**Liveness compute lives here / shared helper** — see Shared Pattern: Liveness below.

---

### `src/worker/jobs/humanize-snapshot.ts` (dead job, still compiled) — the compile gate

**Analog:** itself. This file is dead at runtime (caller deleted Plan 09-01) but compiled by `typecheck`. Its exhaustive `switch`+`never` (L155-172, shown above under `classifyVerdict`) **fails `tsc` the moment the union grows** — that is the migration checklist made mechanical (Pitfall 1).

**Action:** either (a) add the 4 new kinds to the switch (safest), or (b) verify zero imports and DELETE the file (cleanest — removes one exhaustiveness site). Open Question 3 / Assumption A3: confirm no `register*` wiring invokes it in `worker.ts` before deleting. Also handles the `__unowned__` special-case at L112 — remove with the sentinel.

---

### Tier-C / UI consumers — migrate off string-match to verdict fields

**`employee-row.tsx`** — analog is its own L137:
```typescript
const isUnowned = !!chain && chain.ownerName === UNASSIGNED;  // UNASSIGNED = 'Unassigned' (L66)
```
Replace with `verdict.actionAffordance === 'assign'` to gate the assign cluster; gate nudge/reply on the verdict, not the string.

**`needs-you-banner.tsx`** — analog is its own L67-72:
```typescript
const unownedBlocked = employees.filter(
  (e) => e.group === 'needs_you' && e.blockerChain?.ownerName === UNASSIGNED,
);
const ownedBlocked = employees.filter(
  (e) => e.group === 'needs_you' && e.blockerChain && e.blockerChain.ownerName !== UNASSIGNED,
);
```
Partition off `verdict.tier` / `verdict.needsYou` (D-14). `UNASSIGNED = 'Unassigned'` (L50) becomes dead — remove.

**`live-blocker-panel.tsx`** — special-cases `terminal.kind === 'HUMAN_ACTION_ON'` (L34/81/91), else `terminal.kind.replace(/_/g,' ')` (L87). Render the 4 new kinds; gate the action button on `verdict.actionAffordance`, not `kind === 'HUMAN_ACTION_ON'`.

**`owner-picker-popover.tsx`** — presentational, no `Terminal` read. NO type change; only its render gate moves upstream to `affordance === 'assign'`.

**`index.tsx` / `org-blocked-backlog-banner-types.ts`** — type passthrough; `OrgBlockedRow.terminalKind` widens to the 8-kind union automatically. Verify no re-derivation in the page body.

---

### `test/shared/blocker-chain.test.mjs` — the analog for EVERY new engine test

**This file is the canonical test analog.** Any new terminal-kind test copies the per-kind case shape; the determinism + grep-guard tests MUST stay green (SC4 / D-08).

**Per-kind case shape to copy** (L19-38, verbatim) — one assert per `terminal.kind` + payload:
```typescript
test('HUMAN_ACTION_ON — A→B→C, C is awaiting eric, terminal is HUMAN_ACTION_ON(eric); pathIds=[A,B,C]', () => {
  const result = flattenBlockerChain({
    startId: 'A',
    edges: [ { from: 'A', to: 'B', reason: 'blocks' }, { from: 'B', to: 'C', reason: 'blocks' } ],
    nodeMeta: {
      A: { ownerUserId: null, etaIso: null, status: 'blocked' },
      B: { ownerUserId: null, etaIso: null, status: 'blocked' },
      C: { ownerUserId: 'eric', etaIso: null, status: 'awaiting' },
    },
    viewerUserId: 'eric',
  });
  assert.equal(result.terminal.kind, 'HUMAN_ACTION_ON');
  assert.equal(result.terminal.userId, 'eric');
});
```
The existing `HUMAN_ACTION_ON` case becomes the `AWAITING_HUMAN` case. Add analogous cases for `AWAITING_AGENT_WORKING`/`_STUCK` (with `assigneeAgentId` + `agentState` fixtures), `UNOWNED`, `UNCLASSIFIED`.

**Determinism case to keep green** (L92-114) — 100× `JSON.stringify` equality. Every new verdict field must be deterministically derived from input.

**AI-token grep guard to keep green** (L192-199, verbatim):
```typescript
test('PRIM-03 deterministic-graph-only — blocker-chain.ts source contains zero LLM/AI references', () => {
  const src = readFileSync(BLOCKER_CHAIN_SRC, 'utf8');
  const banned = /\b(openai|anthropic|claude_local|llm|gpt|completion)\b/i;
  assert.ok(!banned.test(src), 'blocker-chain.ts must contain zero LLM references — PRIM-03 ...');
});
```

**`pickTopChains` purity case** (L181-190) — asserts input array order unchanged; update its ranking expectations for the new kinds.

---

## Shared Patterns

### Caller-injects-the-impure-bits (Liveness, D-01/D-02/D-03/D-04)
**Source:** `src/worker/situation/classify-employee-state.ts:18-62`
**Apply to:** the worker side of `build-employees-rollup.ts` + `org-blocked-backlog.ts` `buildEdges` (NOT the engine).
The codebase already splits "engine takes structured facts, worker computes them." `classify-employee-state.ts` is a pure function with `nowMs` injected and module-local windows:
```typescript
const RUNNING_WINDOW_MS = 5 * 60 * 1000;   // 5 min
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
export function classifyEmployeeState(input: ClassifyInput): EmployeeState {
  const heartbeatAge = lastHeartbeatMs != null ? nowMs - lastHeartbeatMs : Infinity;
  if (heartbeatAge < RUNNING_WINDOW_MS) return 'running';
  // ...
}
```
Compute `agentState: 'working' | 'stuck' | null` in the worker by reusing this heartbeat-age logic (its `running`→`working`, `stale`/`blocked`→`stuck` projection), then inject the resolved string into `nodeMeta`. D-03 cadence: prefer a host-sourced expected interval; the fixed-window constants here (5min / 24h) are the established fallback (Assumption A2). D-04: missing signal ⇒ `'stuck'` (conservative).

### NO_UUID_LEAK scrub (D-15 / V7 — primary security control)
**Source:** `src/shared/scrub-human-action.ts:46-76`
**Apply to:** every surface that renders `awaitedPartyLabel`; the verdict's `*Uuid` fields are mutation-only and NEVER rendered.
The single-source 4-step scrub (UUID regex `[0-9a-f]{8}-...-[0-9a-f]{12}`, name-or-`agent#<8>` fallback, viewer→"You"):
```typescript
export function scrubHumanAction(terminal: Terminal, viewerUserId: string, nameByUuid: Map<string, string | null>): string {
  if (terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId === UNOWNED_SENTINEL) {
    const m = terminal.label.match(UUID_RE);
    const name = m ? nameOf(m[0]) : null;
    return name ? `${name} — assign an owner first` : 'Owner unknown — assign an owner first';
  }
  let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? `agent#${uuid.slice(0, 8)}`);
  // ... viewer→"You" ... belt-and-suspenders
  return label.replace(UUID_RE_G, (uuid) => `agent#${uuid.slice(0, 8)}`);
}
```
Extend for the new kinds; produce `awaitedPartyLabel` with zero raw UUIDs for all 8 kinds. **Remove `UNOWNED_SENTINEL = '__unowned__'` (L19) — D-11.** Keep the UUID-shape source-scan tests; add coverage for the new fields.

### Determinism preservation (SC4 / D-08 — purity contract)
**Source:** `src/shared/blocker-chain.ts:59-61` (edge sort) + `test/shared/blocker-chain.test.mjs:92-114, 192-199`
**Apply to:** every change inside `blocker-chain.ts`.
- No `Date.now()`, no `new Date()`, no `Math.random()`, no `Set`/`Map` iteration-order in serialized output. Liveness is INJECTED as a string (D-01).
- Keep `list.sort((a, b) => (a.to < b.to ? -1 : ...))` adjacency sort.
- `pickTopChains` stays copy-then-sort: `[...chains].sort(...)`.
- Use only grep-safe vocabulary in this file (the banned regex is `/\b(openai|anthropic|claude_local|llm|gpt|completion)\b/i`).

### Defensive-cast field reads (V5 / Pitfall 7)
**Source:** `src/worker/handlers/org-blocked-backlog.ts:202-219` (inline cast + `?? null`)
**Apply to:** the new `assigneeAgentId` / `agentState` reads on `blockedBy[]` nodes. Loose inline cast, `?? null` fallback, never assume the SDK relation-summary types the field. Verify population against a real BEAAA `relations.get` during the drill (Assumption A1).

---

## No Analog Found

None. Every file in scope already exists and is extended in place; the only net-new artifact (`classifyVerdict()`) has a direct idiom analog (`humanize-snapshot.ts` exhaustive switch + `classify-employee-state.ts` pure total fn). The planner should NOT fall back to RESEARCH.md generic patterns for any file — the in-repo analogs are exact.

---

## Metadata

**Analog search scope:** `src/shared/`, `src/worker/{handlers,situation,jobs}/`, `src/ui/surfaces/situation-room/`, `src/ui/surfaces/reader/`, `test/shared/` — the authoritative 8-file consumer set from RESEARCH.md plus the engine test.
**Files scanned (read this session):** `blocker-chain.ts`, `types.ts`, `classify-employee-state.ts`, `humanize-snapshot.ts`, `scrub-human-action.ts`, `org-blocked-backlog.ts`, `flatten-blocker-chain.ts`, `build-employees-rollup.ts`, `employee-row.tsx`, `needs-you-banner.tsx`, `blocker-chain.test.mjs`.
**Pattern extraction date:** 2026-06-02
