// src/worker/handlers/org-blocked-backlog.ts
//
// Plan 07-03 Task 1 (Phase 7 ITEM 4) — the pure ORG-LEVEL blocked-issue
// backlog builder.
//
// WHY THIS EXISTS: the Situation Room reports "No blockers" on every agent
// card while ~24 issues sit status=blocked. Root cause (situation-snapshot.ts):
// buildEmployeeRow walks blockers PER AGENT from current_focus_issue_id, gated
// `if (startId)`; every agent is idle/Standby (no focus) → empty chain → "No
// blockers". The FIX (output/insight only — NO new schema): walk ALL
// company-wide status=blocked issues DIRECTLY, flatten each to a single human
// action via the EXISTING flattenBlockerChain, rank HUMAN_ACTION_ON-first via
// the EXISTING pickTopChains, resolve each owner to a display NAME (never a
// UUID) via the D-09 ctx.agents.get pattern.
//
// This builder is PURE + structurally-typed so it is test-stubbable without
// the SDK (mirrors the snapshot-job ctx idiom). It is wired into the
// situation.snapshot DATA HANDLER (Task 2, valid HTTP-request scope) — NOT the
// scope-dead recompute-situation job.
//
// REUSE (no re-implementation): flattenBlockerChain + pickTopChains both come
// from src/shared/blocker-chain.ts. The per-issue edge/nodeMeta build mirrors
// the snapshot job's relations.get BFS (situation-snapshot.ts:160-203,
// MAX_CHAIN_DEPTH=6). The owner-name resolution replicates the D-09
// NO_UUID_LEAK dedupe+degrade pattern (resolve-refs.ts:127-159) locally so the
// handler is self-contained.

import {
  flattenBlockerChain,
  pickTopChains,
  classifyVerdict,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
import type { BlockerChainResult, Terminal } from '../../shared/types.ts';
// Plan 08-01 Task 1 — scrubHumanAction + its UUID constants are now the single
// source of truth in src/shared/scrub-human-action.ts (extracted from this file
// verbatim). Both ROOM-12 (here) and ROOM-13..16 (build-employees-rollup.ts)
// import them, so a future blocker-chain change is fixed in exactly one place.
// Plan 11-02 — the legacy unowned-sentinel import is GONE (Plan 11-01 removed
// the sentinel lie); need_you now keys on the engine verdict, not a magic
// userId string-match.
import {
  scrubHumanAction,
  scrubAwaitedParty,
  UUID_RE_G,
} from '../../shared/scrub-human-action.ts';
// Plan 11-02 Task 2 (D-01) — the SINGLE worker-side liveness projection. The
// engine reads no clock; the worker resolves working/stuck here and injects the
// string into nodeMeta.
import { resolveAgentState } from '../situation/agent-liveness.ts';
// Plan 17-02 Task 2 (WAIT-02 / SC5) — the SINGLE shared merge helper. Called
// IDENTICALLY here, in flatten-blocker-chain.ts, and in build-employees-rollup.ts
// so a wait merged on one path is merged on ALL paths (kills BEAAA-972 divergence).
import { applyStructuredWait } from '../situation/apply-structured-wait.ts';

// Bound the per-issue blocker walk (mirrors the snapshot job's
// MAX_CHAIN_DEPTH at situation-snapshot.ts:39).
const MAX_CHAIN_DEPTH = 6;

// Plan 11-02 Task 2 (D-01 / SC5) — the canonical nodeMeta shape buildEdges
// emits. Declared ONCE so the return-type annotation, the local accumulator,
// and the buildOrgBlockedBacklog caller can never drift; the Reader BFS
// (flatten-blocker-chain.ts) mirrors this exact field set (SC5). assigneeAgentId
// + agentState are the agent-ownership/liveness facts injected into the engine.
type EdgeNodeMeta = {
  ownerUserId: string | null;
  etaIso: string | null;
  status: string;
  assigneeAgentId: string | null;
  agentState: 'working' | 'stuck' | null;
  // Plan 17-02 Task 2 (WAIT-02 / SC5) — the persisted structured human-wait
  // facts merged onto the ROOT node by applyStructuredWait. Kept in LOCKSTEP with
  // WalkOutput.nodeMeta (flatten-blocker-chain.ts) — the parity test pins them
  // equal. The engine's priority-0 AWAITING_HUMAN branch (17-01) reads these.
  structuredWaitOwnerUserId: string | null;
  structuredWaitOneLiner: string | null;
};

// Plan 11-06 Task 2 (IN-03 / SC5) — the SINGLE relation-node projection shape both
// BFS walkers read from a `summary.blockedBy[]` entry. org-blocked-backlog.buildEdges
// and flatten-blocker-chain.walkBlockerChain previously projected this shape
// independently (one typed cast here, three chained `as unknown as {...}` casts in
// the Reader walker). Declaring it ONCE and importing it into both makes the SC5
// "the two builders agree" claim honest at the type level. Every field stays
// optional + the runtime keeps its `?? null` defensive posture (Pitfall 7) — this
// is a type-only refactor; no read order or default changes.
export type RelationNodeProjection = {
  id?: string;
  issueId?: string;
  key?: string;
  assigneeUserId?: string | null;
  ownerUserId?: string | null;
  etaIso?: string | null;
  status?: string;
  // D-01 — agent ownership + the worker's liveness signals.
  assigneeAgentId?: string | null;
  lastHeartbeatMs?: number | null;
  lastHeartbeatAt?: string | null;
  hasQueuedWork?: boolean | null;
  expectedCadenceMs?: number | null;
};

// D-I4-04 — cap the rendered backlog at 12–15. This plan picks 15: covers a
// ~two-dozen-blocked org at >half while staying scannable. A "N total" count +
// overflow indicator surface the rest. (Instance-agnostic: no company-prefix
// literal anywhere in this file.)
const CAP = 15;

/** True iff `s` is exactly a hex UUID (strict, full string). */
function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Every distinct hex UUID inside an arbitrary string. */
function uuidsIn(s: string): string[] {
  return s.match(UUID_RE_G) ?? [];
}

/** A single blocked-issue row in the org backlog. */
export type OrgBlockedRow = {
  issueId: string;
  identifier: string;
  title: string;
  /** The single flattened human action — the terminal.label (React text only;
   *  the UI never renders ownerAgentId as text). */
  humanAction: string;
  terminalKind: Terminal['kind'];
  /** Plan 12-03 Task 1 (NY-03 / D-09) — the engine verdict's action affordance,
   *  carried verbatim from chain.actionAffordance (classifyVerdict). The org-
   *  blocked backlog expander gates the OwnerPickerPopover on
   *  `actionAffordance === 'assign'` (UNOWNED + AWAITING_AGENT_STUCK after 12-01)
   *  — the SAME single verdict every other surface reads, never a terminal.kind
   *  list or an ownerName string-match. Typed off the shared union so a 6th
   *  affordance is a compile error here AND in the UI mirror type. */
  actionAffordance: BlockerChainResult['actionAffordance'];
  /** Owner DISPLAY NAME or null. NO_UUID_LEAK: null renders "Unassigned" in
   *  the UI — NEVER the raw UUID. */
  ownerName: string | null;
  /** Owner UUID — carried ONLY as the chat-deep-link target. NOT rendered as
   *  visible text. null/sentinel when the issue has no resolvable owner. */
  ownerAgentId: string | null;
  /** ms since the issue was blocked, or null when no timestamp field parses
   *  (the UI omits the age chip rather than render NaN). */
  age_ms: number | null;
  // Plan 14-04 Task 2 (BLOCKER 3 / D-02/D-08/D-10) — the fields <ReplyInPlace>
  // needs on the org-blocked backlog surface. All additive + projection-only:
  // the engine verdict + the leaf node status are already computed.
  /** Plan 14-04 — the scrubbed awaited-party DISPLAY string (= the scrubbed
   *  humanAction / chain.awaitedPartyLabel). The only rendered awaited-party
   *  label; carries no raw UUID (NO_UUID_LEAK). */
  awaitedPartyLabel: string;
  /** Plan 14-04 — the awaited AGENT UUID for the reply/nudge mutation (=
   *  chain.targetAgentUuid). DISPATCH-ONLY, NEVER rendered (NO_UUID_LEAK). */
  targetAgentUuid: string | null;
  /** Plan 14-04 — the conservative-binary decision options (Phase 13 D-08). The
   *  org backlog has NO action card this phase → always null; carried so the UI
   *  mirror stays parallel with the SR/Reader surfaces. */
  decisionOptions: string[] | null;
  /** Plan 14-04 — the LEAF issue UUID (= chain.targetIssueUuid), the MUTATION id
   *  for situation.replyAndResume → ctx.issues.update. DISTINCT from issueId
   *  (the ROOT issue UUID) on a multi-hop chain. DISPATCH-ONLY, NEVER rendered
   *  (NO_UUID_LEAK — identifier stays the only displayed key). */
  leafIssueUuid: string | null;
  /** Plan 14-04 (T-14-19) — the Shape-B durable-flip signal: true iff the LEAF
   *  node's status === 'blocked' (nodeMeta[leafId].status, falling back to
   *  'blocked' only when the leaf IS the blocked root). Derived from the REAL
   *  node status — NOT a terminal.kind proxy. Dispatch INPUT to <ReplyInPlace>;
   *  NEVER rendered. */
  needsDurabilityFlip: boolean;
};

export type OrgBlockedBacklog = {
  rows: OrgBlockedRow[];
  /** All blocked issues (the headline N). */
  total: number;
  /** Same as total (the banner's "N blocked"). */
  blocked_count: number;
  /** The banner's "M need you" — HUMAN_ACTION_ON rows whose terminal targets
   *  the VIEWER specifically. */
  need_you_count: number;
  /** total > CAP. */
  overflow: boolean;
};

/** Plan 16-02 (Wave A) — the shared blocker-edge memo value. A successful walk
 *  carries its { edges, nodeMeta }; a thrown walk is stored as the
 *  UNCLASSIFIED sentinel so the consumer emits the honest UNCLASSIFIED floor row
 *  for that startId instead of re-walking (or dropping) it. Built ONCE in the
 *  handler (situation-room.ts) over {blocked roots} ∪ {blocked agent focus} and
 *  shared by BOTH builders. */
export type SharedEdgeEntry =
  | { edges: BlockerEdge[]; nodeMeta: Record<string, EdgeNodeMeta> }
  | { unclassified: true; degradeReason: string };

/** Plan 16-02 — the prefetch slice both builders read from when present. Each
 *  field is OPTIONAL: when absent the builder falls back to its original RPC
 *  path (degrade-safety + old fixtures keep working). */
export type SnapshotPrefetch = {
  /** Company-wide blocked issues (camelCase-mapped from the public.issues SELECT). */
  blockedIssues?: IssueLike[];
  /** uuid→display-name Map built ONCE from the public.agents SELECT. A missing
   *  uuid yields null (NO_UUID_LEAK), NEVER the raw UUID. */
  nameByUuid?: Map<string, string | null>;
  /** startId→edge-graph memo, populated once across the blocked∪focus union. */
  edgeGraph?: Map<string, SharedEdgeEntry>;
  /** Plan 17-02 (WAIT-02 / SC5) — issue_id→persisted structured human-wait,
   *  built ONCE in the situation-room prefetch and threaded into BOTH builders so
   *  applyStructuredWait merges the IDENTICAL wait at every root-meta write site
   *  (kills the BEAAA-972 cross-surface divergence). Absent → no wait merged
   *  (conservative engine floor). The value shape is the repo's ClarityHumanWaitRow
   *  subset applyStructuredWait reads ({ owner_user_id, decision_one_liner }). */
  waitMap?: Map<string, { owner_user_id: string; decision_one_liner: string }>;
};

/** The structural ctx the builder accepts — stubbable in tests, satisfied at
 *  runtime by the widened SituationRoomCtx (Task 2). */
export type OrgBlockedBacklogCtx = SnapshotPrefetch & {
  issues: {
    list(input: { companyId: string; status?: string }): Promise<unknown[]>;
    relations: {
      get(
        issueId: string,
        companyId: string,
      ): Promise<{ blockedBy?: unknown[]; blocks?: unknown[] } | null | undefined>;
    };
  };
  agents?: {
    get(agentId: string, companyId: string): Promise<unknown | null>;
  };
  logger?: { warn?: (msg: string, meta?: unknown) => void };
};

/** Loosely-typed Issue projection — read camelCase (07-01 proved the real
 *  shape is camelCase). */
type IssueLike = {
  id?: string;
  identifier?: string;
  title?: string;
  status?: string;
  assigneeUserId?: string | null;
  assigneeAgentId?: string | null;
  updatedAt?: string | null;
  statusChangedAt?: string | null;
  blockedAt?: string | null;
  createdAt?: string | null;
};

const EMPTY: OrgBlockedBacklog = {
  rows: [],
  total: 0,
  blocked_count: 0,
  need_you_count: 0,
  overflow: false,
};

/** Plan 11-02 Task 2 (TAX-03 / D-09) — synthesize an honest UNCLASSIFIED chain
 *  for a blocked issue whose edge build / flatten threw. The verdict triple is
 *  derived from classifyVerdict (UNCLASSIFIED ⇒ tier 'watch', affordance 'open',
 *  needsYou false) so the row never claims a false "assign owner". The issue is
 *  surfaced, not silently dropped. */
function unclassifiedChain(startId: string, degradeReason: string): BlockerChainResult {
  const terminal: Terminal = {
    kind: 'UNCLASSIFIED',
    label: `Can't determine blocker for ${startId} — open to investigate`,
  };
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
    degradeReason,
  };
}

/** Read the first present, parseable timestamp field → age in ms, else null.
 *  <age_source_note>: the SDK Issue's "blocked-since" field name is not
 *  guaranteed; try the common candidates and degrade to null (no NaN). */
function ageMsFrom(issue: IssueLike): number | null {
  const candidates = [
    issue.updatedAt,
    issue.statusChangedAt,
    issue.blockedAt,
    issue.createdAt,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) {
      return Math.max(0, Date.now() - t);
    }
  }
  return null;
}

/** Build the blocker-edge graph for one blocked issue by walking
 *  relations.get, mirroring the snapshot job's BFS
 *  (situation-snapshot.ts:160-203). Bounded at MAX_CHAIN_DEPTH; a thrown
 *  relations.get on an inner node is skipped (continue), a thrown call on the
 *  ROOT propagates so the caller can skip the whole issue.
 *
 *  Plan 08-01 Task 3 — EXPORTED so build-employees-rollup.ts reuses the exact
 *  same BFS (Don't-Hand-Roll: per-issue edge graph build). The ctx requirement
 *  is only `issues.relations.get`, satisfied structurally by EmployeesRollupCtx. */
export async function buildEdges(
  ctx: OrgBlockedBacklogCtx,
  companyId: string,
  startId: string,
): Promise<{
  edges: BlockerEdge[];
  nodeMeta: Record<string, EdgeNodeMeta>;
}> {
  const edges: BlockerEdge[] = [];
  const nodeMeta: Record<string, EdgeNodeMeta> = {};
  const nowMs = Date.now();
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  let isRoot = true;
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > MAX_CHAIN_DEPTH) continue;
    visited.add(id);
    let summary;
    try {
      summary = await ctx.issues.relations.get(id, companyId);
    } catch (e) {
      // A thrown relations.get on the ROOT issue means we cannot build any
      // chain for it — propagate so the caller skips this issue entirely.
      // On an inner node, skip just that node (the rest of the graph survives).
      if (isRoot) throw e;
      continue;
    } finally {
      isRoot = false;
    }
    // Plan 11-02 Task 2 (Pitfall 7 / V5) — every new field read keeps the
    // defensive `?? null` posture; a missing field falls through the engine
    // cascade to UNOWNED/SELF_RESOLVING (conservative-correct), never a crash.
    // Plan 11-06 Task 2 (IN-03) — single typed cast via the shared
    // RelationNodeProjection (was an inline object-literal type duplicated in the
    // Reader walker). The `?? null` posture is unchanged.
    const blockedBy = (summary?.blockedBy ?? []) as Array<RelationNodeProjection>;
    for (const blocker of blockedBy) {
      const toId = blocker.id ?? blocker.issueId ?? blocker.key ?? '';
      if (!toId) continue;
      edges.push({ from: id, to: toId, reason: 'blocks' });
      const assigneeAgentId = blocker.assigneeAgentId ?? null;
      // D-01 — resolve liveness in the WORKER (clock here is legitimate) and
      // inject the string. null when there is no agent on this node; otherwise
      // resolveAgentState returns working/stuck (D-04: a missing heartbeat
      // signal ⇒ conservative stuck, never null).
      const lastHeartbeatMs =
        typeof blocker.lastHeartbeatMs === 'number'
          ? blocker.lastHeartbeatMs
          : typeof blocker.lastHeartbeatAt === 'string'
            ? (() => {
                const t = Date.parse(blocker.lastHeartbeatAt as string);
                return Number.isFinite(t) ? t : null;
              })()
            : null;
      const agentState: 'working' | 'stuck' | null =
        assigneeAgentId == null
          ? null
          : resolveAgentState({
              lastHeartbeatMs,
              hasQueuedWork: blocker.hasQueuedWork === true,
              nowMs,
              // WR-03 (Plan 11-06) — forward the cadence only when POSITIVE (> 0).
              // A host 0 is meaningful-but-invalid (a 0-width stale window); the
              // helper falls back to RUNNING_WINDOW_MS. Matches flatten-blocker-chain's
              // call site and the 11-05 helper guard, so a host 0 never reaches the
              // helper from EITHER builder.
              expectedCadenceMs:
                typeof blocker.expectedCadenceMs === 'number' && blocker.expectedCadenceMs > 0
                  ? blocker.expectedCadenceMs
                  : undefined,
            });
      nodeMeta[toId] = {
        ownerUserId: blocker.assigneeUserId ?? blocker.ownerUserId ?? null,
        etaIso: blocker.etaIso ?? null,
        status: blocker.status ?? 'awaiting',
        assigneeAgentId,
        agentState,
        // Plan 17-02 (SC5) — initialized to null on every node; the structured
        // wait is merged onto the ROOT node only, via applyStructuredWait at the
        // buildOrgBlockedBacklog flatten site (the wait grounds in the blocked
        // root issue, not its blockers).
        structuredWaitOwnerUserId: null,
        structuredWaitOneLiner: null,
      };
      if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) {
        queue.push({ id: toId, depth: depth + 1 });
      }
    }
  }
  return { edges, nodeMeta };
}

/**
 * Walk ALL company-wide status=blocked issues, flatten each to a single human
 * action, rank HUMAN_ACTION_ON-first, cap at 15, resolve owners to NAMES.
 *
 * Degrade-safe: a thrown ctx.issues.list → the empty backlog; a thrown
 * relations walk for one issue → that issue is skipped; a thrown/absent
 * ctx.agents.get → that owner's name is null (NEVER the UUID). Instance-
 * agnostic: no company-prefix literal.
 */
export async function buildOrgBlockedBacklog(
  ctx: OrgBlockedBacklogCtx,
  companyId: string,
  viewerUserId: string,
): Promise<OrgBlockedBacklog> {
  // 1. List blocked issues. Plan 16-02 (Wave A) — when the handler supplied the
  //    shared SQL prefetch (ctx.blockedIssues), read from it (one prefetched
  //    SELECT replaces ctx.issues.list); otherwise fall back to the RPC list so
  //    older fixtures + degrade-safety keep working. The prefetch SELECT itself
  //    lives in situation-room.ts and is company-scoped `WHERE company_id = $1`
  //    (parameterized, no prefix literal) — this file only CONSUMES those rows.
  let listed: unknown[];
  if (Array.isArray(ctx.blockedIssues)) {
    listed = ctx.blockedIssues;
  } else {
    try {
      listed = await ctx.issues.list({ companyId, status: 'blocked' });
    } catch (e) {
      ctx.logger?.warn?.('org-blocked-backlog: issues.list failed', {
        companyId,
        err: (e as Error).message,
      });
      return { ...EMPTY };
    }
  }
  const blocked = (Array.isArray(listed) ? listed : []).filter(
    (i): i is IssueLike =>
      !!i && typeof i === 'object' && (i as IssueLike).status === 'blocked',
  );
  const total = blocked.length;

  // Plan 17-02 Task 2 (WAIT-02 / SC5) — merge the persisted structured human-wait
  // onto the ROOT issue's nodeMeta before flattening, via the SHARED helper
  // (IDENTICAL to flatten-blocker-chain.ts + build-employees-rollup.ts). buildEdges
  // does NOT write a root-meta entry (only blocker TARGETS), and the empty-edges
  // blocked root is exactly the BEAAA-972 divergence point, so we ENSURE the root
  // entry exists here. The memo nodeMeta is SHARED across the snapshot — never
  // mutate it in place; clone the root entry before applying the wait.
  const mergeRootWait = (
    nodeMeta: Record<string, EdgeNodeMeta>,
    rootId: string,
  ): Record<string, EdgeNodeMeta> => {
    if (!ctx.waitMap || !rootId) return nodeMeta;
    // Shallow-clone the map + ensure a root entry (init the two wait fields null,
    // mirroring the literal at every other site). Cloning keeps the shared memo
    // pristine for the next consumer (SC5 — the wait is per-snapshot deterministic).
    const merged: Record<string, EdgeNodeMeta> = { ...nodeMeta };
    merged[rootId] = nodeMeta[rootId]
      ? { ...nodeMeta[rootId], structuredWaitOwnerUserId: null, structuredWaitOneLiner: null }
      : {
          ownerUserId: null,
          etaIso: null,
          status: 'blocked',
          assigneeAgentId: null,
          agentState: null,
          structuredWaitOwnerUserId: null,
          structuredWaitOneLiner: null,
        };
    applyStructuredWait(merged, rootId, ctx.waitMap);
    return merged;
  };

  // 2. Flatten each blocked issue to one Terminal, keeping the source-issue
  //    pairing so the ranked top-CAP rows carry their metadata.
  // Plan 14-04 Task 2 — also keep each issue's nodeMeta so the per-row emit can
  // read the LEAF node status for needsDurabilityFlip (T-14-19) — NO new fetch;
  // nodeMeta is the SAME map buildEdges already returned. UNCLASSIFIED degrade
  // rows store an empty nodeMeta (their leaf is the blocked root → flip true).
  type Paired = { chain: BlockerChainResult; issue: IssueLike; nodeMeta: Record<string, EdgeNodeMeta> };
  const paired: Paired[] = [];
  for (const issue of blocked) {
    const startId = issue.id ?? issue.identifier ?? '';
    if (!startId) continue;
    let edges: BlockerEdge[];
    let nodeMeta: Record<string, EdgeNodeMeta>;
    // Plan 16-02 (Wave A) — read this issue's edges from the shared memo the
    // handler built ONCE (no second relations walk). A memo miss falls back to a
    // direct buildEdges (degrade-safety + old fixtures). A memo'd UNCLASSIFIED
    // sentinel (a thrown walk during the prefetch) floors to the existing
    // unclassifiedChain row — surfaced, not dropped.
    // Plan 16-03 (Wave B) — a memo'd UNCLASSIFIED sentinel floors this row via
    // unclassifiedChain with the carried degradeReason VERBATIM. This covers BOTH
    // the existing 'relations-walk-failed' (a thrown walk) AND the new Wave-B
    // 'relations-walk-timeout' (a walk that hung past the per-walk deadline OR was
    // never started because the overall snapshot budget was exhausted). Both are
    // the SAME honest UNCLASSIFIED floor — the timeout reason rides through the
    // existing generic branch; no new shape is invented.
    const memo = ctx.edgeGraph?.get(startId);
    if (memo && 'unclassified' in memo) {
      paired.push({ chain: unclassifiedChain(startId, memo.degradeReason), issue, nodeMeta: {} });
      continue;
    }
    if (memo) {
      ({ edges } = memo);
      // SC5 — clone-and-merge the root structured-wait (never mutate the shared memo).
      nodeMeta = mergeRootWait(memo.nodeMeta, startId);
      let chain: BlockerChainResult;
      try {
        chain = flattenBlockerChain({ startId, edges, nodeMeta, viewerUserId });
      } catch (e) {
        ctx.logger?.warn?.('org-blocked-backlog: flatten failed (UNCLASSIFIED row)', {
          companyId,
          startId,
          err: (e as Error).message,
        });
        paired.push({ chain: unclassifiedChain(startId, 'flatten-failed'), issue, nodeMeta: {} });
        continue;
      }
      paired.push({ chain, issue, nodeMeta });
      continue;
    }
    try {
      ({ edges, nodeMeta } = await buildEdges(ctx, companyId, startId));
    } catch (e) {
      // Plan 11-02 Task 2 (TAX-03 / D-09) — a thrown edge build no longer
      // SILENTLY DROPS the issue. Surface an honest UNCLASSIFIED row with a
      // degradeReason so the operator sees "can't determine — open to
      // investigate" instead of the blocked issue vanishing.
      ctx.logger?.warn?.('org-blocked-backlog: relations walk failed (UNCLASSIFIED row)', {
        companyId,
        startId,
        err: (e as Error).message,
      });
      paired.push({ chain: unclassifiedChain(startId, 'relations-walk-failed'), issue, nodeMeta: {} });
      continue;
    }
    // SC5 — merge the root structured-wait (buildEdges wrote no root entry).
    nodeMeta = mergeRootWait(nodeMeta, startId);
    let chain: BlockerChainResult;
    try {
      chain = flattenBlockerChain({ startId, edges, nodeMeta, viewerUserId });
    } catch (e) {
      ctx.logger?.warn?.('org-blocked-backlog: flatten failed (UNCLASSIFIED row)', {
        companyId,
        startId,
        err: (e as Error).message,
      });
      paired.push({ chain: unclassifiedChain(startId, 'flatten-failed'), issue, nodeMeta: {} });
      continue;
    }
    paired.push({ chain, issue, nodeMeta });
  }

  // 3. Rank HUMAN_ACTION_ON-first via the shared pickTopChains, then re-pair
  //    each ranked chain back to its source issue. We rank the FULL list and
  //    slice to CAP; the pairing is recovered by chain identity.
  const chainToIssue = new Map<BlockerChainResult, IssueLike>();
  // Plan 14-04 Task 2 — recover each ranked chain's nodeMeta (for the leaf-status
  // needsDurabilityFlip) by the SAME chain-identity pairing used for the issue.
  const chainToNodeMeta = new Map<BlockerChainResult, Record<string, EdgeNodeMeta>>();
  for (const p of paired) {
    chainToIssue.set(p.chain, p.issue);
    chainToNodeMeta.set(p.chain, p.nodeMeta);
  }
  const rankedChains = pickTopChains(
    paired.map((p) => p.chain),
    CAP,
  );

  // 4. Resolve distinct UUIDs → display NAMES (D-09 NO_UUID_LEAK). This now
  //    covers BOTH the issue OWNER (for row.ownerName) AND every UUID the
  //    flattened terminal LABEL embeds (for scrubHumanAction) — the issue's
  //    AWAITING_HUMAN terminal.userId when it is a real UUID plus any UUID found
  //    inside terminal.label (07-03 HOTFIX: previously only the owner was
  //    resolved, so the raw blocker-node UUID leaked through terminal.label into
  //    row.humanAction).
  const ownerUuidFor = (issue: IssueLike): string | null =>
    (typeof issue.assigneeUserId === 'string' && issue.assigneeUserId
      ? issue.assigneeUserId
      : typeof issue.assigneeAgentId === 'string' && issue.assigneeAgentId
        ? issue.assigneeAgentId
        : null);

  // The shared UUID→name map consumed by both ownerName and scrubHumanAction.
  // Plan 16-02 (Wave A) — when the handler supplied the prefetched nameByUuid
  // (built ONCE from the public.agents SELECT), use it directly: NO per-uuid
  // ctx.agents.get round-trips. A missing uuid still yields null (the existing
  // NO_UUID_LEAK posture), NEVER the raw UUID. Falls back to the per-uuid RPC
  // loop only when the prefetch is absent (old fixtures + degrade-safety).
  const nameByUuid = ctx.nameByUuid ?? new Map<string, string | null>();
  if (ctx.nameByUuid == null && typeof ctx.agents?.get === 'function') {
    const wanted = new Set<string>();
    for (const c of rankedChains) {
      // The issue OWNER → row.ownerName. Resolve ANY non-empty owner id (not
      // gated on UUID-shape — ownerName is a display field, unchanged from the
      // pre-HOTFIX behavior).
      const owner = ownerUuidFor(chainToIssue.get(c)!);
      if (owner) wanted.add(owner);
      // Terminal-label UUIDs → scrubHumanAction. Only hex UUIDs need resolving
      // for the scrubber; the viewer "You" substitution uses terminal.userId.
      // Plan 11-02 — the human-action kind is now AWAITING_HUMAN (no sentinel:
      // UNOWNED is its own kind carrying NO userId, so there is no magic userId
      // string to exclude).
      const t = c.terminal;
      if (t.kind === 'AWAITING_HUMAN' && isUuid(t.userId)) {
        wanted.add(t.userId);
      }
      for (const u of uuidsIn(t.label)) wanted.add(u);
    }
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
        // D-09 — degrade silently to null on agents.get throw. NEVER fall back
        // to the UUID; the NO_UUID_LEAK guarantee depends on this (the scrubber
        // then uses the agent#<short> / clean-unowned fallback).
        ctx.logger?.warn?.('org-blocked-backlog: agents.get failed', {
          companyId,
          uuid,
          err: (e as Error).message,
        });
        nameByUuid.set(uuid, null);
      }
    }
  }

  // 5. Emit rows. Plan 11-02 (D-13) — need_you_count keys on the ENGINE VERDICT
  //    (chain.needsYou), not a terminal.kind + sentinel string-match. V4
  //    viewer-scoping is preserved: among needs-you chains, only an AWAITING_HUMAN
  //    terminal whose userId === the UI-supplied viewer counts (a genuinely-
  //    UNOWNED needs-you chain has NO userId and is org-wide, not viewer-specific,
  //    so it does not inflate the viewer's "M need you").
  const rows: OrgBlockedRow[] = [];
  let needYou = 0;
  for (const chain of rankedChains) {
    const issue = chainToIssue.get(chain)!;
    const ownerUuid = ownerUuidFor(issue);
    const terminal = chain.terminal;
    if (
      chain.needsYou &&
      terminal.kind === 'AWAITING_HUMAN' &&
      terminal.userId === viewerUserId
    ) {
      needYou += 1;
    }
    // Plan 14-04 Task 2 (T-14-19) — needsDurabilityFlip off the REAL leaf NODE
    // status (NOT terminal.kind). The leaf node id is chain.targetIssueUuid (the
    // node the chain terminated at). leafStatus = nodeMeta[leafId].status, falling
    // back to 'blocked' ONLY when the leaf IS the root (the root is status='blocked'
    // by the list filter — incl. the UNCLASSIFIED degrade chain whose leaf === root).
    const rootId = issue.id ?? issue.identifier ?? '';
    const nodeMeta = chainToNodeMeta.get(chain) ?? {};
    const leafId = chain.targetIssueUuid;
    const leafStatus =
      (leafId && nodeMeta[leafId]?.status) ||
      // IN-02 (14-REVIEW) — INTENTIONAL conservative fallback. DO NOT broaden.
      // When the leaf node was not walked as a blockedBy node (e.g. it is the
      // terminal of a chain whose outgoing edges buildEdges didn't traverse, so
      // nodeMeta has no entry for it), fall back to 'blocked' ONLY when the leaf
      // IS the root — the root is status='blocked' by the list filter (incl. the
      // UNCLASSIFIED degrade chain whose leaf === root). A multi-hop chain with an
      // ABSENT leaf nodeMeta deliberately yields null → needsDurabilityFlip=false
      // → comment-only (Shape A, spike-safe): the comment alone triggers native
      // resume; we just skip the durable Shape-B flip rather than over-firing it
      // against an issue whose real status we can't confirm here.
      (leafId === rootId || leafId == null ? 'blocked' : null);
    const needsDurabilityFlip = leafStatus === 'blocked';
    rows.push({
      issueId: rootId,
      identifier: issue.identifier ?? issue.id ?? '',
      title: issue.title ?? '',
      // 07-03 HOTFIX — scrub the raw terminal.label so the rendered action can
      // NEVER carry a raw UUID (mirrors the JOB path's humanize-snapshot.ts).
      humanAction: scrubHumanAction(terminal, viewerUserId, nameByUuid),
      terminalKind: terminal.kind,
      // Plan 12-03 Task 1 (NY-03 / D-09) — carry the engine verdict straight off
      // the chain (classifyVerdict already ran inside flattenBlockerChain /
      // unclassifiedChain). No new compute, no new fetch.
      actionAffordance: chain.actionAffordance,
      ownerName: ownerUuid ? (nameByUuid.get(ownerUuid) ?? null) : null,
      ownerAgentId: ownerUuid,
      age_ms: ageMsFrom(issue),
      // Plan 14-04 Task 2 — the <ReplyInPlace> fields. awaitedPartyLabel = the
      // PARTY only (a name/role), NOT the full action sentence (the 2026-06-15
      // legibility fix — see scrubAwaitedParty); the full line is `humanAction`
      // above. targetAgentUuid/leafIssueUuid are dispatch-only (NO_UUID_LEAK);
      // decisionOptions null (no action card on the org backlog this phase).
      awaitedPartyLabel: scrubAwaitedParty(terminal, viewerUserId, nameByUuid),
      targetAgentUuid: chain.targetAgentUuid ?? null,
      decisionOptions: null,
      leafIssueUuid: chain.targetIssueUuid ?? null,
      needsDurabilityFlip,
    });
  }

  return {
    rows,
    total,
    blocked_count: total,
    need_you_count: needYou,
    overflow: total > CAP,
  };
}
