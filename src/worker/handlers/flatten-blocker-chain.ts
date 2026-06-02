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

    // buildHandlerResult routes the blocker-free case → 'none' (WR-01) and the
    // success case → flattenBlockerChain (raw label). The success-path label is
    // then scrubbed via scrubResultLabel BEFORE return — the CR-01 fix.
    const result = buildHandlerResult({ startId, viewerUserId, walk, maxAgeMs });
    if (walk.edges.length === 0) {
      // Blocker-free → already UUID-safe literal; no agents resolution needed.
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
