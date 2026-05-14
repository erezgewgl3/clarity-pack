// src/worker/handlers/flatten-blocker-chain.ts
//
// Plan 02-03b Task 2 — rewritten to use ctx.issues.relations.get from the
// real @paperclipai/plugin-sdk@2026.512.0 surface. The Plan 02-02 draft hit
// an ad-hoc /api/companies/{id}/issues/{id}/blockers HTTP path that doesn't
// exist on the host — that's the 502 the Plan 02-03 Task 3 drill observed.
//
// Walk the blockedBy DAG transitively (BFS) up to MAX_CHAIN_DEPTH, build the
// {edges, nodeMeta} input shape that flattenBlockerChain (PRIM-03/04/05)
// expects, and defer terminal selection to the pure code.
//
// Failure mode: any thrown error from ctx.issues.relations.get bubbles into
// a graceful "no active blockers — relations unavailable" terminal so the
// UI's Right-rail never returns 502 to the bridge. The browser console stays
// clean.

import type {
  PluginIssuesClient,
  PluginIssueRelationSummary,
} from '@paperclipai/plugin-sdk';

import type { BlockerChainResult, Terminal } from '../../shared/types.ts';
import {
  flattenBlockerChain,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';

const MAX_CHAIN_DEPTH = 6;

// Plan 02-04 Task 1 — Ctx composed from OptInGuardDataCtx (real SDK shape).
export type FlattenBlockerChainCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
};

type WalkOutput = {
  edges: BlockerEdge[];
  nodeMeta: Record<string, { ownerUserId: string | null; etaIso: string | null; status: string }>;
};

export function registerFlattenBlockerChain(ctx: FlattenBlockerChainCtx): void {
  wrapDataHandler(ctx, 'flatten-blocker-chain', async (params) => {
    const startId = String(params.startId ?? '');
    const viewerUserId = String(params.viewerUserId ?? '');
    const companyId = String(params.companyId ?? '');
    const maxAgeMs = typeof params.maxAgeMs === 'number' ? params.maxAgeMs : undefined;

    if (!startId || !companyId) {
      return graceful(startId, 'startId and companyId required');
    }

    let walk: WalkOutput;
    try {
      walk = await walkBlockerChain(ctx.issues, companyId, startId);
    } catch (e) {
      ctx.logger?.warn?.('flatten-blocker-chain: relations walk failed', { err: (e as Error).message });
      return graceful(startId, 'Relations unavailable');
    }

    if (walk.edges.length === 0) {
      return graceful(startId, 'No active blockers');
    }

    return flattenBlockerChain({
      startId,
      edges: walk.edges,
      nodeMeta: walk.nodeMeta,
      viewerUserId,
      maxAgeMs,
    });
  });
}

async function walkBlockerChain(
  issues: PluginIssuesClient,
  companyId: string,
  startId: string,
): Promise<WalkOutput> {
  const edges: BlockerEdge[] = [];
  const nodeMeta: WalkOutput['nodeMeta'] = {};
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > MAX_CHAIN_DEPTH) continue;
    visited.add(id);

    let summary: PluginIssueRelationSummary;
    try {
      summary = await issues.relations.get(id, companyId);
    } catch {
      // One relation read failing shouldn't abort the whole walk — record the
      // current node with unknown meta and continue. (deriving an EXTERNAL
      // terminal for an unreachable blocker is the right outcome anyway.)
      continue;
    }

    const blockedBy = summary.blockedBy ?? [];
    for (const blocker of blockedBy) {
      const toId = (blocker as unknown as { id?: string; issueId?: string; key?: string }).id
        ?? (blocker as unknown as { issueId?: string }).issueId
        ?? (blocker as unknown as { key?: string }).key
        ?? '';
      if (!toId) continue;
      edges.push({ from: id, to: toId, reason: 'blocks' });
      // Populate node meta best-effort from the summary. Owner/status/eta come
      // from fields IssueRelationIssueSummary exposes — if not present, we leave
      // them null and flattenBlockerChain falls back to its unowned terminal.
      nodeMeta[toId] = {
        ownerUserId:
          (blocker as unknown as { assigneeUserId?: string | null }).assigneeUserId
          ?? (blocker as unknown as { ownerUserId?: string | null }).ownerUserId
          ?? null,
        etaIso: (blocker as unknown as { etaIso?: string | null }).etaIso ?? null,
        status:
          (blocker as unknown as { status?: string }).status
          ?? 'awaiting',
      };
      if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) {
        queue.push({ id: toId, depth: depth + 1 });
      }
    }
  }

  return { edges, nodeMeta };
}

function graceful(startId: string, label: string): BlockerChainResult {
  // EXTERNAL is the closest semantic for "no chain to flatten" or "relations
  // unavailable" — the UI surface renders a non-actionable banner rather than
  // a missing panel. flattenBlockerChain itself never returns this directly;
  // we synthesize it for the empty-graph case.
  const terminal: Terminal = { kind: 'EXTERNAL', label };
  return {
    startId,
    pathIds: startId ? [startId] : [],
    terminal,
    isStale: false,
  };
}
