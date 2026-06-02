// src/shared/blocker-chain.ts
//
// Plan 02-02 Task 1 — PRIM-03 (deterministic DFS, no model inference), PRIM-04 (cycle
// detection terminal), PRIM-05 (HUMAN_ACTION_ON terminal). Pure graph code;
// every code path resolves to one of the four canonical Terminal variants.
//
// Critical contract (PRIM-03 from PROJECT.md): terminal selection is pure
// graph code — no AI inference of any kind. The Editor-Agent (Plan 02-03) may
// later write prose SUMMARIZING the result, but the choice of which terminal
// fires is owned entirely by this file's deterministic walk. A grep guard in
// test/shared/blocker-chain.test.mjs enforces the boundary by scanning this
// source for AI-vendor tokens; any match fails the build.

import type { BlockerChainResult, Terminal } from './types.ts';

export type BlockerEdge = {
  from: string;
  to: string;
  reason: 'blocks' | 'awaiting' | 'external';
};

export type BlockerChainInput = {
  startId: string;
  edges: BlockerEdge[];
  nodeMeta: Record<
    string,
    {
      ownerUserId: string | null;
      etaIso: string | null;
      status: string;
      // Plan 11-01 (D-01) — agent ownership + pre-resolved liveness, injected by
      // the worker (the engine reads NO clock). assigneeAgentId lets the walk
      // classify an agent-owned leaf; agentState is the worker's heartbeat-age
      // projection ('working' | 'stuck'). Optional + defaulting to null keeps
      // every pre-11-01 caller type-clean and falls through to UNOWNED.
      assigneeAgentId?: string | null;
      agentState?: 'working' | 'stuck' | null;
    }
  >;
  viewerUserId: string;
  maxAgeMs?: number;
};

/** Format a chain path like "A → B → C" for terminal labels. */
function arrowPath(ids: string[]): string {
  return ids.join(' → ');
}

/**
 * Plan 11-01 (D-14) — the pure verdict mapping. Encodes the design-seed
 * Section 1 table 1:1: each of the 8 honest terminal kinds maps to exactly one
 * {tier, actionAffordance, needsYou} triple. The exhaustive `switch` + the
 * `const _exhaustive: never` guard make a future 9th kind a compile error
 * (the established total-function-over-the-union idiom; mirrors
 * humanize-snapshot.ts and classify-employee-state.ts).
 *
 * Pure: no SDK import, no I/O, no wall-clock read. The only input is the
 * terminal's discriminant — output is deterministic per kind.
 */
export function classifyVerdict(terminal: Terminal): {
  tier: BlockerChainResult['tier'];
  actionAffordance: BlockerChainResult['actionAffordance'];
  needsYou: boolean;
} {
  switch (terminal.kind) {
    case 'AWAITING_HUMAN':
      return { tier: 'needs-you', actionAffordance: 'reply', needsYou: true };
    case 'AWAITING_AGENT_WORKING':
      return { tier: 'in-motion', actionAffordance: 'none', needsYou: false };
    case 'AWAITING_AGENT_STUCK':
      return { tier: 'watch', actionAffordance: 'nudge', needsYou: false };
    case 'SELF_RESOLVING':
      return { tier: 'watch', actionAffordance: 'none', needsYou: false };
    case 'EXTERNAL':
      return { tier: 'watch', actionAffordance: 'open', needsYou: false };
    case 'CYCLE':
      return { tier: 'watch', actionAffordance: 'open', needsYou: false };
    case 'UNOWNED':
      return { tier: 'needs-you', actionAffordance: 'assign', needsYou: true };
    case 'UNCLASSIFIED':
      return { tier: 'watch', actionAffordance: 'open', needsYou: false };
    default: {
      // Exhaustiveness — TS narrows to `never`. A new kind fails the build here.
      const _exhaustive: never = terminal;
      throw new Error(`classifyVerdict: unhandled terminal kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Plan 11-01 — build the enriched BlockerChainResult from a terminal. Computes
 * the verdict triple via classifyVerdict, passes the terminal's display label
 * through as awaitedPartyLabel (final UUID scrub happens in scrub-human-action.ts),
 * and derives the mutation-only split-identity ids (D-15): targetAgentUuid from
 * an AWAITING_AGENT_* agentId, targetIssueUuid from the leaf node id. Pure.
 */
function makeResult(args: {
  startId: string;
  pathIds: string[];
  terminal: Terminal;
  isStale: boolean;
  leafId: string;
  degradeReason?: string;
}): BlockerChainResult {
  const { startId, pathIds, terminal, isStale, leafId, degradeReason } = args;
  const verdict = classifyVerdict(terminal);
  const targetAgentUuid =
    terminal.kind === 'AWAITING_AGENT_WORKING' || terminal.kind === 'AWAITING_AGENT_STUCK'
      ? terminal.agentId
      : null;
  return {
    startId,
    pathIds,
    terminal,
    isStale,
    needsYou: verdict.needsYou,
    tier: verdict.tier,
    actionAffordance: verdict.actionAffordance,
    awaitedPartyLabel: terminal.label,
    targetAgentUuid,
    targetIssueUuid: leafId,
    ...(degradeReason != null ? { degradeReason } : {}),
  };
}

/**
 * Plan 11-05 (IN-04) — the SINGLE shared degrade-row constructor. The worker
 * handlers (flatten-blocker-chain.ts degraded(), org-blocked-backlog.ts) hand-built
 * three near-identical BlockerChainResult objects for the UNCLASSIFIED degrade path;
 * a future verdict field added to BlockerChainResult could be silently missed by one
 * of them. Routing every degrade row through this one helper closes that gap
 * (Wave 2 adopts it). Mirrors makeResult's assembly: classifyVerdict-derived verdict,
 * pathIds = [startId] when present, isStale false, leafId = startId, targetAgentUuid
 * null, targetIssueUuid = startId (or null when startId is empty).
 *
 * Pure: no clock, no I/O, no AI tokens.
 */
export function makeDegradedResult(
  terminal: Terminal,
  startId: string,
  degradeReason?: string,
): BlockerChainResult {
  const verdict = classifyVerdict(terminal);
  return {
    startId,
    pathIds: startId ? [startId] : [],
    terminal,
    isStale: false,
    needsYou: verdict.needsYou,
    tier: verdict.tier,
    actionAffordance: verdict.actionAffordance,
    awaitedPartyLabel: terminal.label,
    targetAgentUuid: null,
    targetIssueUuid: startId || null,
    ...(degradeReason != null ? { degradeReason } : {}),
  };
}

/**
 * Plan 11-05 (WR-01 root) — the GENUINELY-blocker-free row. The walk succeeded and
 * found no edges: this is NOT a blocker, NOT a degrade, and must NOT surface an
 * action. We deliberately OVERRIDE the affordance to 'none' rather than route the
 * synthetic EXTERNAL terminal through classifyVerdict, because classifyVerdict maps
 * EXTERNAL → 'open' BY DESIGN (a real external blocker is openable — see WR-01 in
 * 11-REVIEW.md). Only the blocker-free synthetic case is non-actionable; the EXTERNAL
 * → 'open' mapping for genuine externals is intentionally left untouched. The
 * resulting row is tier 'watch', needsYou false, affordance 'none' — the Reader
 * renders a quiet "no active blockers" state with no dead "Open ↗" button.
 *
 * The terminal kind stays EXTERNAL so the per-kind ranking (pickTopChains) and the
 * scrub treat it uniformly; only the verdict triple is forced non-actionable.
 *
 * Pure: no clock, no I/O, no AI tokens.
 */
export function makeBlockerFreeResult(startId: string, label: string): BlockerChainResult {
  const terminal: Terminal = { kind: 'EXTERNAL', label };
  return {
    startId,
    pathIds: startId ? [startId] : [],
    terminal,
    isStale: false,
    // WR-01: forced non-actionable verdict — NOT classifyVerdict(terminal), which
    // would return 'open'. A blocker-free issue offers no control.
    needsYou: false,
    tier: 'watch',
    actionAffordance: 'none',
    awaitedPartyLabel: label,
    targetAgentUuid: null,
    targetIssueUuid: startId || null,
  };
}

/**
 * Flatten a blocker-edge graph to its terminal. Deterministic DFS:
 *   - Stops at the first node with no outgoing edges (or only external edges) — leaf
 *   - Stops on revisit of a node already on the current path stack — cycle
 *   - Leaf terminal selection follows the D-07 awaiting-first cascade: EXTERNAL
 *     (final edge.reason === 'external' or only-external children) > AWAITING_HUMAN
 *     (status === 'awaiting') > AWAITING_HUMAN (ownerUserId present) > AWAITING_AGENT_*
 *     (assigneeAgentId present; WORKING if agentState === 'working', else STUCK per
 *     D-04 conservative-stuck) > SELF_RESOLVING (etaIso + no owner) > UNOWNED.
 *   - maxSteps-exceeded degrades to UNCLASSIFIED (D-10); a real revisit is CYCLE.
 *
 * Output bytes are identical across invocations with the same input — the
 * determinism test runs the function 100 times and asserts JSON.stringify equality.
 */
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

  // DFS with explicit path stack to allow cycle detection.
  const pathIds: string[] = [];
  const onPath = new Set<string>();
  let lastEdge: BlockerEdge | null = null;
  let current = input.startId;
  // Bound the walk defensively — even a cycle should be caught quickly, but
  // a malformed graph with many duplicates shouldn't be able to OOM the worker.
  const maxSteps = 10_000;
  let steps = 0;

  while (steps < maxSteps) {
    steps += 1;
    if (onPath.has(current)) {
      // Cycle: slice from the first occurrence of `current` to the end,
      // then rotate so the smallest id is first (canonical form for determinism).
      const cycleStartIdx = pathIds.indexOf(current);
      const rawCycle = pathIds.slice(cycleStartIdx);
      rawCycle.push(current);
      const smallest = rawCycle.slice(0, -1).reduce(
        (min, id) => (id < min ? id : min),
        rawCycle[0]!,
      );
      const rotateFrom = rawCycle.indexOf(smallest);
      const canonical = [
        ...rawCycle.slice(rotateFrom, -1),
        ...rawCycle.slice(0, rotateFrom),
      ];
      canonical.push(canonical[0]!); // close the loop in the label
      const terminal: Terminal = {
        kind: 'CYCLE',
        cycleNodes: canonical,
        label: `Cycle: ${arrowPath(canonical)}`,
      };
      return makeResult({
        startId: input.startId,
        pathIds: [...pathIds, current],
        terminal,
        isStale: false,
        leafId: current,
      });
    }
    pathIds.push(current);
    onPath.add(current);

    const outgoing = adj.get(current) ?? [];
    // Filter out 'external' edges from "do we continue walking" — they signal
    // a terminal-leaf-via-external rather than a node to recurse into.
    const continuingEdges = outgoing.filter((e) => e.reason !== 'external');
    if (continuingEdges.length === 0) {
      // Leaf — choose terminal kind from this leaf's nodeMeta + the edge that
      // brought us here.
      const meta = input.nodeMeta[current];
      const lastReason = lastEdge?.reason;
      // EXTERNAL takes precedence: if the edge into this leaf was reason='external'
      // (and we arrived because no continuing edge existed beyond), emit EXTERNAL.
      // Note: when a node has BOTH external and non-external outgoing edges, the
      // walk follows the non-external one (by filter above) — so EXTERNAL fires
      // only when the leaf itself was reached via an external edge.
      if (lastReason === 'external') {
        const terminal: Terminal = {
          kind: 'EXTERNAL',
          label: `External (${current})`,
        };
        return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
      }
      // Also fire EXTERNAL when the leaf's only outgoing edges are external
      // (i.e., it has external children we won't recurse into).
      // WR-05 (Plan 11-05): label names `current` (the leaf / leafId), NOT
      // externalEdge.to (a refused child we never walked into). The leaf reached
      // IS the terminal node — labeling the child mis-attributed targetIssueUuid
      // (which is leafId === current) to a different id, leaking a node the chain
      // never resolved to. Both EXTERNAL branches now name the same node.
      if (outgoing.length > 0 && outgoing.every((e) => e.reason === 'external')) {
        const terminal: Terminal = {
          kind: 'EXTERNAL',
          label: `External (${current})`,
        };
        return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
      }
      // D-07 awaiting-first cascade. The explicit `status === 'awaiting'` branch
      // stays FIRST so awaiting beats agent ownership — a person is being waited
      // on even if an agent is nominally assigned.
      if (meta?.status === 'awaiting' && meta.ownerUserId != null) {
        const terminal: Terminal = {
          kind: 'AWAITING_HUMAN',
          userId: meta.ownerUserId,
          label: `${meta.ownerUserId} to act on ${current}`,
        };
        return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
      }
      // Widened (was gated on status==='awaiting'): a user owner alone ⇒ a person
      // is the awaited party.
      if (meta?.ownerUserId != null) {
        const terminal: Terminal = {
          kind: 'AWAITING_HUMAN',
          userId: meta.ownerUserId,
          label: `${meta.ownerUserId} to act on ${current}`,
        };
        return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
      }
      // Agent ownership — the walk has flattened to an agent-owned leaf. WORKING
      // when the worker-resolved liveness says 'working'; otherwise STUCK (D-04:
      // a missing/null signal is conservatively treated as stuck so a silently
      // idle agent surfaces a nudge rather than false reassurance).
      if (meta?.assigneeAgentId != null) {
        const terminal: Terminal =
          meta.agentState === 'working'
            ? {
                kind: 'AWAITING_AGENT_WORKING',
                agentId: meta.assigneeAgentId,
                label: `${meta.assigneeAgentId} working on ${current}`,
              }
            : {
                kind: 'AWAITING_AGENT_STUCK',
                agentId: meta.assigneeAgentId,
                label: `${meta.assigneeAgentId} stuck on ${current}`,
              };
        return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
      }
      if (meta?.etaIso != null && meta.ownerUserId == null) {
        const terminal: Terminal = {
          kind: 'SELF_RESOLVING',
          etaIso: meta.etaIso,
          label: `Self-resolving by ${meta.etaIso}`,
        };
        return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
      }
      // Genuinely unowned (D-11) — a real UNOWNED terminal carrying NO userId.
      // This is the ONLY place "assign an owner" is honest. Replaces the old
      // unowned-sentinel fallback lie.
      const terminal: Terminal = {
        kind: 'UNOWNED',
        label: `Owner unknown — assign ${current} first`,
      };
      return makeResult({ startId: input.startId, pathIds, terminal, isStale: false, leafId: current });
    }

    // Continue walking — take the first (lexicographically smallest by `to`)
    // continuing edge. Deterministic because adj edges were sorted above.
    lastEdge = continuingEdges[0]!;
    current = lastEdge.to;
  }

  // Safety fallthrough: maxSteps exceeded. We could not determine the blocker
  // within the bound — degrade honestly to UNCLASSIFIED (D-10) rather than
  // mislabel it a CYCLE (real revisit detection above still emits CYCLE).
  const terminal: Terminal = {
    kind: 'UNCLASSIFIED',
    label: `Can't determine blocker for ${input.startId} — open to investigate`,
  };
  return makeResult({
    startId: input.startId,
    pathIds,
    terminal,
    isStale: false,
    leafId: current,
    degradeReason: 'max-depth-exceeded',
  });
}

/**
 * Plan 07-03 Task 1 — single source of truth for the needs-you-first ranking.
 * MOVED here from the recompute-situation job so the job AND the
 * org-blocked-backlog handler share one definition.
 *
 * Plan 11-01 (D-07 / Pitfall 6) — re-ranked for the 8-kind union so needs-you
 * kinds lead and no new kind falls through to default. Priority order:
 *   AWAITING_HUMAN=0 > UNOWNED=1 > SELF_RESOLVING=2 > AWAITING_AGENT_WORKING=3 >
 *   AWAITING_AGENT_STUCK=4 > EXTERNAL=5 > CYCLE=6 > UNCLASSIFIED=7 (default 99).
 * Stable copy-then-sort by priority, then slice(0, max). Pure — does not mutate
 * the input array.
 */
export function pickTopChains(
  chains: BlockerChainResult[],
  max: number,
): BlockerChainResult[] {
  const priority = (c: BlockerChainResult): number => {
    switch (c.terminal.kind) {
      case 'AWAITING_HUMAN':
        return 0;
      case 'UNOWNED':
        return 1;
      case 'SELF_RESOLVING':
        return 2;
      case 'AWAITING_AGENT_WORKING':
        return 3;
      case 'AWAITING_AGENT_STUCK':
        return 4;
      case 'EXTERNAL':
        return 5;
      case 'CYCLE':
        return 6;
      case 'UNCLASSIFIED':
        return 7;
      default:
        return 99;
    }
  };
  return [...chains].sort((a, b) => priority(a) - priority(b)).slice(0, max);
}
