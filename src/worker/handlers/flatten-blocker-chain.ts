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
  makeDegradedResult,
  makeBlockerFreeResult,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
// Plan 11-06 Task 1 (CR-01 / D-15 / NO_UUID_LEAK) — the success-path scrub. This
// handler is the LAST place to strip raw UUIDs before awaitedPartyLabel crosses
// the bridge into the Reader DOM. Mirrors org-blocked-backlog.ts:402-471 exactly:
// resolve a nameByUuid map from ctx.agents, then overwrite awaitedPartyLabel with
// scrubHumanAction(result.terminal, viewerUserId, nameByUuid).
import { scrubHumanAction, UUID_RE_G } from '../../shared/scrub-human-action.ts';
import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
// Plan 11-02 Task 3 (D-01 / SC5) — the SINGLE worker-side liveness projection,
// shared with buildEdges (org-blocked-backlog.ts). The engine reads no clock;
// the worker resolves working/stuck here and injects the string into nodeMeta,
// so the Reader panel classifies an agent-owned leaf identically to the
// Situation Room (SC5 — both BFS builders agree on the nodeMeta shape).
import { resolveAgentState } from '../situation/agent-liveness.ts';
// Plan 11-06 Task 2 (IN-03) — the SINGLE relation-node projection shape, declared
// once in org-blocked-backlog.ts and shared by both BFS walkers so the SC5
// "two builders agree" claim is honest at the type level (replaces this file's
// triple `as unknown as {...}` casts).
import type { RelationNodeProjection } from './org-blocked-backlog.ts';

const MAX_CHAIN_DEPTH = 6;

// Plan 02-04 Task 1 — Ctx composed from OptInGuardDataCtx (real SDK shape).
// Plan 11-06 Task 1 (CR-01) — widen with the OPTIONAL agents.get surface (mirrors
// OrgBlockedBacklogCtx). The structural ctx carries agents.get so the success-path
// scrub can resolve UUID→name. When ctx.agents is absent the scrub falls through an
// empty map and still degrades to agent#<8> — NEVER the raw UUID.
export type FlattenBlockerChainCtx = OptInGuardDataCtx & {
  issues: PluginIssuesClient;
  agents?: {
    get(agentId: string, companyId: string): Promise<unknown | null>;
  };
};

/** The structural ctx subset scrubResultLabel needs — only the optional
 *  agents.get. Stubbable in tests without the SDK. */
export type ScrubCtx = {
  agents?: {
    get(agentId: string, companyId: string): Promise<unknown | null>;
  };
  // meta typed as Record<string, unknown> to stay assignable from the SDK's
  // PluginLogger (FlattenBlockerChainCtx.logger) AND a bare test stub.
  logger?: { warn?: (msg: string, meta?: Record<string, unknown>) => void };
};

/** True iff `s` is exactly a hex UUID (strict, full string). Mirrors
 *  org-blocked-backlog.ts:75. */
function isUuid(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  );
}

/** Every distinct hex UUID inside an arbitrary string. Mirrors
 *  org-blocked-backlog.ts:80. */
function uuidsIn(s: string): string[] {
  return s.match(UUID_RE_G) ?? [];
}

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
      // UNCLASSIFIED, never a false EXTERNAL chase-action. The degrade label is
      // UUID-safe by construction, so no scrub is needed on this path.
      return buildHandlerResult({
        startId,
        viewerUserId,
        degrade: { label: 'startId and companyId required', reason: 'missing-params' },
      });
    }

    let walk: WalkOutput;
    try {
      walk = await walkBlockerChain(ctx.issues, companyId, startId);
    } catch (e) {
      // Plan 11-02 (D-10/TAX-03) — a thrown relations walk is UNCLASSIFIED, not
      // EXTERNAL: the walk FAILED, so we cannot honestly claim the blocker is
      // external. Surface the degrade with a reason.
      ctx.logger?.warn?.('flatten-blocker-chain: relations walk failed', { err: (e as Error).message });
      return buildHandlerResult({
        startId,
        viewerUserId,
        degrade: { label: 'Relations unavailable', reason: 'relations-walk-failed' },
      });
    }

    // buildHandlerResult routes the blocker-free case → 'none' (WR-01), the
    // blocked-no-edge case → the engine (Plan 12-08, raw label with UUIDs), and
    // the success case → flattenBlockerChain (raw label). Any path whose terminal
    // label can embed a raw UUID MUST be scrubbed via scrubResultLabel BEFORE
    // return — the CR-01 + 12-08 NO_UUID_LEAK fix.
    const result = buildHandlerResult({ startId, viewerUserId, walk, maxAgeMs });
    // Plan 12-08 — the ONLY path that is UUID-safe by construction is the
    // genuinely-blocker-free EXTERNAL 'none' row (its label is the literal "No
    // active blockers"). Detect it by the forced non-actionable verdict and skip
    // the (unnecessary) agents resolution; everything else (success chains AND
    // the new blocked-no-edge terminals) gets scrubbed.
    const isBlockerFreeLiteral =
      result.terminal.kind === 'EXTERNAL' &&
      result.actionAffordance === 'none' &&
      result.awaitedPartyLabel === 'No active blockers';
    if (isBlockerFreeLiteral) {
      return result;
    }
    return scrubResultLabel(ctx, companyId, viewerUserId, result);
  });
}

/**
 * Plan 11-06 Task 1 (CR-01 / D-15 / NO_UUID_LEAK) — the SUCCESS-PATH scrub.
 *
 * THE leak fix: flattenBlockerChain returns awaitedPartyLabel = terminal.label
 * RAW (the engine is pure and does no I/O lookup). This handler is the last hop
 * before the value crosses the bridge into the Reader DOM, so it resolves a
 * nameByUuid map from ctx.agents and overwrites awaitedPartyLabel with
 * scrubHumanAction(...). Mirrors org-blocked-backlog.ts:402-471 EXACTLY:
 *   - collect the owner uuid (AWAITING_HUMAN userId when isUuid), the agent uuid
 *     (AWAITING_AGENT_* agentId), and every UUID uuidsIn(terminal.label) finds
 *     (covers the leaf node id),
 *   - for each wanted uuid call ctx.agents.get(uuid, companyId) inside try/catch,
 *     set the trimmed name or null, NEVER the raw UUID on throw,
 *   - return { ...result, awaitedPartyLabel: scrubHumanAction(terminal, viewer, map) }.
 *
 * When ctx.agents is absent the map stays empty and the scrub degrades every UUID
 * to agent#<8> — still NO_UUID_LEAK-safe.
 */
export async function scrubResultLabel(
  ctx: ScrubCtx,
  companyId: string,
  viewerUserId: string,
  result: BlockerChainResult,
): Promise<BlockerChainResult> {
  const terminal = result.terminal;
  const nameByUuid = new Map<string, string | null>();

  if (typeof ctx.agents?.get === 'function') {
    const wanted = new Set<string>();
    // Owner uuid (AWAITING_HUMAN) — only resolve when it is a real UUID; the
    // viewer "You" substitution itself uses terminal.userId.
    if (terminal.kind === 'AWAITING_HUMAN' && isUuid(terminal.userId)) {
      wanted.add(terminal.userId);
    }
    // Agent uuid (AWAITING_AGENT_WORKING / AWAITING_AGENT_STUCK).
    if (
      (terminal.kind === 'AWAITING_AGENT_WORKING' || terminal.kind === 'AWAITING_AGENT_STUCK') &&
      isUuid(terminal.agentId)
    ) {
      wanted.add(terminal.agentId);
    }
    // Every UUID the terminal label embeds (covers the leaf node id + any other).
    for (const u of uuidsIn(terminal.label)) wanted.add(u);

    for (const uuid of wanted) {
      try {
        const agent = await ctx.agents.get(uuid, companyId);
        if (agent && typeof (agent as { name?: unknown }).name === 'string') {
          const candidate = (agent as { name: string }).name.trim();
          nameByUuid.set(uuid, candidate || null);
        } else {
          nameByUuid.set(uuid, null);
        }
      } catch (e) {
        // D-09 — degrade silently to null on throw. NEVER fall back to the UUID;
        // the scrubber then emits agent#<8>. This is the NO_UUID_LEAK guarantee.
        ctx.logger?.warn?.('flatten-blocker-chain: agents.get failed', {
          companyId,
          uuid,
          err: (e as Error).message,
        });
        nameByUuid.set(uuid, null);
      }
    }
  }

  return { ...result, awaitedPartyLabel: scrubHumanAction(terminal, viewerUserId, nameByUuid) };
}

/**
 * Plan 11-06 Task 1 — the pure result router for the handler, exported so the
 * WR-01 ('none') and degrade paths are unit-testable without the opt-in guard.
 *
 * Three mutually-exclusive inputs:
 *   - degrade  → makeDegradedResult (UNCLASSIFIED; honest open-to-investigate, IN-04)
 *   - walk with 0 edges → makeBlockerFreeResult (forced actionAffordance 'none', WR-01)
 *   - walk with edges   → flattenBlockerChain (raw label; caller scrubs after)
 *
 * The blocker-free + degrade labels are UUID-safe literals by construction; only
 * the success path (flattenBlockerChain) carries a raw UUID-bearing label that the
 * caller must hand to scrubResultLabel before return.
 */
export function buildHandlerResult(args: {
  startId: string;
  viewerUserId: string;
  walk?: WalkOutput;
  maxAgeMs?: number;
  degrade?: { label: string; reason: string };
}): BlockerChainResult {
  const { startId, viewerUserId, walk, maxAgeMs, degrade } = args;
  if (degrade) {
    // IN-04 — adopt the shared degrade-row constructor (was a hand-built object).
    const terminal: Terminal = { kind: 'UNCLASSIFIED', label: degrade.label };
    return makeDegradedResult(terminal, startId, degrade.reason);
  }
  if (!walk || walk.edges.length === 0) {
    // Plan 12-08 (SC5 / BEAAA-972 fix) — the empty-edges case used to BLINDLY
    // route to makeBlockerFreeResult → EXTERNAL "No active blockers", even for a
    // blocked, agent-owned issue with zero STRUCTURED blockers. That diverged
    // from the Situation Room (which classified the same issue via the engine).
    // NOW: if the walk attached the ROOT issue's own meta (walkBlockerChain does
    // this) AND that meta says the root is blocked OR owned, route through the
    // SAME pure engine with edges:[] so the start IS the leaf and the engine
    // classifies it identically to the Situation Room (→ AWAITING_AGENT_STUCK /
    // AWAITING_HUMAN / UNOWNED). makeBlockerFreeResult is reserved for the
    // GENUINELY not-blocked root (WR-01 unchanged, regression-guarded).
    // The empty-edges → engine route fires ONLY when the ROOT issue is itself
    // status='blocked' (the locked matrix: a NOT-blocked issue with no structured
    // blockers is genuinely blocker-free EXTERNAL, regardless of its owner — the
    // regression guard pins this). A blocked root then classifies from its own
    // meta: agent-owned → AWAITING_AGENT_STUCK, human-owned → AWAITING_HUMAN, no
    // owner → UNOWNED.
    const rootMeta = walk?.nodeMeta?.[startId];
    const rootIsBlocked = !!rootMeta && rootMeta.status === 'blocked';
    if (rootIsBlocked) {
      return flattenBlockerChain({
        startId,
        edges: [],
        nodeMeta: walk!.nodeMeta,
        viewerUserId,
        maxAgeMs,
      });
    }
    // WR-01 — the GENUINELY-blocker-free row carries actionAffordance 'none' (not
    // 'open'), so the Reader renders no dead action. makeBlockerFreeResult forces
    // the non-actionable verdict; the label is a UUID-safe literal.
    return makeBlockerFreeResult(startId, 'No active blockers');
  }
  return flattenBlockerChain({
    startId,
    edges: walk.edges,
    nodeMeta: walk.nodeMeta,
    viewerUserId,
    maxAgeMs,
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

  // Plan 12-08 (SC5 / BEAAA-972 fix) — attach the ROOT issue's OWN meta into
  // nodeMeta[startId] so a blocked issue with ZERO structured blockers classifies
  // from its own state (status/assigneeAgentId/ownerUserId) instead of falling
  // through to the EXTERNAL "no active blockers" lie. Both BFS builders MUST do
  // this with the IDENTICAL field shape (org-blocked-backlog.ts mirrors it) — the
  // empty-edges case is THE divergence point the milestone's "one verdict
  // everywhere" promise (SC5) hinges on. Best-effort: a thrown issues.get leaves
  // the root meta absent, preserving the prior behavior for that degrade path.
  try {
    const root = (await issues.get(startId, companyId)) as RelationNodeProjection | null;
    if (root) {
      const assigneeAgentId = root.assigneeAgentId ?? null;
      const rootStatus = root.status ?? 'awaiting';
      // Plan 12-08 (locked product decision) — a BLOCKED root with an agent owner
      // is AWAITING_AGENT_STUCK by definition: the issue is blocked, so the agent
      // is NOT progressing ON IT regardless of its heartbeat liveness elsewhere.
      // Force agentState='stuck' for a blocked root; for any other status defer to
      // the worker liveness projection (the shared resolveAgentState). This keeps
      // both BFS builders' field shape identical while encoding the blocked-root
      // semantic in ONE place per builder.
      const lastHeartbeatMs =
        typeof root.lastHeartbeatMs === 'number'
          ? root.lastHeartbeatMs
          : typeof root.lastHeartbeatAt === 'string'
            ? (() => {
                const t = Date.parse(root.lastHeartbeatAt as string);
                return Number.isFinite(t) ? t : null;
              })()
            : null;
      const agentState: 'working' | 'stuck' | null =
        assigneeAgentId == null
          ? null
          : rootStatus === 'blocked'
            ? 'stuck'
            : resolveAgentState({
                lastHeartbeatMs,
                hasQueuedWork: root.hasQueuedWork === true,
                nowMs,
                expectedCadenceMs:
                  typeof root.expectedCadenceMs === 'number' && root.expectedCadenceMs > 0
                    ? root.expectedCadenceMs
                    : undefined,
              });
      nodeMeta[startId] = {
        ownerUserId: root.assigneeUserId ?? root.ownerUserId ?? null,
        etaIso: root.etaIso ?? null,
        status: rootStatus,
        assigneeAgentId,
        agentState,
      };
    }
  } catch {
    // Best-effort: leave the root meta absent (prior behavior). The walk below
    // still runs; an empty-edges + absent-root-meta result routes to blocker-free.
  }

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

    // Plan 11-06 Task 2 (IN-03) — single typed projection via the shared
    // RelationNodeProjection (was three chained `as unknown as {...}` casts here).
    // Read order + the `?? null` defensive posture (Pitfall 7) are unchanged — the
    // agent-owned leaf still classifies AWAITING_AGENT_* identically to buildEdges (SC5).
    const blockedBy = (summary.blockedBy ?? []) as Array<RelationNodeProjection>;
    for (const blocker of blockedBy) {
      const b = blocker;
      const toId = b.id ?? b.issueId ?? b.key ?? '';
      if (!toId) continue;
      edges.push({ from: id, to: toId, reason: 'blocks' });
      // Populate node meta best-effort from the summary. Owner/status/eta come
      // from fields IssueRelationIssueSummary exposes — if not present, we leave
      // them null and flattenBlockerChain falls back to its unowned terminal.
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
              // WR-03 (Plan 11-06) — forward the cadence only when it is a POSITIVE
              // number (> 0). A host 0 is meaningful-but-invalid (a 0-width stale
              // window); the helper then falls back to RUNNING_WINDOW_MS. Mirrors
              // the 11-05 helper guard and org-blocked-backlog's call site.
              expectedCadenceMs:
                typeof b.expectedCadenceMs === 'number' && b.expectedCadenceMs > 0
                  ? b.expectedCadenceMs
                  : undefined,
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

// Plan 11-06 Task 1 (IN-04) — the hand-built degraded() and noBlockers() row
// constructors were REPLACED by the shared makeDegradedResult / makeBlockerFreeResult
// helpers (from blocker-chain.ts), routed through buildHandlerResult above. The
// blocker-free case now carries actionAffordance 'none' (WR-01) instead of the
// classifyVerdict(EXTERNAL) → 'open' it previously emitted.
