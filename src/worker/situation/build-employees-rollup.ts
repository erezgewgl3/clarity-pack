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
import type { BlockerChainResult, Terminal } from '../../shared/types.ts';
import { polishTldr } from '../agents/compile-tldr.ts';
import {
  classifyEmployeeState,
  type EmployeeState,
} from './classify-employee-state.ts';
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
    /** Plan 11-03 (D-09) — set only on an honest UNCLASSIFIED degrade. */
    degradeReason?: string;
  } | null;
  /** 0 for v1.2.0 — informational; deferred per Open Question #3. */
  doneTodayCount: number;
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
 *  Stubbable in tests; satisfied at runtime by the widened SituationRoomCtx. */
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

  // a. List open assigned issues (UNFILTERED — Pitfall 3 singular status filter;
  //    client-side filter is cheaper). limit: 50 defensively bounds the fetch.
  const listed = (await ctx.issues.list({ companyId, assigneeAgentId: agentId, limit: 50 })) as IssueLike[];
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
      const { edges, nodeMeta } = await buildEdges(
        ctx as unknown as OrgBlockedBacklogCtx,
        companyId,
        focusIssue.id,
      );
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
        const nameByUuid = new Map<string, string | null>();
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
        if (leafNodeId && leafNodeId !== focusIssue.id) {
          try {
            const leaf = (await ctx.issues.get(leafNodeId, companyId)) as IssueLike | null;
            if (leaf && typeof leaf.identifier === 'string' && leaf.identifier.length > 0) {
              leafIssueId = leaf.identifier;
            }
            // Prefer the resolved leaf.id (a UUID) when present — same fetch.
            if (leaf && typeof leaf.id === 'string' && leaf.id.length > 0) {
              leafIssueUuid = leaf.id;
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
  if (typeof ctx.agents?.list !== 'function') return { ...EMPTY };
  const agents = (await ctx.agents.list({ companyId })) as AgentLike[];
  if (!Array.isArray(agents) || agents.length === 0) return { ...EMPTY };

  // Capture nowMs ONCE so all classifier + sort calls share one clock (sort
  // determinism within a request).
  const nowMs = Date.now();

  const rows: InternalRow[] = await Promise.all(
    agents.map(async (agent) => {
      try {
        return await buildOneEmployeeRow(ctx, agent, companyId, viewerUserId, nowMs);
      } catch (e) {
        ctx.logger?.warn?.('build-employees-rollup: row failed', {
          agentId: agent.id,
          err: (e as Error).message,
        });
        return degradeSafeRow(agent);
      }
    }),
  );

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

  // needsYou — Plan 09-01 R5 (UN-FROZEN). Phase 8 counted ONLY viewer-owned
  // blocked chains, so an all-unowned org showed a permanent "✓ 0 need you".
  // R5: count = (unowned blocked rows) ∪ (viewer-targeted blocked rows),
  // de-duplicated by agentId (a row can satisfy at most one of the two
  // predicates today — ownerName 'Unassigned' ⇔ unowned ⇔ not viewer-targeted —
  // but we Set-dedupe defensively).
  //
  // UNOWNED predicate (Plan 11-03 D-13/D-14): the row is in the needs_you bucket,
  // has a blocker chain, and the ENGINE VERDICT says a person must act on a
  // genuinely-unowned chain — `needsYou === true` AND `actionAffordance === 'assign'`.
  // After Plan 12-01, 'assign' ALSO fires for AWAITING_AGENT_STUCK (needsYou false,
  // tier 'watch') — re-owning the issue is the honest answer for both. The
  // `needsYou === true` guard is therefore LOAD-BEARING here: it is what keeps
  // stuck-agent rows out of the unowned partition (D-04: stuck never enters the
  // loud Needs-you list). This replaces the legacy ownerName-equals-Unassigned
  // string-match (SC5 — single source of truth, no view-layer re-derivation). No
  // raw UUID enters this path (the verdict is structured; T-09-04 preserved).
  const unowned = rows.filter(
    (r) =>
      r.group === 'needs_you' &&
      r.blockerChain &&
      r.blockerChain.needsYou === true &&
      r.blockerChain.actionAffordance === 'assign',
  );
  const targeting = rows.filter((r) => r.__targetsViewer && r.blockerChain);

  // Plan 12-02 (NY-01/D-11) — the needs-you SET is the union of the two
  // engine-verdict partitions above (unowned ∪ viewer-targeted). Membership keys
  // STRICTLY off the engine verdict (needsYou===true via the 'assign' UNOWNED
  // partition, or rowTargetsViewer for AWAITING_HUMAN) — NEVER an ownerName
  // string-match. agent-working / self-resolving / stuck rows have needsYou false
  // and never target the viewer, so they are excluded by construction (D-11).
  const needsYouRows: InternalRow[] = [];
  const seenNeedsYou = new Set<string>(); // de-dupe by agentId (a row satisfies ≤1 set today)
  for (const r of [...unowned, ...targeting]) {
    if (seenNeedsYou.has(r.agentId)) continue;
    seenNeedsYou.add(r.agentId);
    needsYouRows.push(r);
  }

  // Plan 12-02 (D-01/D-03) — reverse-count leverage over the needs-you rows and
  // collapse PER LEAF. Each row carries its engine-supplied leaf key as
  // targetIssueUuid (the leaf node the chain terminated at). The helper reads only
  // these structural keys (NO new fetch, NO clock). The deduped action items are
  // the count (one per distinct leaf, D-03) AND the leverage-rank source.
  const leverageRows: Array<LeverageInputRow & { __row: InternalRow }> = needsYouRows.map((r) => ({
    agentId: r.agentId,
    // The leaf the chain terminates at = blockerChain.targetIssueUuid (the leaf
    // node UUID, === picked.pathIds[last]). Read as a STRUCTURAL dispatch key
    // only — never rendered (NO_UUID_LEAK). pathIds empty → helper falls back to
    // targetIssueUuid as the leaf key.
    pathIds: [],
    targetIssueUuid: r.blockerChain?.targetIssueUuid ?? null,
    humanAction: r.blockerChain?.humanAction,
    leafIssueId: r.blockerChain?.leafIssueId ?? null,
    leafIssueUuid: r.blockerChain?.leafIssueUuid ?? null,
    __row: r,
  }));
  const actionItems = computeLeverageByLeaf(leverageRows);
  const rankedItems = sortActionItemsByLeverage(actionItems);

  // Plan 12-02 (D-08) — apply the leverage order to the needs_you partition ONLY.
  // Build a leaf-key → rank-index map from the ranked action items, then stably
  // re-order the needs_you rows by their leaf's rank (highest-leverage first).
  // Non-needs-you groups keep the LOCKED status-bucket order above (D-routing:
  // Working/Idle grouping is left to the Phase 15 IA redesign).
  const leafRank = new Map<string, number>();
  rankedItems.forEach((it, i) => leafRank.set(it.stableId, i));
  const leafKeyOfRow = (r: InternalRow): string | null => r.blockerChain?.targetIssueUuid ?? null;
  const needsYouSet = new Set(needsYouRows.map((r) => r.agentId));
  const needsYouOrdered = [...needsYouRows].sort((a, b) => {
    const ra = leafRank.get(leafKeyOfRow(a) ?? '') ?? Number.MAX_SAFE_INTEGER;
    const rb = leafRank.get(leafKeyOfRow(b) ?? '') ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    // Stable secondary tie-break on agentId (deterministic; no time input).
    return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
  });
  // Splice the leverage-ordered needs_you rows back into the global row order at
  // the positions the needs_you rows currently occupy (they lead the locked sort,
  // so this preserves the global blocked→stale→idle→… layout while re-ordering
  // WITHIN the needs_you band).
  let nyCursor = 0;
  const reordered: InternalRow[] = rows.map((r) =>
    needsYouSet.has(r.agentId) ? needsYouOrdered[nyCursor++]! : r,
  );

  // Plan 12-02 (D-12) — topAction = the HIGHEST-LEVERAGE action item (top of the
  // ranked list; stable-id tie-break), NOT the oldest. The banner pick and the
  // list-top now agree. The representative row (smallest-agentId among collapsed)
  // supplies the shape; leafIssueId stays non-null for a needs-you row with a
  // chain (R4 — no dead [Assign first ▾]); humanAction is the already-scrubbed
  // string (NO_UUID_LEAK).
  let topAction: NeedsYou['topAction'] = null;
  const top = rankedItems[0];
  if (top) {
    const repRow = (top.representative as LeverageInputRow & { __row: InternalRow }).__row;
    topAction = {
      agentId: repRow.agentId,
      humanAction: repRow.blockerChain!.humanAction,
      leafIssueId: repRow.blockerChain!.leafIssueId,
      // Plan 09-04 (R3) — the mutation id (UUID) for the [Assign first ▾] picker.
      leafIssueUuid: repRow.blockerChain!.leafIssueUuid,
    };
  }

  const needsYou: NeedsYou = {
    // Plan 12-02 (D-03) — count = distinct deduped action items (one per leaf),
    // replacing the prior agentId-Set count.
    count: actionItems.length,
    topAction,
  };

  // Strip transient fields before returning the public shape.
  const employees: SituationEmployeeRow[] = reordered.map((r) => {
    const { __targetsViewer, __activityMs, ...pub } = r;
    void __targetsViewer;
    void __activityMs;
    return pub;
  });

  return { employees, needsYou };
}
