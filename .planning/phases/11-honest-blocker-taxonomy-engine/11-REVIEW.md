---
phase: 11-honest-blocker-taxonomy-engine
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/shared/blocker-chain.ts
  - src/shared/scrub-human-action.ts
  - src/shared/types.ts
  - src/ui/surfaces/reader/live-blocker-panel.tsx
  - src/ui/surfaces/situation-room/employee-row.tsx
  - src/ui/surfaces/situation-room/needs-you-banner.tsx
  - src/ui/surfaces/situation-room/org-blocked-backlog-banner-types.ts
  - src/ui/surfaces/situation-room/index.tsx
  - src/worker/handlers/flatten-blocker-chain.ts
  - src/worker/handlers/org-blocked-backlog.ts
  - src/worker/situation/agent-liveness.ts
  - src/worker/situation/build-employees-rollup.ts
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-02
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

The Honest Blocker Taxonomy Engine (TAX-01/02/03) is well-structured: the pure
engine (`blocker-chain.ts`) is genuinely clock-free, `classifyVerdict()` covers
all 8 Terminal kinds with a `never` guard, `resolveAgentState()` is a clean
injected-clock projection, and the two BFS builders (`org-blocked-backlog.ts`,
`flatten-blocker-chain.ts`) keep their `nodeMeta` field set in lockstep.

The headline defect is a **NO_UUID_LEAK invariant break on the Reader surface**:
the `flatten-blocker-chain` worker handler is the only chain producer that does
NOT run `scrubHumanAction`, and the Reader panel renders `terminal.label` /
`awaitedPartyLabel` (which embed raw issue/user/agent UUIDs from the walk) verbatim
into the DOM. This is the exact invariant the phase prompt flags as hard. Six
warnings cover honesty/robustness regressions (false `open` affordance on
blocker-free issues, a `expectedCadenceMs: 0` boundary collapse, an EXTERNAL leaf
mis-attribution, dead/contradictory comments, and a viewer-scoping mismatch).

## Critical Issues

### CR-01: NO_UUID_LEAK — Reader's `flatten-blocker-chain` never scrubs the terminal label; raw UUIDs render in the DOM

**File:** `src/worker/handlers/flatten-blocker-chain.ts:94-101` (producer) and `src/ui/surfaces/reader/live-blocker-panel.tsx:68-94, 136` (renderer)

**Issue:** Every other chain producer scrubs before returning:
`org-blocked-backlog.ts:471` (`humanAction: scrubHumanAction(...)`) and
`build-employees-rollup.ts:331` both run the shared `scrubHumanAction`. The Reader
handler does not. It returns `flattenBlockerChain(...)` straight to the bridge, and
`makeResult()` sets `awaitedPartyLabel: terminal.label` **raw** (`blocker-chain.ts:119`).

The engine's labels embed raw graph-node identifiers:
- `AWAITING_HUMAN` → `` `${meta.ownerUserId} to act on ${current}` `` (`blocker-chain.ts:236,246`)
- `AWAITING_AGENT_WORKING/STUCK` → `` `${meta.assigneeAgentId} working on ${current}` `` (`:260,265`)
- `EXTERNAL` → `` `External (${current})` `` (`:215,225`)
- `CYCLE` → `` `Cycle: A → B → C` `` (`:185`)

Those `ownerUserId` / `assigneeAgentId` / `current` values come from
`walkBlockerChain`, where `current`/`toId` = `blocker.id` (the issue **UUID**, per
the `paperclip-issue-url-pattern` / `chat-topics-issue-id-is-text` facts — `.id` is
the UUID, `.identifier` is the human key) and `ownerUserId` = `b.assigneeUserId`
(a user UUID), `assigneeAgentId` = an agent UUID.

The Reader then renders these unscrubbed:
- `live-blocker-panel.tsx:72` `return t.label;` (AWAITING_HUMAN — leaks owner UUID + issue UUID)
- `:74,76` `` `${data.awaitedPartyLabel} is working — ${t.label}` `` (leaks agent UUID twice)
- `:78,80,82,84` (SELF_RESOLVING/EXTERNAL/CYCLE/UNOWNED — leak the embedded id)
- `:136` `primaryActionLabel(data.actionAffordance, data.awaitedPartyLabel)` → `Reply: <raw label>` / `Nudge <raw label>`

The panel's own doc comment (`:40`, `:65`) asserts `awaitedPartyLabel` "is the
scrubbed display string (NO_UUID_LEAK) — never a UUID" — that contract is **false**
for this code path. This violates the phase's hard invariant: a split-identity/raw
UUID reaches a rendered human-facing label.

**Fix:** Scrub in the worker handler before returning, exactly as the other two
producers do — resolve the label/owner/agent UUIDs to names via `ctx.agents.get`
into a `nameByUuid` map and overwrite `awaitedPartyLabel` (and emit a scrubbed
display label the UI renders) with `scrubHumanAction(terminal, viewerUserId, nameByUuid)`.
The Reader must render `awaitedPartyLabel` (scrubbed) instead of `t.label`:

```ts
// flatten-blocker-chain.ts — after flattenBlockerChain(...)
const result = flattenBlockerChain({ startId, edges, nodeMeta, viewerUserId, maxAgeMs });
const nameByUuid = await resolveNamesForTerminal(ctx, companyId, result.terminal); // mirror org-blocked-backlog.ts:402-444
return { ...result, awaitedPartyLabel: scrubHumanAction(result.terminal, viewerUserId, nameByUuid) };
```

```tsx
// live-blocker-panel.tsx blockerLine() — render the scrubbed string, not t.label
case 'AWAITING_HUMAN':
  return data.awaitedPartyLabel;
case 'EXTERNAL':
  return data.awaitedPartyLabel;
// ...every branch that currently returns t.label must use data.awaitedPartyLabel
```

`degraded()` and `noBlockers()` are already UUID-safe (literal labels), so only the
success path needs the scrub.

## Warnings

### WR-01: `noBlockers()` emits `EXTERNAL`, which `classifyVerdict` maps to `actionAffordance: 'open'` — a blocker-free issue renders a dead "Open ↗" button

**File:** `src/worker/handlers/flatten-blocker-chain.ts:234-249` + `src/shared/blocker-chain.ts:74-75`

**Issue:** The genuinely-blocker-free case returns a synthetic `EXTERNAL` terminal
"to render the UI's non-actionable 'no active blockers' state" (`:228-233`). But
`classifyVerdict('EXTERNAL')` returns `{ tier: 'watch', actionAffordance: 'open', needsYou: false }`
(`blocker-chain.ts:74-75`). The Reader's `primaryActionLabel('open', ...)` returns
`'Open ↗'` (`live-blocker-panel.tsx:52-53`), so a blocker-free issue surfaces a
clickable "Open ↗" button — the comment's "non-actionable" intent is contradicted
by the affordance. Worse, that button has no onClick wired in the panel at all
(`:155-157` renders `<button class="clarity-blocker-action">{actionLabel}</button>`
with no handler), so it is a dead button on every EXTERNAL/UNOWNED/AGENT_STUCK row.

**Fix:** Either introduce a dedicated non-actionable terminal/affordance for the
blocker-free state (affordance `'none'`), or special-case `noBlockers()` to set
`actionAffordance: 'none'`. Separately, wire a real onClick on the panel button or
omit it (see WR-02).

### WR-02: Reader panel `.clarity-blocker-action` button is a no-op (R4 "no dead buttons" regression)

**File:** `src/ui/surfaces/reader/live-blocker-panel.tsx:155-157`

**Issue:** `<button className="clarity-blocker-action">{actionLabel}</button>` has no
`onClick`, no `type="button"`, and no dispatch. For affordances `reply`, `nudge`,
`assign`, `open` the panel renders a button that does nothing. This is the exact
dead-button anti-pattern Phase 9 (`employee-row.tsx` header comment) exists to kill,
re-introduced on the Reader surface. The mutation-only `targetAgentUuid` /
`targetIssueUuid` carried on the result are never consumed here.

**Fix:** Wire each affordance to its real action (reply/nudge → chat or
`issues.requestWakeup` using `targetAgentUuid`; assign → owner picker using
`targetIssueUuid`; open → `navigate`), or render no button until the dispatch is
implemented. Add `type="button"` to avoid implicit form submit.

### WR-03: `resolveAgentState` collapses the stale window to 0 when `expectedCadenceMs === 0`

**File:** `src/worker/situation/agent-liveness.ts:57`

**Issue:** `const staleWindowMs = 2 * (expectedCadenceMs ?? RUNNING_WINDOW_MS);`
The `??` only substitutes the fallback for `null`/`undefined`. A host value of `0`
(or any sub-`RUNNING_WINDOW_MS` value) passes the `typeof === 'number'` guard at the
call sites (`flatten-blocker-chain.ts:184`, `org-blocked-backlog.ts:289`) and yields
`staleWindowMs = 0`, so `heartbeatAge < 0` is never true → EVERY agent with a finite
heartbeat is classified `stuck`. This silently floods the board with false "stuck →
nudge" rows and falsely inflates needs-you counts.

**Fix:** Guard for a positive value, not just non-null:
```ts
const cadence = typeof expectedCadenceMs === 'number' && expectedCadenceMs > 0
  ? expectedCadenceMs
  : RUNNING_WINDOW_MS;
const staleWindowMs = 2 * cadence;
```
Apply the same `> 0` guard at both call sites where `expectedCadenceMs` is forwarded.

### WR-04: `resolveAgentState` return type includes `null` but the function can never return it — dead type widening hides the D-04 contract

**File:** `src/worker/situation/agent-liveness.ts:52`

**Issue:** The signature is `: 'working' | 'stuck' | null` and the doc comment (and
the engine's D-04 reasoning) explicitly state it "Never returns null itself." Every
return path yields `'working'` or `'stuck'`. The `| null` is dead, and it forces
both callers to type `agentState` as nullable and re-reason about a null that this
function never produces. More importantly, it weakens the compile-time guarantee
that an agent-owned node always gets a concrete state.

**Fix:** Narrow the return type to `'working' | 'stuck'`. The callers already supply
`null` themselves when `assigneeAgentId == null` (e.g. `org-blocked-backlog.ts:281-292`),
so the nullability belongs at the call site, not in this helper's contract.

### WR-05: EXTERNAL leaf via "only-external children" attributes the wrong node id in the label

**File:** `src/shared/blocker-chain.ts:219-228`

**Issue:** When a leaf has only external outgoing edges, the terminal label is
`` `External (${externalEdge.to})` `` using `outgoing[0].to` — i.e. the *child*
node the walk refused to recurse into — while `leafId` is passed as `current` (the
leaf itself). So `targetIssueUuid` (=`current`) and the displayed label refer to two
different nodes. In the first EXTERNAL branch (`:212-218`, reached-via-external) the
label uses `current`. The two EXTERNAL paths are inconsistent about which node they
name, which will confuse the open-to-investigate affordance (it opens `current` but
the text references a different id).

**Fix:** Make both EXTERNAL branches name the same node as `leafId`/`targetIssueUuid`
(use `current`), or deliberately carry the external child id in a typed field rather
than smuggling it through the free-text label.

### WR-06: `build-employees-rollup` viewer-scoping reads `terminal.userId` while needs-you membership reads the engine verdict — two sources of truth can disagree

**File:** `src/worker/situation/build-employees-rollup.ts:399-401` vs `:534-540`

**Issue:** `needsYou.count` is computed from the engine verdict
(`actionAffordance === 'assign'` for unowned + `__targetsViewer` for owned), but
`__targetsViewer` itself is set by a separate `terminal.kind === 'AWAITING_HUMAN' &&
terminal.userId === viewerUserId` string/identity check (`:399`). The phase's stated
goal (SC5) is "single source of truth — no view-layer re-derivation," yet this row
still re-derives viewer-targeting from `terminal.userId` rather than from a verdict
field. If a future kind (or a label-only AWAITING_HUMAN with a name-resolved userId)
changes, the two computations can diverge, producing a needs-you count that doesn't
match the rows the banner can act on.

**Fix:** Either add an explicit `targetsViewer`/`viewerIsAwaited` boolean to the
engine verdict (computed once in `classifyVerdict`/`makeResult` with the viewer id),
or document why `terminal.userId` viewer-match is intentionally the only legitimate
use and pin it with a test asserting the two computations agree.

## Info

### IN-01: Comment in `live-blocker-panel.tsx` is factually wrong about scrubbing

**File:** `src/ui/surfaces/reader/live-blocker-panel.tsx:40, 64-67`

**Issue:** Comments assert `awaitedPartyLabel` / `terminal.label` "Renders ONLY
scrubbed display strings ... never a raw ... UUID (NO_UUID_LEAK)." Per CR-01 this is
untrue for the Reader path. A misleading invariant comment is worse than none — it
discourages reviewers from re-checking the path. Update once CR-01 is fixed.

### IN-02: `scrubHumanAction` step numbering skips Step 3

**File:** `src/shared/scrub-human-action.ts:48-87`

**Issue:** Inline comments label Step 1, Step 2, Step 4, Step 5, Step 6 — there is no
Step 3 (it was the removed sentinel branch per the header note). Harmless, but a
reader will hunt for the missing step. Renumber 1-2-3-4-5 or note the gap explicitly.

### IN-03: `flatten-blocker-chain.ts` `walkBlockerChain` triple-cast `blocker` reads are duplicated and fragile

**File:** `src/worker/handlers/flatten-blocker-chain.ts:142-145, 155-165`

**Issue:** `toId` is read via three chained `as unknown as { id?/issueId?/key? }`
casts, then `blocker` is cast again to a different anonymous shape. `org-blocked-backlog.ts:246-264`
solves the identical problem with a single typed `blockedBy` array cast — cleaner and
already proven. Consider sharing the relation-node projection type between the two
walkers (the file headers claim SC5 keeps them in sync; the casting style does not).

### IN-04: `degraded()` / `noBlockers()` / `unclassifiedChain()` duplicate the `makeResult` verdict-assembly boilerplate

**File:** `src/worker/handlers/flatten-blocker-chain.ts:210-249`, `src/worker/handlers/org-blocked-backlog.ts:163-182`

**Issue:** Three near-identical hand-built `BlockerChainResult` objects re-implement
what `makeResult()` (`blocker-chain.ts:97-124`) already does (call `classifyVerdict`,
spread the verdict, set `targetAgentUuid: null`, `targetIssueUuid: startId`). If a
future verdict field is added to `makeResult`, these three sites will silently miss
it. Export a shared `makeDegradedResult(terminal, startId, degradeReason?)` helper.

---

_Reviewed: 2026-06-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
