---
phase: 11-honest-blocker-taxonomy-engine
plan: 06
subsystem: worker-blocker-chain-handlers
tags: [blocker-chain, NO_UUID_LEAK, CR-01, WR-01, WR-03, WR-06, IN-03, IN-04, D-15, scrub, viewer-scoping]
requires:
  - "Plan 11-05 makeDegradedResult + makeBlockerFreeResult exports (blocker-chain.ts)"
  - "Plan 11-05 positive-cadence guard in resolveAgentState (the helper); this plan adds the two CALL-SITE guards"
  - "src/shared/scrub-human-action.ts scrubHumanAction (8-kind scrub) + UUID_RE_G"
  - "org-blocked-backlog.ts:402-471 — the name-resolution + scrub analog mirrored here"
  - "11-REVIEW.md CR-01 / WR-01 / WR-03 / WR-06 / IN-03 / IN-04"
provides:
  - "src/worker/handlers/flatten-blocker-chain.ts — scrubResultLabel(ctx, companyId, viewerUserId, result): the CR-01 success-path NO_UUID_LEAK scrub (nameByUuid from ctx.agents → scrubHumanAction). THE D-15 fix at the worker boundary"
  - "src/worker/handlers/flatten-blocker-chain.ts — buildHandlerResult(): pure result router; blocker-free → makeBlockerFreeResult ('none', WR-01); degrade → makeDegradedResult (IN-04)"
  - "src/worker/handlers/flatten-blocker-chain.ts — FlattenBlockerChainCtx widened with optional agents.get; WR-03 call-site cadence guard (> 0)"
  - "src/worker/handlers/org-blocked-backlog.ts — exported RelationNodeProjection type (IN-03); WR-03 second call-site guard (> 0)"
  - "src/worker/situation/build-employees-rollup.ts — rowTargetsViewer(terminal, viewerUserId): the SINGLE viewer-targeting predicate (WR-06 / SC5)"
affects:
  - "src/ui/surfaces/reader/live-blocker-panel.tsx (Wave 3 / 11-07: now receives a scrubbed awaitedPartyLabel + 'none' affordance for blocker-free rows — safe to render)"
tech-stack:
  added: []
  patterns:
    - "Scrub at the worker boundary, not the engine: the pure engine returns the raw label; the LAST hop before the bridge resolves names + scrubs (NO_UUID_LEAK lives in the worker, engine stays pure)"
    - "Shared row-constructors (makeDegradedResult/makeBlockerFreeResult) adopted via a pure router (buildHandlerResult) so a future verdict field cannot be missed by a hand-built object (IN-04)"
    - "Single typed projection (RelationNodeProjection) shared by both BFS walkers instead of duplicated inline casts (IN-03)"
    - "Single pure predicate (rowTargetsViewer) for a fact two code paths previously derived independently (WR-06 / SC5)"
    - "Positive-value cadence guard (> 0) at BOTH call sites so a host 0 never reaches the helper from either builder (WR-03)"
key-files:
  created:
    - test/worker/handlers/flatten-blocker-chain-scrub.test.mjs
    - test/worker/situation/build-employees-rollup-viewer-single-source.test.mjs
  modified:
    - src/worker/handlers/flatten-blocker-chain.ts
    - src/worker/handlers/org-blocked-backlog.ts
    - src/worker/situation/build-employees-rollup.ts
decisions:
  - "CR-01 scrub: extracted the success-path name-resolution + scrub into an EXPORTED scrubResultLabel rather than inlining it in the wrapDataHandler closure — makes the NO_UUID_LEAK guarantee unit-testable without the opt-in guard / db stub, and keeps the registration body a thin router. Mirrors org-blocked-backlog.ts:402-471 exactly (owner/agent/leaf UUID collection, agents.get try/catch → null degrade, scrubHumanAction at the end)."
  - "buildHandlerResult is a pure exported router so the WR-01 ('none') and degrade-vs-success branching is testable in isolation; the handler closure only adds the opt-in guard + the success-path scrub call."
  - "WR-06 took the FALLBACK path (NOT widening the pure engine): rowTargetsViewer(terminal, viewerUserId) is a pure worker-side predicate the __targetsViewer flag reads. Adding a viewer-id-aware boolean to classifyVerdict/makeResult would force the pure engine to take a viewer id on every path (engine-contract widening 11-05 deliberately avoided for PRIM-03/SC4). The predicate + the needs-you count are pinned to agree by test."
  - "IN-03 type declared in org-blocked-backlog.ts and imported into flatten-blocker-chain.ts (the Reader walker), since org-blocked-backlog already owns the canonical EdgeNodeMeta and is imported by flatten-blocker-chain (buildEdges). summary.blockedBy is cast to RelationNodeProjection[] with the same single cast in both walkers."
metrics:
  duration: "~35 minutes"
  completed: 2026-06-02
  tasks: 3
  files: 5
  commits: 4
---

# Phase 11 Plan 06: flatten-blocker-chain NO_UUID_LEAK Scrub + Wave-2 Warnings Summary

The CR-01 BLOCKER is closed: `flatten-blocker-chain` — the only chain producer that returned without scrubbing — now resolves a `nameByUuid` map from `ctx.agents` and overwrites `awaitedPartyLabel` with `scrubHumanAction(terminal, viewerUserId, nameByUuid)` on the success path, mirroring `org-blocked-backlog.ts:402-471` exactly. No raw user/agent/issue UUID can reach the Reader's `awaitedPartyLabel` anymore (failed truth #5 / SC5 / D-15 mitigated at the worker boundary). Alongside the BLOCKER, this plan landed the worker-side WR-01 (blocker-free → `'none'`), both WR-03 call-site cadence guards (`> 0`), WR-06 single-source viewer-scoping, the IN-03 shared relation-node projection type, and adopted the 11-05 `makeDegradedResult` / `makeBlockerFreeResult` helpers (IN-04). The pure engine was not touched — the scrub and the viewer predicate live in the worker, so engine purity (PRIM-03 / SC4) holds.

## What Shipped

- **CR-01 BLOCKER — success-path scrub (Task 1).** Added `scrubResultLabel(ctx, companyId, viewerUserId, result)` (exported). It collects the UUIDs the terminal embeds — the AWAITING_HUMAN `userId` (when `isUuid`), the AWAITING_AGENT_* `agentId` (when `isUuid`), and every UUID `uuidsIn(terminal.label)` finds (covers the leaf node id) — resolves each via `ctx.agents.get(uuid, companyId)` inside try/catch (a throw → `null`, NEVER the raw UUID), then returns `{ ...result, awaitedPartyLabel: scrubHumanAction(result.terminal, viewerUserId, nameByUuid) }`. `FlattenBlockerChainCtx` was widened with the optional `agents.get` surface (mirrors `OrgBlockedBacklogCtx`); when `ctx.agents` is absent the map stays empty and the scrub degrades every UUID to `agent#<8>` — still leak-safe. The `registerFlattenBlockerChain` body now routes through `buildHandlerResult` then calls `scrubResultLabel` on the success path only (the degrade + blocker-free labels are UUID-safe literals).
- **WR-01 blocker-free `'none'` (Task 1).** The hand-built `noBlockers()` (which emitted `classifyVerdict(EXTERNAL)` → `'open'`) was replaced by routing the `walk.edges.length === 0` case through `makeBlockerFreeResult`, which forces `actionAffordance: 'none'`. The Reader will render no dead action for a blocker-free issue.
- **IN-04 adopt shared degrade constructor (Task 1).** The hand-built `degraded()` object was replaced by `makeDegradedResult(terminal, startId, degradeReason)` via `buildHandlerResult` — every degrade row now flows through the one shared constructor; the `'missing-params'` / `'relations-walk-failed'` degradeReason strings are preserved.
- **WR-03 both call-site guards (Tasks 1 + 2).** Both `flatten-blocker-chain.ts` (walkBlockerChain) and `org-blocked-backlog.ts` (buildEdges) now forward `expectedCadenceMs` to `resolveAgentState` only when it is a positive number (`typeof … === 'number' && … > 0`), else `undefined`. A host `0` (a 0-width stale window) can no longer reach the helper from either builder.
- **IN-03 shared relation-node projection (Task 2).** Extracted `RelationNodeProjection` (the `{ id?, issueId?, key?, assigneeUserId?, ownerUserId?, etaIso?, status?, assigneeAgentId?, lastHeartbeatMs?, lastHeartbeatAt?, hasQueuedWork?, expectedCadenceMs? }` shape) — declared once in `org-blocked-backlog.ts`, imported into `flatten-blocker-chain.ts`. Both walkers now project `summary.blockedBy` with one typed cast; the Reader walker's three chained `as unknown as {...}` casts are gone. Read order + the `?? null` defensive posture are unchanged (type-only refactor).
- **WR-06 single-source viewer-scoping (Task 3).** Extracted `rowTargetsViewer(terminal, viewerUserId)` — the one pure predicate that decides "does this chain await the VIEWER?" (`terminal.kind === 'AWAITING_HUMAN' && terminal.userId === viewerUserId`; UNOWNED and every non-human kind → false; null terminal → false). The `__targetsViewer` flag in `buildOneEmployeeRow` now reads this predicate instead of re-deriving the check inline, so the flag and the needs-you count partition can no longer compute viewer-targeting two ways that a future Terminal-kind change could desync.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened ScrubCtx.logger meta type to stay assignable from the SDK PluginLogger**
- **Found during:** Task 1 (tsc gate)
- **Issue:** The first cut typed `ScrubCtx.logger` as `{ warn?: (msg: string, meta?: unknown) => void }` (copying org-blocked-backlog's stub-friendly shape). But `scrubResultLabel` is called with the real SDK-backed `FlattenBlockerChainCtx`, whose `logger` is `PluginLogger` (`meta?: Record<string, unknown>`). `unknown` is not assignable from `Record<string, unknown>` in the parameter position, so `tsc` errored.
- **Fix:** Typed `ScrubCtx.logger` as `{ warn?: (msg: string, meta?: Record<string, unknown>) => void }`, which is assignable from both the SDK `PluginLogger` and a bare `{ warn() {} }` test stub.
- **Files modified:** src/worker/handlers/flatten-blocker-chain.ts
- **Commit:** 296b40a

No other deviations. The CR-01 scrub mirrors org-blocked-backlog.ts:402-471 exactly; WR-01/WR-03/IN-03/IN-04 followed the plan's chosen approaches; WR-06 took the documented FALLBACK path (engine contract not widened — see Decisions). No authentication gates. No new package installs (threat T-11-06-SC N/A).

## Verification

- `node --test test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` → 8/8 pass, including the NO_UUID_LEAK success-path fixtures (AWAITING_HUMAN / AWAITING_AGENT_STUCK / EXTERNAL / CYCLE / UNOWNED all scrub to zero UUID-pattern matches), the viewer-`You` substitution, the agents.get-throws → `agent#<8>` degrade, the absent-ctx.agents degrade, the WR-01 blocker-free `'none'`, and the preserved UNCLASSIFIED degrade (no `'assign'`).
- `node --test test/worker/situation/build-employees-rollup-viewer-single-source.test.mjs` → 4/4 pass: the `rowTargetsViewer` unit truth-table, the viewer-owned-counts agreement, the UNOWNED-counts-via-assign-but-not-viewer-targeted partition, and the non-viewer → 0 case.
- `node --test test/worker/handlers/flatten-blocker-chain-parity.test.mjs` → 4/4 pass (SC5 nodeMeta parity + the IN-03 single-cast change did not alter the BFS output).
- `node --test test/worker/situation/build-employees-rollup{,-needsyou}.test.mjs` → all pass (no needs-you count regression from the WR-06 refactor).
- Full worker suite (`test/worker/**/*.test.mjs`) → 1043/1044 pass. The single failure is `chat-messages.test.mjs` "U7 WATCHDOG-FIRE-AND-FORGET" — a pre-existing flaky TIMING test (asserts a ~100ms response budget under full-suite parallel load); it passes deterministically in isolation (`node --test test/worker/chat/chat-messages.test.mjs` → 32/32) and touches no file this plan modified. Already logged in `deferred-items.md`.
- `node --test test/shared/blocker-chain.test.mjs` → 21/21 pass (engine untouched; the scrub lives in the worker).
- `npx tsc --noEmit` → 0 errors.
- Acceptance greps: `scrubHumanAction(` present (4×) and `agents.*get` present (7×) in flatten-blocker-chain.ts; `expectedCadenceMs.*> 0` present in BOTH handlers; `RelationNodeProjection` imported/declared in both walkers (3× each); `rowTargetsViewer` present (3×) in build-employees-rollup.ts; `Date.now|new Date` → 0 matches in blocker-chain.ts (engine purity held).

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`. T-11-06-01 (success-path label info-disclosure) is the CR-01 fix and is directly mitigated: the NO_UUID_LEAK fixture asserts zero UUID-pattern matches across all five UUID-bearing kinds. T-11-06-02 (agents.get failure path) is mitigated by the try/catch → `null` degrade (asserted by the throws fixture → `agent#<8>`). T-11-06-03 (cadence=0 false-stuck flood) is mitigated by the WR-03 `> 0` guards at both call sites. No threat flags raised.

## Known Stubs

None. All edits are complete and tested; no placeholder values, no unwired paths. `scrubResultLabel`, `buildHandlerResult`, `RelationNodeProjection`, and `rowTargetsViewer` are exported and exercised by tests. The Wave-3 Reader render consuming the now-scrubbed `awaitedPartyLabel` + `'none'` affordance is the explicit next-wave step (11-07), not a stub.

## For Wave 3 (11-07)

- The Reader's `live-blocker-panel.tsx` now receives an `awaitedPartyLabel` already scrubbed of every raw UUID (CR-01 closed) and `actionAffordance: 'none'` for a blocker-free issue — render the `'none'` affordance as no action button (the dead "Open ↗" is gone for blocker-free rows).

## Self-Check: PASSED

All 5 changed files exist on disk (3 modified handlers/rollup + 2 new test files). All 3 per-task commits are present in git history: 296b40a (Task 1 CR-01 scrub), 91bd710 (Task 2 WR-03 + IN-03), 2afed2c (Task 3 WR-06).
