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
 * Flatten a blocker-edge graph to its terminal. Deterministic DFS:
 *   - Stops at the first node with no outgoing edges (or only external edges) — leaf
 *   - Stops on revisit of a node already on the current path stack — cycle
 *   - Terminal selection follows a fixed priority: EXTERNAL (if final edge.reason ===
 *     'external') > HUMAN_ACTION_ON (leaf has owner + status='awaiting') > SELF_RESOLVING
 *     (leaf has etaIso + no owner) > HUMAN_ACTION_ON fallback ('__unowned__').
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
      return {
        startId: input.startId,
        pathIds: [...pathIds, current],
        terminal,
        isStale: false,
      };
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
        return {
          startId: input.startId,
          pathIds,
          terminal,
          isStale: false,
        };
      }
      // Also fire EXTERNAL when the leaf's only outgoing edges are external
      // (i.e., it has external children we won't recurse into).
      if (outgoing.length > 0 && outgoing.every((e) => e.reason === 'external')) {
        const externalEdge = outgoing[0]!;
        const terminal: Terminal = {
          kind: 'EXTERNAL',
          label: `External (${externalEdge.to})`,
        };
        return {
          startId: input.startId,
          pathIds,
          terminal,
          isStale: false,
        };
      }
      if (meta?.ownerUserId != null && meta.status === 'awaiting') {
        const terminal: Terminal = {
          kind: 'HUMAN_ACTION_ON',
          userId: meta.ownerUserId,
          label: `${meta.ownerUserId} to act on ${current}`,
        };
        return {
          startId: input.startId,
          pathIds,
          terminal,
          isStale: false,
        };
      }
      if (meta?.etaIso != null && meta.ownerUserId == null) {
        const terminal: Terminal = {
          kind: 'SELF_RESOLVING',
          etaIso: meta.etaIso,
          label: `Self-resolving by ${meta.etaIso}`,
        };
        return {
          startId: input.startId,
          pathIds,
          terminal,
          isStale: false,
        };
      }
      // Fallback: deterministic unowned terminal. Better than throwing —
      // surfaces render "Owner unknown — assign first" and the operator
      // can act on it.
      const terminal: Terminal = {
        kind: 'HUMAN_ACTION_ON',
        userId: '__unowned__',
        label: `Owner unknown — assign ${current} first`,
      };
      return { startId: input.startId, pathIds, terminal, isStale: false };
    }

    // Continue walking — take the first (lexicographically smallest by `to`)
    // continuing edge. Deterministic because adj edges were sorted above.
    lastEdge = continuingEdges[0]!;
    current = lastEdge.to;
  }

  // Safety fallthrough: maxSteps exceeded. Treat as cycle for honesty.
  const terminal: Terminal = {
    kind: 'CYCLE',
    cycleNodes: pathIds,
    label: `Cycle (depth-limit exceeded after ${maxSteps} steps)`,
  };
  return { startId: input.startId, pathIds, terminal, isStale: false };
}

/**
 * Plan 07-03 Task 1 — single source of truth for the HUMAN_ACTION_ON-first
 * ranking. MOVED here verbatim from the recompute-situation job
 * (src/worker/jobs/situation-snapshot.ts:286-303) so the job AND the new
 * org-blocked-backlog handler share one definition. Behavior is byte-identical
 * to the prior private function — the job now imports this instead of declaring
 * its own.
 *
 * Priority: HUMAN_ACTION_ON=0 > SELF_RESOLVING=1 > EXTERNAL=2 > CYCLE=3
 * (default 99). Stable sort by priority, then slice(0, max). Pure — does not
 * mutate the input array.
 */
export function pickTopChains(
  chains: BlockerChainResult[],
  max: number,
): BlockerChainResult[] {
  const priority = (c: BlockerChainResult): number => {
    switch (c.terminal.kind) {
      case 'HUMAN_ACTION_ON':
        return 0;
      case 'SELF_RESOLVING':
        return 1;
      case 'EXTERNAL':
        return 2;
      case 'CYCLE':
        return 3;
      default:
        return 99;
    }
  };
  return [...chains].sort((a, b) => priority(a) - priority(b)).slice(0, max);
}
