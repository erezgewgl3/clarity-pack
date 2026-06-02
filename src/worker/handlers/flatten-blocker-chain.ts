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
  classifyVerdict,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
// Plan 11-02 Task 3 (D-01 / SC5) — the SINGLE worker-side liveness projection,
// shared with buildEdges (org-blocked-backlog.ts). The engine reads no clock;
// the worker resolves working/stuck here and injects the string into nodeMeta,
// so the Reader panel classifies an agent-owned leaf identically to the
// Situation Room (SC5 — both BFS builders agree on the nodeMeta shape).
import { resolveAgentState } from '../situation/agent-liveness.ts';

const MAX_CHAIN_DEPTH = 6;

// Plan 02-04 Task 1 — Ctx composed from OptInGuardDataCtx (real SDK shape).
export type FlattenBlockerChainCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
};

// Plan 11-02 Task 3 (SC5) — the nodeMeta field set MUST match buildEdges'
// EdgeNodeMeta (org-blocked-backlog.ts) EXACTLY, so the same chain classifies
// identically across the Reader and the Situation Room. The keep-in-sync
// decision (RESEARCH Open Question 1) threads the identical field set here
// rather than collapsing the two builders this wave; a same-shape test pins it.
type WalkOutput = {
  edges: BlockerEdge[];
  nodeMeta: Record<
    string,
    {
      ownerUserId: string | null;
      etaIso: string | null;
      status: string;
      assigneeAgentId: string | null;
      agentState: 'working' | 'stuck' | null;
    }
  >;
};

export function registerFlattenBlockerChain(ctx: FlattenBlockerChainCtx): void {
  wrapDataHandler(ctx, 'flatten-blocker-chain', async (params) => {
    const startId = String(params.startId ?? '');
    const viewerUserId = String(params.viewerUserId ?? '');
    const companyId = String(params.companyId ?? '');
    const maxAgeMs = typeof params.maxAgeMs === 'number' ? params.maxAgeMs : undefined;

    if (!startId || !companyId) {
      // Plan 11-02 (D-10/TAX-03) — a missing-params WALK FAILURE is honest
      // UNCLASSIFIED, never a false EXTERNAL chase-action.
      return degraded(startId, 'startId and companyId required', 'missing-params');
    }

    let walk: WalkOutput;
    try {
      walk = await walkBlockerChain(ctx.issues, companyId, startId);
    } catch (e) {
      // Plan 11-02 (D-10/TAX-03) — a thrown relations walk is UNCLASSIFIED, not
      // EXTERNAL: the walk FAILED, so we cannot honestly claim the blocker is
      // external. Surface the degrade with a reason.
      ctx.logger?.warn?.('flatten-blocker-chain: relations walk failed', { err: (e as Error).message });
      return degraded(startId, 'Relations unavailable', 'relations-walk-failed');
    }

    if (walk.edges.length === 0) {
      // GENUINELY no blockers (Pitfall 3) — distinct from a walk failure. Keep
      // the empty-graph EXTERNAL terminal so the UI renders its non-actionable
      // "no active blockers" state; do NOT relabel a blocker-free issue as a
      // degrade.
      return noBlockers(startId, 'No active blockers');
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

// Plan 11-02 Task 3 — EXPORTED so a same-shape test can assert this BFS emits
// the identical nodeMeta field set as buildEdges (SC5). The `issues` parameter
// is structurally typed, so the test stubs it without the SDK.
export async function walkBlockerChain(
  issues: PluginIssuesClient,
  companyId: string,
  startId: string,
): Promise<WalkOutput> {
  const edges: BlockerEdge[] = [];
  const nodeMeta: WalkOutput['nodeMeta'] = {};
  const nowMs = Date.now();
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  // Plan 11-02 Task 3 (SC5) — mirror buildEdges' root-throw semantics: a thrown
  // relations.get on the ROOT means we cannot build any chain, so it PROPAGATES
  // and the handler degrades to UNCLASSIFIED (D-10, not the old EXTERNAL lie).
  // A throw on an INNER node is swallowed so the rest of the graph survives.
  let isRoot = true;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > MAX_CHAIN_DEPTH) continue;
    visited.add(id);

    let summary: PluginIssueRelationSummary;
    try {
      summary = await issues.relations.get(id, companyId);
    } catch (e) {
      if (isRoot) throw e; // root failure ⇒ handler emits UNCLASSIFIED
      // Inner relation read failing shouldn't abort the whole walk — skip just
      // that node; the rest of the graph survives.
      continue;
    } finally {
      isRoot = false;
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
      // Plan 11-02 Task 3 (D-01 / SC5) — also capture assigneeAgentId + the
      // worker-resolved agentState, EXACTLY mirroring buildEdges' field set, so
      // an agent-owned leaf classifies AWAITING_AGENT_* identically on both
      // surfaces. Every read keeps the defensive `?? null` posture (Pitfall 7).
      const b = blocker as unknown as {
        assigneeUserId?: string | null;
        ownerUserId?: string | null;
        etaIso?: string | null;
        status?: string;
        assigneeAgentId?: string | null;
        lastHeartbeatMs?: number | null;
        lastHeartbeatAt?: string | null;
        hasQueuedWork?: boolean | null;
        expectedCadenceMs?: number | null;
      };
      const assigneeAgentId = b.assigneeAgentId ?? null;
      const lastHeartbeatMs =
        typeof b.lastHeartbeatMs === 'number'
          ? b.lastHeartbeatMs
          : typeof b.lastHeartbeatAt === 'string'
            ? (() => {
                const t = Date.parse(b.lastHeartbeatAt as string);
                return Number.isFinite(t) ? t : null;
              })()
            : null;
      const agentState: 'working' | 'stuck' | null =
        assigneeAgentId == null
          ? null
          : resolveAgentState({
              lastHeartbeatMs,
              hasQueuedWork: b.hasQueuedWork === true,
              nowMs,
              expectedCadenceMs:
                typeof b.expectedCadenceMs === 'number' ? b.expectedCadenceMs : undefined,
            });
      nodeMeta[toId] = {
        ownerUserId: b.assigneeUserId ?? b.ownerUserId ?? null,
        etaIso: b.etaIso ?? null,
        status: b.status ?? 'awaiting',
        assigneeAgentId,
        agentState,
      };
      if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) {
        queue.push({ id: toId, depth: depth + 1 });
      }
    }
  }

  return { edges, nodeMeta };
}

/**
 * Plan 11-02 Task 3 (D-10 / TAX-03 / Pitfall 3) — a WALK FAILURE (missing
 * params, thrown relations.get) is honestly UNCLASSIFIED. It carries a
 * degradeReason and the classifyVerdict-derived verdict (tier 'watch',
 * affordance 'open', needsYou false), so the UI renders an honest
 * "can't determine — open to investigate" panel rather than a false EXTERNAL
 * chase-action. The fields mirror the engine's makeResult shape.
 */
function degraded(startId: string, label: string, degradeReason: string): BlockerChainResult {
  const terminal: Terminal = { kind: 'UNCLASSIFIED', label };
  const verdict = classifyVerdict(terminal);
  return {
    startId,
    pathIds: startId ? [startId] : [],
    terminal,
    isStale: false,
    needsYou: verdict.needsYou,
    tier: verdict.tier,
    actionAffordance: verdict.actionAffordance,
    awaitedPartyLabel: label,
    targetAgentUuid: null,
    targetIssueUuid: startId || null,
    degradeReason,
  };
}

/**
 * Plan 11-02 Task 3 (Pitfall 3) — the GENUINELY-blocker-free case (the walk
 * succeeded and found no edges). This is DISTINCT from a walk failure: the
 * EXTERNAL terminal renders the UI's non-actionable "no active blockers" state,
 * and is NOT relabeled UNCLASSIFIED (a blocker-free issue is not a degrade).
 */
function noBlockers(startId: string, label: string): BlockerChainResult {
  const terminal: Terminal = { kind: 'EXTERNAL', label };
  const verdict = classifyVerdict(terminal);
  return {
    startId,
    pathIds: startId ? [startId] : [],
    terminal,
    isStale: false,
    needsYou: verdict.needsYou,
    tier: verdict.tier,
    actionAffordance: verdict.actionAffordance,
    awaitedPartyLabel: label,
    targetAgentUuid: null,
    targetIssueUuid: startId || null,
  };
}
