// src/worker/situation/build-employees-rollup.ts
//
// Plan 08-01 Task 3 — ROOM-13/15/16/17. The per-employee rollup builder for the
// people-first Situation Room cockpit. One row per company-scope agent, joining:
//   - roster              (ctx.agents.list)
//   - open assigned issues (ctx.issues.list, client-side OPEN_STATUSES filter)
//   - heartbeat freshness  (Agent.lastHeartbeatAt)
//   - polished focus line  (polishTldr — Reader/Chat voice parity, ROOM-15)
//   - 5-state classifier   (classifyEmployeeState — ROOM-14)
//   - reused chain pipeline (flattenBlockerChain + pickTopChains + scrubHumanAction)
//
// REUSE (Don't-Hand-Roll): the BFS edge build is the EXPORTED buildEdges from
// org-blocked-backlog.ts; the chain flatten/rank are the shared blocker-chain
// primitives; the NO_UUID_LEAK scrub is the shared scrubHumanAction (Task 1);
// the focus polish is polishTldr; the classifier is the Task 2 pure function.
//
// Degrade-safe per Pitfall 4: per-agent compute runs in Promise.all with a
// per-row try/catch that returns a {state:'unknown'} row so one slow/failing
// agent never stalls the whole snapshot. Instance-agnostic (no company-prefix
// literal). NO_UUID_LEAK by construction (Pitfall 7).

import {
  flattenBlockerChain,
  pickTopChains,
  classifyVerdict,
} from '../../shared/blocker-chain.ts';
import { scrubHumanAction } from '../../shared/scrub-human-action.ts';
import type { ActionCard, BlockerChainResult, Terminal } from '../../shared/types.ts';
import { polishTldr } from '../agents/compile-tldr.ts';
import {
  classifyEmployeeState,
  type EmployeeState,
} from './classify-employee-state.ts';
// Plan 12-08 (SC5 / BEAAA-972 fix) — the SAME worker-side liveness projection
// both BFS builders use. The rollup injects the FOCUS (root) issue's own meta
// into nodeMeta before flattenBlockerChain so a blocked issue with zero
// STRUCTURED blockers classifies from its own state (→ AWAITING_AGENT_STUCK),
// identically to the Reader (flatten-blocker-chain.walkBlockerChain). NO new
// host fetch — focusIssue + the agent's heartbeat are already in hand.
import { resolveAgentState } from './agent-liveness.ts';
// Plan 17-02 Task 2 (WAIT-02 / SC5) — the SINGLE shared merge helper, called
// IDENTICALLY here, in flatten-blocker-chain.ts, and in org-blocked-backlog.ts so
// the structured wait is merged on EVERY path (kills the BEAAA-972 divergence).
import { applyStructuredWait } from './apply-structured-wait.ts';
// Plan 09-01 Task 1 — R2 worker-tier group bucket. The pure classifier maps
// state → {needs_you|working|idle}; the UI groups BY this field and renders the
// worker sort verbatim WITHIN each group (no client-side grouping/re-sort).
import {
  groupForState,
  type EmployeeGroup,
} from './group-employee-state.ts';
import {
  buildEdges,
  type OrgBlockedBacklogCtx,
} from '../handlers/org-blocked-backlog.ts';
// Plan 16-03 (Wave B) Task 2 — the bounded pool from 16-01. Replaces the rollup's
// unbounded Promise.all(agents.map(...)) per-agent fan-out so a large roster
// cannot stampede the host (T-16-01); same LIMIT as the shared edge-graph build.
import { mapBounded } from '../util/map-bounded.ts';
// Plan 12-02 (NY-02) — the PURE leverage helper. Needs-you rows are ranked by
// leverage (count of distinct blocked items whose flattened chain terminates at
// this action, D-01) descending, tie-break stable leaf id ascending (D-02), with
// per-leaf dedup (D-03). Leverage is a SORT KEY ONLY (D-07) and Situation-Room-
// only (D-08). The helper reverse-counts the engine-supplied leaf keys already on
// the rows — NO new host fetch.
import {
  computeLeverageByLeaf,
  sortActionItemsByLeverage,
  type LeverageInputRow,
} from './leverage.ts';

export type AgeBucket = 'fresh' | 'aging' | 'stale';

/**
 * Plan 11-06 Task 3 (WR-06 / SC5) — the SINGLE viewer-targeting predicate.
 *
 * "Does this blocker chain await the VIEWER specifically?" — true only when the
 * terminal is AWAITING_HUMAN and its userId (a USER uuid) equals the viewer. A
 * genuinely-UNOWNED chain has NO userId (it is org-wide, not viewer-specific) and
 * every other kind is non-human, so both return false. Declaring this ONCE and
 * reading it everywhere kills the WR-06 desync risk: the __targetsViewer flag and
 * the needs-you count partition can no longer compute viewer-targeting two
 * different ways that a future Terminal-kind change could silently disagree on.
 *
 * Degrade-safe: a null/undefined terminal → false. Pure: no clock, no I/O.
 */
export function rowTargetsViewer(
  terminal: Terminal | null | undefined,
  viewerUserId: string,
): boolean {
  return !!terminal && terminal.kind === 'AWAITING_HUMAN' && terminal.userId === viewerUserId;
}

export type SituationEmployeeRow = {
  agentId: string;
  /** Resolved displayName, NEVER UUID. */
  name: string;
  /** prefer Agent.title ?? Agent.role ?? 'agent'. */
  role: string;
  state: EmployeeState;
  /** Plan 09-01 (R2) — worker-assigned display bucket. needs_you=blocked;
   *  working=running|reviewing; idle=idle|stale|unknown. The UI groups BY this
   *  and renders the worker sort verbatim within each group. */
  group: EmployeeGroup;
  /** Plan 09-01 D-04 — true when the agent's host status is 'paused' (stood
   *  down). INDEPENDENT of `group` — a paused agent still buckets as 'idle';
   *  this only drives the UI's paused marker + one-click Resume so no separate
   *  per-row fetch is needed. Defaults false for degrade-safe rows. */
  isPaused: boolean;
  /** Human identifier (e.g. BEAAA-1086), NOT uuid. */
  focusIssueId: string | null;
  /** Polished one-liner ≤80 chars; null for idle/stale (no work-in-flight). */
  focusLine: string | null;
  /** ISO; or null when no signal. */
  lastActivityAt: string | null;
  ageBucket: AgeBucket;
  blockerChain: {
    rootIssueId: string;
    /** Human identifier; root identifier on leaf-fetch failure; null only when
     *  BOTH lookups fail. NEVER a uuid-suffix string (M2). DISPLAY ONLY. */
    leafIssueId: string | null;
    /** Plan 09-04 (R3) — the leaf issue UUID, the MUTATION id for
     *  situation.assignOwner → ctx.issues.update. Sourced from a UUID
     *  (leaf.id / leafNodeId / focusIssue.id), NEVER from any .identifier.
     *  Consumed ONLY as an action arg / prop (NO_UUID_LEAK / T-08-UI) — the
     *  human leafIssueId stays the only displayed identifier. */
    leafIssueUuid: string | null;
    /** Scrubbed via shared scrubHumanAction — NO_UUID_LEAK. */
    humanAction: string;
    /** "Unassigned" when genuinely UNOWNED — NO_UUID_LEAK. */
    ownerName: string;
    /** AGENT uuid (focusIssue.assigneeAgentId), NOT terminal.userId (USER uuid).
     *  See B1. Consumed by buildChatDeepLink({assigneeAgentId}) in Plan 08-02. */
    ownerAgentId: string | null;
    // Plan 11-03 (D-13/D-14) — the engine verdict. Needs-you membership and the
    // single-affordance grouping read THESE, never an ownerName string-match (SC5).
    /** Plan 11-03 — true only when a *person* must act (AWAITING_HUMAN / UNOWNED). */
    needsYou: boolean;
    /** Plan 11-03 — cockpit segment: 'needs-you' | 'in-motion' | 'watch'. */
    tier: BlockerChainResult['tier'];
    /** Plan 11-03 — the single control the row offers ('assign' ONLY for UNOWNED). */
    actionAffordance: BlockerChainResult['actionAffordance'];
    // Plan 11-03 (D-15 / NO_UUID_LEAK) — split identity. awaitedPartyLabel is the
    // ONLY rendered display string (scrubbed of UUIDs); the *Uuid fields are
    // mutation-only dispatch targets, NEVER rendered, mirroring leafIssueUuid.
    /** Plan 11-03 — rendered awaited-party display string; scrubbed, no raw UUID. */
    awaitedPartyLabel: string;
    /** Plan 11-03 — awaited agent UUID for the nudge/reply mutation; NEVER rendered. */
    targetAgentUuid: string | null;
    /** Plan 11-03 — leaf issue UUID for the open/assign mutation; NEVER rendered. */
    targetIssueUuid: string | null;
    // Plan 16-04 Task 1 (T-16-03 / BLOCKER 2) — the AWAITING_HUMAN terminal's USER
    // uuid, captured so the VIEWER-INVARIANT cached row carries enough terminal
    // metadata for buildNeedsYou(rows, viewerUserId) to RE-partition the
    // viewer-targeted set per call (no cross-viewer leak). Set ONLY when the
    // terminal kind is AWAITING_HUMAN; null for every other kind (UNOWNED, agent
    // kinds, UNCLASSIFIED). This is a DISPATCH/PARTITION key, NOT a render field —
    // a viewer's own uuid compared to it never produces a rendered string (the
    // scrubbed humanAction / awaitedPartyLabel are the only displayed party text).
    awaitedUserId: string | null;
    // Plan 14-04 Task 1 (BLOCKER 5 / BLOCKER 2+4) — the two signals waves 2-3
    // depend on, threaded onto the row data model. Both are read DIRECTLY by
    // isReplyReachable (14-02) + <ReplyInPlace> (14-03); neither is re-derived
    // from data.terminal.kind in the view layer.
    /** Plan 14-04 — the leaf Terminal kind STRING (= picked.terminal.kind;
     *  'UNCLASSIFIED' on the degrade row). isReplyReachable(terminalKind) reads
     *  THIS — never the full Terminal union, never a re-derived kind. */
    terminalKind: Terminal['kind'];
    /** Plan 14-04 (T-14-19) — the Shape-B durable-flip signal: true iff the LEAF
     *  issue's status === 'blocked' at build time (resolved leaf.status ??
     *  focusIssue.status), derived from the REAL leaf status — NOT a terminal.kind
     *  proxy. Dispatch INPUT to <ReplyInPlace> (drives comment-only vs comment+flip);
     *  NEVER rendered. */
    needsDurabilityFlip: boolean;
    /** Plan 11-03 (D-09) — set only on an honest UNCLASSIFIED degrade. */
    degradeReason?: string;
  } | null;
  /** 0 for v1.2.0 — informational; deferred per Open Question #3. */
  doneTodayCount: number;
  /** Plan 13-02 (D-13) — the Editor-Agent action card for this needs-you row,
   *  attached by the situation.snapshot handler AFTER the rollup (a fresh card
   *  → the ActionCard; stale/absent/degrade → null so the UI falls back to the
   *  deterministic blockerChain line, D-12). Optional: the builder does not set
   *  it; only the handler does. */
  actionCard?: ActionCard | null;
};

export type NeedsYou = {
  count: number;
  topAction: {
    agentId: string;
    humanAction: string;
    /** Human identifier — DISPLAY ONLY. */
    leafIssueId: string | null;
    /** Plan 09-04 (R3) — the leaf issue UUID (the mutation id the picker
     *  dispatches to situation.assignOwner). Mirrors the source row's
     *  blockerChain.leafIssueUuid; UUID source, never an .identifier. */
    leafIssueUuid: string | null;
  } | null;
};

/** The structural ctx the builder accepts — a superset of OrgBlockedBacklogCtx
 *  that additionally needs agents.list + issues.get (leaf identifier lookup).
 *  Stubbable in tests; satisfied at runtime by the widened SituationRoomCtx.
 *
 *  Plan 16-02 (Wave A) — inherits the SnapshotPrefetch fields (blockedIssues,
 *  nameByUuid, edgeGraph) from OrgBlockedBacklogCtx AND adds the rollup-specific
 *  prefetch slice (roster, open issues grouped by agent, issues by id for leaf
 *  lookups). Every prefetch field is OPTIONAL: a builder reads it when present
 *  and falls back to the original RPC path when absent (degrade-safety + old
 *  fixtures). */
export type EmployeesRollupCtx = OrgBlockedBacklogCtx & {
  issues: OrgBlockedBacklogCtx['issues'] & {
    list(input: {
      companyId: string;
      assigneeAgentId?: string;
      status?: string;
      limit?: number;
    }): Promise<unknown[]>;
    get(issueId: string, companyId: string): Promise<unknown | null>;
  };
  agents?: {
    list(input: { companyId: string }): Promise<unknown[]>;
    get(agentId: string, companyId: string): Promise<unknown | null>;
  };
  /** Plan 16-02 — the prefetched roster (camelCase-mapped from the public.agents
   *  SELECT). When present, REPLACES ctx.agents.list. */
  roster?: AgentLike[];
  /** Plan 16-02 — the prefetched OPEN issues grouped by assignee_agent_id
   *  (camelCase-mapped, EXCLUDE_OPERATION_ISSUES_SQL already applied in the
   *  handler SELECT). When present, REPLACES the per-agent ctx.issues.list. */
  issuesByAgentId?: Map<string, IssueLike[]>;
  /** Plan 16-02 — the prefetched issue set keyed by issue id (UUID). When present
   *  AND the leaf is in-company, REPLACES the multi-hop leaf ctx.issues.get;
   *  falls back to the RPC only for a leaf NOT in the prefetch. */
  issuesById?: Map<string, IssueLike>;
};

/** Loosely-typed projections — read camelCase (07-01 proved the real shape). */
type AgentLike = {
  id?: string;
  name?: string;
  role?: string;
  title?: string | null;
  lastHeartbeatAt?: string | null;
  // Plan 09-01 D-04 — host agent status (e.g. 'paused' when stood down).
  // Mirrors editor-pause-status.ts's authoritative paused detection
  // (a.status === 'paused' || a.pausedAt != null).
  status?: string | null;
  pausedAt?: string | null;
};
type IssueLike = {
  id?: string;
  identifier?: string | null;
  title?: string;
  status?: string;
  assigneeAgentId?: string | null;
  lastActivityAt?: string | null;
};

const OPEN_STATUSES = new Set(['in_progress', 'in_review', 'blocked']);

const FRESH_MS = 4 * 60 * 60 * 1000; // <4h
const STALE_MS = 24 * 60 * 60 * 1000; // ≥24h

/** Internal row carrying transient sort/needsYou fields stripped before return. */
type InternalRow = SituationEmployeeRow & {
  __targetsViewer: boolean;
  __activityMs: number | null;
};

const EMPTY: { employees: SituationEmployeeRow[]; needsYou: NeedsYou } = {
  employees: [],
  needsYou: { count: 0, topAction: null },
};

/** Status-priority focus pick: blocked > in_review > in_progress; tie-break by
 *  lastActivityAt DESC (Open Question #4 — planner discretion). */
function pickFocus(open: IssueLike[]): IssueLike | null {
  if (open.length === 0) return null;
  const rank = (s: string | undefined): number =>
    s === 'blocked' ? 0 : s === 'in_review' ? 1 : s === 'in_progress' ? 2 : 3;
  const t = (i: IssueLike): number =>
    i.lastActivityAt ? Date.parse(i.lastActivityAt) : 0;
  return [...open].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return t(b) - t(a); // most-recent first within same status
  })[0]!;
}

function ageBucketFrom(activityMs: number | null, nowMs: number): AgeBucket {
  if (activityMs == null) return 'stale';
  const age = nowMs - activityMs;
  if (age < FRESH_MS) return 'fresh';
  if (age < STALE_MS) return 'aging';
  return 'stale';
}

/** Plan 09-01 D-04 — authoritative paused detection. Mirrors
 *  editor-pause-status.ts:168 (`a.status === 'paused' || a.pausedAt != null`)
 *  so the worker-tier marker agrees with the pause-banner's own check. */
function isAgentPaused(agent: AgentLike): boolean {
  return agent.status === 'paused' || agent.pausedAt != null;
}

/** A degrade-safe row for an agent whose per-row compute threw. NEVER a UUID
 *  in name (falls back to the agent's name string or empty — never the id). */
function degradeSafeRow(agent: AgentLike): InternalRow {
  return {
    agentId: agent.id ?? '',
    name: typeof agent.name === 'string' && agent.name ? agent.name : 'Unknown',
    role: agent.title ?? agent.role ?? 'agent',
    state: 'unknown',
    // Plan 09-01 R2 — degrade-safe rows bucket as 'idle' (group of 'unknown').
    group: groupForState('unknown'),
    // Plan 09-01 D-04 — paused marker survives a degraded row when the host
    // status is still readable; default false otherwise (never block a render).
    isPaused: isAgentPaused(agent),
    focusIssueId: null,
    focusLine: null,
    lastActivityAt: null,
    ageBucket: 'stale',
    blockerChain: null,
    doneTodayCount: 0,
    __targetsViewer: false,
    __activityMs: null,
  };
}

async function buildOneEmployeeRow(
  ctx: EmployeesRollupCtx,
  agent: AgentLike,
  companyId: string,
  viewerUserId: string,
  nowMs: number,
): Promise<InternalRow> {
  const agentId = agent.id ?? '';

  // a. List open assigned issues. Plan 16-02 (Wave A) — when the handler supplied
  //    the prefetched open-issue set grouped by assignee_agent_id, read this
  //    agent's slice from it (one shared SELECT replaces one ctx.issues.list per
  //    agent); otherwise fall back to the per-agent RPC list (old fixtures +
  //    degrade-safety). limit: 50 defensively bounds the RPC fallback fetch.
  const listed = ctx.issuesByAgentId
    ? (ctx.issuesByAgentId.get(agentId) ?? [])
    : ((await ctx.issues.list({ companyId, assigneeAgentId: agentId, limit: 50 })) as IssueLike[]);
  // b. Filter to OPEN_STATUSES.
  const open = (Array.isArray(listed) ? listed : []).filter(
    (i) => i && typeof i === 'object' && OPEN_STATUSES.has(String(i.status)),
  );

  // c. Pick focus issue.
  const focusIssue = pickFocus(open);
  // d. Top open issue status drives classification.
  const topOpenIssueStatus =
    (focusIssue?.status === 'in_progress' ||
    focusIssue?.status === 'in_review' ||
    focusIssue?.status === 'blocked'
      ? focusIssue.status
      : null) as 'in_progress' | 'in_review' | 'blocked' | null;

  // e. Heartbeat freshness — the SOLE running signal.
  const lastHeartbeatMs = agent.lastHeartbeatAt ? Date.parse(agent.lastHeartbeatAt) : null;
  const lastHeartbeatValid = lastHeartbeatMs != null && Number.isFinite(lastHeartbeatMs);

  // f. Activity signal — focus issue lastActivityAt, else heartbeat (Open Q#2).
  const focusActivityMs = focusIssue?.lastActivityAt ? Date.parse(focusIssue.lastActivityAt) : null;
  const lastActivityMs =
    focusActivityMs != null && Number.isFinite(focusActivityMs)
      ? focusActivityMs
      : lastHeartbeatValid
        ? lastHeartbeatMs
        : null;

  // g. Classify.
  const state = classifyEmployeeState({
    lastHeartbeatMs: lastHeartbeatValid ? lastHeartbeatMs : null,
    topOpenIssueStatus,
    lastActivityMs,
    nowMs,
  });

  // h. focusLine — null for idle/stale; else polishTldr(title) truncated ≤80.
  let focusLine: string | null = null;
  if (state !== 'idle' && state !== 'stale') {
    const rawFocus = focusIssue?.title ?? '';
    const polished = polishTldr(rawFocus);
    focusLine = polished.length > 80 ? `${polished.slice(0, 77)}…` : polished || null;
  }

  // i. blockerChain — only when blocked AND a focus issue exists.
  let blockerChain: SituationEmployeeRow['blockerChain'] = null;
  let targetsViewer = false;
  if (state === 'blocked' && focusIssue && focusIssue.id) {
    try {
      // Plan 16-02 (Wave A) — read this focus issue's edges from the shared memo
      // the handler built ONCE across {blocked roots} ∪ {blocked agent focus}
      // (no second relations walk). A memo'd UNCLASSIFIED sentinel (a thrown
      // prefetch walk) is re-thrown so the existing per-row catch floors the row
      // to the honest inline UNCLASSIFIED block. A memo miss falls back to a
      // direct buildEdges (degrade-safety + old fixtures).
      const memo = ctx.edgeGraph?.get(focusIssue.id);
      if (memo && 'unclassified' in memo) {
        throw new Error(memo.degradeReason);
      }
      const { edges, nodeMeta } = memo
        ? { edges: memo.edges, nodeMeta: { ...memo.nodeMeta } }
        : await buildEdges(
            ctx as unknown as OrgBlockedBacklogCtx,
            companyId,
            focusIssue.id,
          );
      // Plan 12-08 (SC5 / BEAAA-972 fix) — inject the ROOT (focus) issue's OWN
      // meta into nodeMeta[focusIssue.id], with the IDENTICAL field shape
      // buildEdges/walkBlockerChain use for blocker targets. When the focus issue
      // is blocked with ZERO structured blockers, edges is empty and the start IS
      // the leaf; the engine then classifies from THIS meta (→ AWAITING_AGENT_STUCK
      // for an agent owner) instead of falling through to UNOWNED. No new host
      // fetch — focusIssue + the agent heartbeat are already resolved above.
      // Do NOT clobber a meta buildEdges already attached for this id (it can
      // appear as a blocker TARGET in a deeper graph); only fill when absent.
      if (nodeMeta[focusIssue.id] == null) {
        const rootAssigneeAgentId =
          typeof focusIssue.assigneeAgentId === 'string' && focusIssue.assigneeAgentId.length > 0
            ? focusIssue.assigneeAgentId
            : null;
        const rootStatus =
          typeof focusIssue.status === 'string' ? focusIssue.status : 'awaiting';
        // Plan 12-08 (locked product decision) — a BLOCKED root with an agent
        // owner is AWAITING_AGENT_STUCK by definition (the issue is blocked, so the
        // agent is not progressing on it). Force agentState='stuck' for a blocked
        // root; otherwise defer to the shared liveness projection. Mirrors
        // flatten-blocker-chain.walkBlockerChain EXACTLY (SC5 same-shape invariant).
        const rootAgentState: 'working' | 'stuck' | null =
          rootAssigneeAgentId == null
            ? null
            : rootStatus === 'blocked'
              ? 'stuck'
              : resolveAgentState({
                  lastHeartbeatMs: lastHeartbeatValid ? lastHeartbeatMs : null,
                  hasQueuedWork: false,
                  nowMs,
                });
        nodeMeta[focusIssue.id] = {
          ownerUserId:
            (focusIssue as { assigneeUserId?: string | null; ownerUserId?: string | null })
              .assigneeUserId ??
            (focusIssue as { ownerUserId?: string | null }).ownerUserId ??
            null,
          etaIso: (focusIssue as { etaIso?: string | null }).etaIso ?? null,
          status: rootStatus,
          assigneeAgentId: rootAssigneeAgentId,
          agentState: rootAgentState,
          // Plan 17-02 (SC5) — init null; applyStructuredWait below merges the wait.
          structuredWaitOwnerUserId: null,
          structuredWaitOneLiner: null,
        };
      }
      // Plan 17-02 Task 2 (WAIT-02 / SC5) — merge the persisted structured wait
      // onto the ROOT (focus) node via the SHARED helper, IDENTICALLY to the other
      // two root-meta write sites. Runs whether or not the root entry was injected
      // above (it may already exist from a deeper graph); the helper is a no-op when
      // no wait exists for this issue. nodeMeta is the local clone (`{ ...memo.nodeMeta }`)
      // so the shared memo is never mutated. ctx.waitMap is threaded by 17-02 Task 1.
      if (ctx.waitMap && nodeMeta[focusIssue.id]) {
        applyStructuredWait(nodeMeta, focusIssue.id, ctx.waitMap);
      }
      const chain = flattenBlockerChain({ startId: focusIssue.id, edges, nodeMeta, viewerUserId });
      const picked = pickTopChains([chain], 1)[0];
      if (picked) {
        const terminal = picked.terminal;
        // i.2. Collect UUIDs from terminal.label + (AWAITING_HUMAN) userId.
        const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const wanted = new Set<string>(terminal.label.match(uuidRe) ?? []);
        if (terminal.kind === 'AWAITING_HUMAN') {
          wanted.add(terminal.userId);
        }
        // Plan 16-02 (Wave A) — resolve names from the prefetched nameByUuid Map
        // (built ONCE from the public.agents SELECT) when the handler supplied
        // it: NO per-uuid ctx.agents.get round-trips. A missing uuid still yields
        // null (NO_UUID_LEAK), NEVER the raw UUID. Falls back to the per-uuid RPC
        // Promise.all only when the prefetch is absent (old fixtures +
        // degrade-safety).
        let nameByUuid: Map<string, string | null>;
        if (ctx.nameByUuid != null) {
          nameByUuid = ctx.nameByUuid;
        } else {
          nameByUuid = new Map<string, string | null>();
          if (typeof ctx.agents?.get === 'function') {
            await Promise.all(
              [...wanted].map(async (u) => {
                try {
                  const ag = (await ctx.agents!.get(u, companyId)) as { name?: unknown } | null;
                  const candidate =
                    ag && typeof ag.name === 'string' ? ag.name.trim() : null;
                  nameByUuid.set(u, candidate || null);
                } catch {
                  // D-09 — degrade silently to null; NEVER the UUID.
                  nameByUuid.set(u, null);
                }
              }),
            );
          }
        }
        // i.3. NO_UUID_LEAK scrub — single source of truth (Task 1). This is the
        //      rendered awaitedPartyLabel; the verdict's own awaitedPartyLabel is
        //      the raw terminal.label, so the scrubbed string is the display value.
        const humanAction = scrubHumanAction(terminal, viewerUserId, nameByUuid);
        // i.4. B1 — ownerAgentId MUST be focusIssue.assigneeAgentId (AGENT uuid).
        //      terminal.userId is a USER uuid — different namespace; consumed only
        //      for needsYou viewer-match below.
        const ownerAgentId =
          typeof focusIssue.assigneeAgentId === 'string' && focusIssue.assigneeAgentId.length > 0
            ? focusIssue.assigneeAgentId
            : null;
        // i.5. ownerName follows the AWAITING_HUMAN userId (the "Waiting on X"
        //      display); a genuinely-UNOWNED chain has NO userId → 'Unassigned'.
        const ownerName =
          terminal.kind === 'AWAITING_HUMAN'
            ? (nameByUuid.get(terminal.userId) ?? 'Unassigned')
            : 'Unassigned';
        // i.6. rootIssueId — human identifier.
        const rootIssueId = focusIssue.identifier ?? focusIssue.id;
        // i.7. M2 — leafIssueId fallback chain = leaf identifier → focusIssue.identifier → null.
        //      NEVER a uuid-suffix.
        let leafIssueId: string | null = focusIssue.identifier ?? null;
        // i.7b. Plan 09-04 (R3) — leafIssueUuid is the MUTATION id (the issue
        //       UUID), carried alongside the human leafIssueId. UUID candidate
        //       chain: leaf.id (the line-317 leaf fetch) → leafNodeId
        //       (picked.pathIds[last]) → focusIssue.id. NEVER an .identifier.
        const leafNodeId = picked.pathIds[picked.pathIds.length - 1];
        let leafIssueUuid: string | null =
          (typeof leafNodeId === 'string' && leafNodeId.length > 0 ? leafNodeId : null) ??
          (typeof focusIssue.id === 'string' && focusIssue.id.length > 0 ? focusIssue.id : null);
        // Plan 14-04 Task 1 (T-14-19) — capture the LEAF issue status for the
        // Shape-B needsDurabilityFlip. Single-hop: the leaf IS the focus →
        // focusIssue.status. Multi-hop: the EXISTING leaf fetch below resolves
        // leaf.status (NO new host fetch — same ctx.issues.get already made for
        // leafIssueId/leafIssueUuid). Derived from the REAL status, never terminal.kind.
        let leafStatus: string | null =
          typeof focusIssue.status === 'string' ? focusIssue.status : null;
        if (leafNodeId && leafNodeId !== focusIssue.id) {
          try {
            // Plan 16-02 (Wave A) — serve the leaf from the prefetched issue set
            // when it is in-company (one shared SELECT replaces one
            // ctx.issues.get per multi-hop chain); fall back to the RPC ONLY for
            // a leaf NOT in the prefetch (e.g. a blocker outside the open-issue
            // working set).
            const prefetchedLeaf = ctx.issuesById?.get(leafNodeId);
            const leaf = (prefetchedLeaf ??
              (await ctx.issues.get(leafNodeId, companyId))) as IssueLike | null;
            if (leaf && typeof leaf.identifier === 'string' && leaf.identifier.length > 0) {
              leafIssueId = leaf.identifier;
            }
            // Prefer the resolved leaf.id (a UUID) when present — same fetch.
            if (leaf && typeof leaf.id === 'string' && leaf.id.length > 0) {
              leafIssueUuid = leaf.id;
            }
            // Plan 14-04 — the resolved leaf status from the SAME fetch wins over
            // focusIssue.status (the leaf may differ from the focus on a multi-hop chain).
            if (leaf && typeof leaf.status === 'string' && leaf.status.length > 0) {
              leafStatus = leaf.status;
            }
          } catch {
            // Fall back to focusIssue.identifier (already set above). NEVER emit
            // a uuid-suffix string. leafIssueUuid stays the leafNodeId/focusIssue.id
            // UUID (never the .identifier).
          }
        }
        // i.8. Plan 11-03 (D-15) — split identity passthrough. The verdict's
        //      targetAgentUuid (an AWAITING_AGENT_* agentId) is mutation-only;
        //      the targetIssueUuid is the leaf UUID resolved above. The
        //      awaitedPartyLabel is the SCRUBBED humanAction (the only rendered
        //      string) — NO raw UUID enters a rendered field (Pitfall 5).
        // Plan 14-04 Task 1 (T-14-19) — the Shape-B durable-flip signal off the
        // REAL leaf status (NOT terminal.kind): true iff the leaf issue is
        // currently status='blocked'. Computed ONCE; the handler (14-01) fires the
        // durability flip off THIS boolean.
        const needsDurabilityFlip = leafStatus === 'blocked';
        blockerChain = {
          rootIssueId,
          leafIssueId,
          leafIssueUuid,
          humanAction,
          ownerName,
          ownerAgentId,
          // D-13/D-14 — the engine verdict drives needs-you re-triage + grouping.
          needsYou: picked.needsYou,
          tier: picked.tier,
          actionAffordance: picked.actionAffordance,
          // D-15 — rendered display = the scrubbed humanAction; UUIDs mutation-only.
          awaitedPartyLabel: humanAction,
          targetAgentUuid: picked.targetAgentUuid ?? null,
          targetIssueUuid: leafIssueUuid,
          // Plan 16-04 (T-16-03 / BLOCKER 2) — capture the AWAITING_HUMAN USER uuid
          // so the viewer-invariant cached row lets buildNeedsYou re-partition the
          // viewer-targeted set per call. Only AWAITING_HUMAN carries a userId.
          awaitedUserId: terminal.kind === 'AWAITING_HUMAN' ? terminal.userId : null,
          // Plan 14-04 — the leaf Terminal kind (read by isReplyReachable) + the
          // real-leaf-status durable-flip signal (read by <ReplyInPlace>).
          terminalKind: terminal.kind,
          needsDurabilityFlip,
          ...(picked.degradeReason != null ? { degradeReason: picked.degradeReason } : {}),
        };

        // WR-06 (Plan 11-06) — SINGLE-SOURCE viewer-targeting. The flag and the
        // needs-you count partition can no longer derive "does this row target the
        // viewer?" two independent ways: the ONE pure predicate rowTargetsViewer
        // owns the AWAITING_HUMAN-userId-equals-viewer check (the legitimate use of
        // terminal.userId, mirrors org-blocked-backlog.ts:418-461). A future
        // Terminal-kind change updates exactly one place.
        targetsViewer = rowTargetsViewer(terminal, viewerUserId);
      }
    } catch (e) {
      // i.9. Plan 11-03 (D-09/TAX-03) — a thrown chain build emits an honest
      //      UNCLASSIFIED verdict row (open affordance, never a false assign),
      //      NOT blockerChain = null. The row stays visible with state='blocked'.
      ctx.logger?.warn?.('build-employees-rollup: chain build failed', {
        agentId,
        err: (e as Error).message,
      });
      const degradeReason = (e as Error).message || 'chain-build-failed';
      const rootIssueId = focusIssue.identifier ?? focusIssue.id;
      const focusUuid =
        typeof focusIssue.id === 'string' && focusIssue.id.length > 0 ? focusIssue.id : null;
      const unclassifiedTerminal: Terminal = {
        kind: 'UNCLASSIFIED',
        label: `Can't determine blocker for ${rootIssueId} — open to investigate`,
      };
      const verdict = classifyVerdict(unclassifiedTerminal);
      // Scrub the honest fallback line (no UUID can leak — rootIssueId is a human
      // identifier, but the scrub is belt-and-suspenders for the focusIssue.id path).
      const humanAction = scrubHumanAction(unclassifiedTerminal, viewerUserId, new Map());
      blockerChain = {
        rootIssueId,
        leafIssueId: focusIssue.identifier ?? null,
        leafIssueUuid: focusUuid,
        humanAction,
        ownerName: 'Unassigned',
        ownerAgentId:
          typeof focusIssue.assigneeAgentId === 'string' && focusIssue.assigneeAgentId.length > 0
            ? focusIssue.assigneeAgentId
            : null,
        needsYou: verdict.needsYou,
        tier: verdict.tier,
        actionAffordance: verdict.actionAffordance,
        awaitedPartyLabel: humanAction,
        targetAgentUuid: null,
        targetIssueUuid: focusUuid,
        // Plan 16-04 (T-16-03) — the degrade row is UNCLASSIFIED (no human userId).
        awaitedUserId: null,
        // Plan 14-04 Task 1 — the degrade row is honestly UNCLASSIFIED; the flip
        // reads the REAL focusIssue.status (blocked by construction here since
        // state==='blocked' gated the chain build) — kept honest, not hardcoded.
        terminalKind: 'UNCLASSIFIED' as const,
        needsDurabilityFlip: focusIssue.status === 'blocked',
        degradeReason,
      };
    }
  }

  return {
    agentId,
    name: typeof agent.name === 'string' && agent.name ? agent.name : 'Unknown',
    role: agent.title ?? agent.role ?? 'agent',
    state,
    // Plan 09-01 R2 — worker-assigned group bucket (UI groups BY this verbatim).
    group: groupForState(state),
    // Plan 09-01 D-04 — paused marker from the EXISTING agents.list response;
    // INDEPENDENT of `group` (a paused agent still buckets as 'idle').
    isPaused: isAgentPaused(agent),
    focusIssueId: focusIssue?.identifier ?? null,
    focusLine,
    lastActivityAt: lastActivityMs != null ? new Date(lastActivityMs).toISOString() : null,
    ageBucket: ageBucketFrom(lastActivityMs, nowMs),
    blockerChain,
    doneTodayCount: 0,
    __targetsViewer: targetsViewer,
    __activityMs: lastActivityMs,
  };
}

// Plan 16-03 (Wave B) Task 2 — the per-agent fan-out concurrency ceiling. SAME
// value as the shared edge-graph build's EDGE_WALK_LIMIT (situation-room.ts);
// kept in sync so the whole snapshot caps the host at one consistent ceiling
// (RESEARCH A3 — start 5). Post-16-02 most per-agent work reads the prefetch, but
// a leaf-fallback RPC may still fire, so the bound is the DoS mitigation across
// BOTH builders (T-16-01).
const ROLLUP_AGENT_LIMIT = 5;

const ORDER: Record<EmployeeState, number> = {
  blocked: 0,
  stale: 1,
  idle: 2,
  reviewing: 3,
  running: 4,
  unknown: 5,
};

/**
 * Build the per-employee rollup + needsYou compute for the situation.snapshot
 * data handler. Pure-ish (only I/O is the injected ctx SDK calls). Degrade-safe:
 * a thrown agents.list → the empty rollup; a thrown per-agent compute → that
 * row degrades to state:'unknown'.
 */
export async function buildEmployeesRollup(
  ctx: EmployeesRollupCtx,
  companyId: string,
  viewerUserId: string,
): Promise<{ employees: SituationEmployeeRow[]; needsYou: NeedsYou }> {
  // Plan 16-02 (Wave A) — the roster comes from the prefetched public.agents
  // SELECT when the handler supplied it (one SQL read replaces ctx.agents.list);
  // otherwise fall back to the RPC list (old fixtures + degrade-safety). The
  // prefetch SELECT lives in situation-room.ts and is company-scoped
  // `WHERE company_id = $1` (parameterized, no prefix literal) — this file only
  // CONSUMES those rows (the per-agent focus + roster + names).
  let agents: AgentLike[];
  if (Array.isArray(ctx.roster)) {
    agents = ctx.roster;
  } else {
    if (typeof ctx.agents?.list !== 'function') return { ...EMPTY };
    agents = (await ctx.agents.list({ companyId })) as AgentLike[];
  }
  if (!Array.isArray(agents) || agents.length === 0) return { ...EMPTY };

  // Capture nowMs ONCE so all classifier + sort calls share one clock (sort
  // determinism within a request).
  const nowMs = Date.now();

  // Plan 16-03 (Wave B) Task 2 — bounded per-agent fan-out. mapBounded caps the
  // in-flight per-agent work at ROLLUP_AGENT_LIMIT (≤5) so a large roster cannot
  // stampede the host Postgres (T-16-01). The per-row try/catch → degradeSafeRow
  // floor is UNCHANGED (already the right per-row degrade); mapBounded preserves
  // INPUT order, so the deterministic sort that follows is unaffected.
  const rows: InternalRow[] = await mapBounded(agents, ROLLUP_AGENT_LIMIT, async (agent) => {
    try {
      return await buildOneEmployeeRow(ctx, agent, companyId, viewerUserId, nowMs);
    } catch (e) {
      ctx.logger?.warn?.('build-employees-rollup: row failed', {
        agentId: agent.id,
        err: (e as Error).message,
      });
      return degradeSafeRow(agent);
    }
  });

  // Deterministic sort (LOCKED): blocked → stale → idle → reviewing → running;
  // oldest-first within blocked/stale/idle, most-recent-first within
  // reviewing/running.
  rows.sort((a, b) => {
    if (ORDER[a.state] !== ORDER[b.state]) return ORDER[a.state] - ORDER[b.state];
    const aT = a.__activityMs ?? 0;
    const bT = b.__activityMs ?? 0;
    if (a.state === 'blocked' || a.state === 'stale' || a.state === 'idle') {
      return aT - bT; // oldest-first
    }
    return bT - aT; // most-recent-first
  });

  // Plan 16-04 (BLOCKER 2 / T-16-03) — the viewer-scoped needsYou compute is now
  // the EXPORTED pure helper buildNeedsYou (below). It re-partitions the union
  // (unowned ∪ viewer-targeted) over the ALREADY-built rows and returns the
  // count + topAction for THIS viewer. The SWR handler calls it per call over the
  // cached viewer-invariant rows so two viewers over the SAME cache get distinct
  // counts (no cross-viewer leak). Here the rollup calls it directly to preserve
  // the original return shape (behavior-preserving extraction).
  const needsYou = buildNeedsYou(rows, viewerUserId);

  // Plan 12-02 (D-08) — apply the leverage order to the needs_you partition ONLY.
  // The leverage ordering re-uses the SAME partition the count is built from
  // (orderNeedsYouRows) so there is no second copy of the partition predicate.
  // Non-needs-you groups keep the LOCKED status-bucket order above. Row ordering
  // is a cosmetic leverage sort; only the viewer-scoped COUNT/topAction is
  // recomputed per call by the SWR handler.
  const orderedAgentIds = orderNeedsYouRows(rows, viewerUserId);
  const needsYouSet = new Set(orderedAgentIds);
  const orderedById = new Map(rows.map((r) => [r.agentId, r] as const));
  const needsYouOrdered = orderedAgentIds.map((id) => orderedById.get(id)!);
  // Splice the leverage-ordered needs_you rows back into the global row order at
  // the positions the needs_you rows currently occupy (they lead the locked sort,
  // so this preserves the global blocked→stale→idle→… layout while re-ordering
  // WITHIN the needs_you band).
  let nyCursor = 0;
  const reordered: InternalRow[] = rows.map((r) =>
    needsYouSet.has(r.agentId) ? needsYouOrdered[nyCursor++]! : r,
  );

  // Strip transient fields before returning the public shape.
  const employees: SituationEmployeeRow[] = reordered.map((r) => {
    const { __targetsViewer, __activityMs, ...pub } = r;
    void __targetsViewer;
    void __activityMs;
    return pub;
  });

  return { employees, needsYou };
}

// ---------------------------------------------------------------------------
// Plan 16-04 Task 1 (BLOCKER 2 / T-16-03) — the viewer-scoped needs-you partition,
// extracted as a PURE helper so the SWR handler can recompute it per call over
// the cached VIEWER-INVARIANT rows. NO fetch, NO ctx, NO clock.
// ---------------------------------------------------------------------------

/** A row carrying the blockerChain fields buildNeedsYou reads. Both the public
 *  SituationEmployeeRow and the internal row satisfy this (the public row is the
 *  cached shape; awaitedUserId + terminalKind on blockerChain make the
 *  viewer-targeting re-partition possible WITHOUT the transient __targetsViewer
 *  flag that was baked at write time for one viewer). */
type NeedsYouInputRow = Pick<SituationEmployeeRow, 'agentId' | 'group' | 'blockerChain'>;

/** Plan 16-04 — recompute "does this row target the VIEWER?" from the cached
 *  viewer-invariant terminal metadata (terminalKind + awaitedUserId) instead of
 *  the write-time __targetsViewer flag. Mirrors rowTargetsViewer EXACTLY
 *  (AWAITING_HUMAN && userId === viewer) but reads the persisted blockerChain
 *  fields a cache round-trip preserves. */
function rowTargetsViewerFromCache(
  blockerChain: SituationEmployeeRow['blockerChain'],
  viewerUserId: string,
): boolean {
  return (
    !!blockerChain &&
    blockerChain.terminalKind === 'AWAITING_HUMAN' &&
    blockerChain.awaitedUserId === viewerUserId
  );
}

/** Plan 16-04 — the single needs-you partition (unowned ∪ viewer-targeted),
 *  deduped by agentId. The ONE source of truth both buildNeedsYou (count +
 *  topAction) and orderNeedsYouRows (leverage ordering) read, so the partition
 *  predicate is never copied. Viewer-targeting is recomputed from the cached
 *  terminal metadata (T-16-03 — no cross-viewer leak). */
function partitionNeedsYouRows<R extends NeedsYouInputRow>(
  rows: R[],
  viewerUserId: string,
): R[] {
  // UNOWNED partition (Plan 11-03 D-13/D-14) — viewer-invariant: a genuinely
  // unowned chain needs a person regardless of who is looking.
  const unowned = rows.filter(
    (r) =>
      r.group === 'needs_you' &&
      r.blockerChain &&
      r.blockerChain.needsYou === true &&
      r.blockerChain.actionAffordance === 'assign',
  );
  // VIEWER-TARGETED partition — the ONLY viewer-dependent slice. Recomputed from
  // the cached terminal metadata so two viewers over identical cached rows get
  // different membership (and therefore different counts).
  const targeting = rows.filter(
    (r) => r.blockerChain && rowTargetsViewerFromCache(r.blockerChain, viewerUserId),
  );
  const out: R[] = [];
  const seen = new Set<string>(); // de-dupe by agentId (a row satisfies ≤1 set today)
  for (const r of [...unowned, ...targeting]) {
    if (seen.has(r.agentId)) continue;
    seen.add(r.agentId);
    out.push(r);
  }
  return out;
}

/** Plan 12-02 (D-01/D-03) — build the leverage-ranked action items over the
 *  needs-you partition. Shared by buildNeedsYou (count + topAction) and
 *  orderNeedsYouRows (rank map). Pure: reads only the structural leaf keys. */
function rankNeedsYouRows<R extends NeedsYouInputRow>(
  needsYouRows: R[],
): ReturnType<typeof sortActionItemsByLeverage> {
  const leverageRows: Array<LeverageInputRow & { __row: R }> = needsYouRows.map((r) => ({
    agentId: r.agentId,
    pathIds: [],
    targetIssueUuid: r.blockerChain?.targetIssueUuid ?? null,
    humanAction: r.blockerChain?.humanAction,
    leafIssueId: r.blockerChain?.leafIssueId ?? null,
    leafIssueUuid: r.blockerChain?.leafIssueUuid ?? null,
    __row: r,
  }));
  const actionItems = computeLeverageByLeaf(leverageRows);
  return sortActionItemsByLeverage(actionItems);
}

/**
 * Plan 16-04 (BLOCKER 2 / T-16-03) — the VIEWER-SCOPED needs-you compute, PURE.
 *
 * Given the already-built (cached or fresh) viewer-invariant employee rows and a
 * viewerUserId, return the NeedsYou {count, topAction} for THAT viewer by
 * re-running the union partition (unowned ∪ rowTargetsViewer) over the rows'
 * blockerChain terminal metadata. NO fetch, NO ctx, NO clock — so the SWR handler
 * can call it on every request over the cached company slice with zero round-trips
 * and zero cross-viewer leak. The SAME rows with two distinct viewerUserIds yield
 * different counts whenever a row is AWAITING_HUMAN targeted at one of them.
 */
export function buildNeedsYou(
  rows: NeedsYouInputRow[],
  viewerUserId: string,
): NeedsYou {
  const needsYouRows = partitionNeedsYouRows(rows, viewerUserId);
  const rankedItems = rankNeedsYouRows(needsYouRows);

  // Plan 12-02 (D-12) — topAction = the HIGHEST-LEVERAGE action item (top of the
  // ranked list; stable-id tie-break). The representative row supplies the shape;
  // humanAction is the already-scrubbed string (NO_UUID_LEAK).
  let topAction: NeedsYou['topAction'] = null;
  const top = rankedItems[0];
  if (top) {
    const repRow = (top.representative as LeverageInputRow & { __row: NeedsYouInputRow }).__row;
    topAction = {
      agentId: repRow.agentId,
      humanAction: repRow.blockerChain!.humanAction,
      leafIssueId: repRow.blockerChain!.leafIssueId,
      // Plan 09-04 (R3) — the mutation id (UUID) for the [Assign first ▾] picker.
      leafIssueUuid: repRow.blockerChain!.leafIssueUuid,
    };
  }

  return {
    // Plan 12-02 (D-03) — count = distinct deduped action items (one per leaf).
    count: rankedItems.length,
    topAction,
  };
}

/** Plan 16-04 — the leverage-ordered needs-you agentIds (highest-leverage first,
 *  agentId tie-break). Re-uses partitionNeedsYouRows + rankNeedsYouRows so the
 *  ordering and the count agree on membership. */
function orderNeedsYouRows<R extends NeedsYouInputRow>(
  rows: R[],
  viewerUserId: string,
): string[] {
  const needsYouRows = partitionNeedsYouRows(rows, viewerUserId);
  const rankedItems = rankNeedsYouRows(needsYouRows);
  const leafRank = new Map<string, number>();
  rankedItems.forEach((it, i) => leafRank.set(it.stableId, i));
  const leafKeyOfRow = (r: R): string | null => r.blockerChain?.targetIssueUuid ?? null;
  return [...needsYouRows]
    .sort((a, b) => {
      const ra = leafRank.get(leafKeyOfRow(a) ?? '') ?? Number.MAX_SAFE_INTEGER;
      const rb = leafRank.get(leafKeyOfRow(b) ?? '') ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
    })
    .map((r) => r.agentId);
}
