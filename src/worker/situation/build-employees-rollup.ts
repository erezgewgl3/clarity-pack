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

import { pickTopChains } from '../../shared/blocker-chain.ts';
import { flattenBlockerChain } from '../../shared/blocker-chain.ts';
import {
  scrubHumanAction,
  UNOWNED_SENTINEL,
} from '../../shared/scrub-human-action.ts';
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

export type AgeBucket = 'fresh' | 'aging' | 'stale';

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
     *  BOTH lookups fail. NEVER a uuid-suffix string (M2). */
    leafIssueId: string | null;
    /** Scrubbed via shared scrubHumanAction — NO_UUID_LEAK. */
    humanAction: string;
    /** "Unassigned" when __unowned__ — NO_UUID_LEAK. */
    ownerName: string;
    /** AGENT uuid (focusIssue.assigneeAgentId), NOT terminal.userId (USER uuid).
     *  See B1. Consumed by buildChatDeepLink({assigneeAgentId}) in Plan 08-02. */
    ownerAgentId: string | null;
  } | null;
  /** 0 for v1.2.0 — informational; deferred per Open Question #3. */
  doneTodayCount: number;
};

export type NeedsYou = {
  count: number;
  topAction: { agentId: string; humanAction: string; leafIssueId: string | null } | null;
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
        // i.2. Collect UUIDs from terminal.label + (HUMAN_ACTION_ON) userId.
        const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const wanted = new Set<string>(terminal.label.match(uuidRe) ?? []);
        if (terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId !== UNOWNED_SENTINEL) {
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
        // i.3. NO_UUID_LEAK scrub — single source of truth (Task 1).
        const humanAction = scrubHumanAction(terminal, viewerUserId, nameByUuid);
        // i.4. B1 — ownerAgentId MUST be focusIssue.assigneeAgentId (AGENT uuid).
        //      terminal.userId is a USER uuid — different namespace; consumed only
        //      for needsYou viewer-match below.
        const ownerAgentId =
          typeof focusIssue.assigneeAgentId === 'string' && focusIssue.assigneeAgentId.length > 0
            ? focusIssue.assigneeAgentId
            : null;
        // i.5. ownerName follows terminal.userId (the "Waiting on X" display).
        const ownerName =
          terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId !== UNOWNED_SENTINEL
            ? (nameByUuid.get(terminal.userId) ?? 'Unassigned')
            : 'Unassigned';
        // i.6. rootIssueId — human identifier.
        const rootIssueId = focusIssue.identifier ?? focusIssue.id;
        // i.7. M2 — leafIssueId fallback chain = leaf identifier → focusIssue.identifier → null.
        //      NEVER a uuid-suffix.
        let leafIssueId: string | null = focusIssue.identifier ?? null;
        const leafNodeId = picked.pathIds[picked.pathIds.length - 1];
        if (leafNodeId && leafNodeId !== focusIssue.id) {
          try {
            const leaf = (await ctx.issues.get(leafNodeId, companyId)) as IssueLike | null;
            if (leaf && typeof leaf.identifier === 'string' && leaf.identifier.length > 0) {
              leafIssueId = leaf.identifier;
            }
          } catch {
            // Fall back to focusIssue.identifier (already set above). NEVER emit
            // a uuid-suffix string.
          }
        }
        blockerChain = { rootIssueId, leafIssueId, humanAction, ownerName, ownerAgentId };

        // needsYou viewer-match — keys on terminal.userId (USER uuid), the
        // LEGITIMATE use of terminal.userId (mirrors org-blocked-backlog.ts:419-425).
        if (
          terminal.kind === 'HUMAN_ACTION_ON' &&
          terminal.userId !== UNOWNED_SENTINEL &&
          terminal.userId === viewerUserId
        ) {
          targetsViewer = true;
        }
      }
    } catch (e) {
      // i.8. A thrown chain build → blockerChain stays null (degraded, not a
      //      thrown row — the row still ships with state='blocked').
      ctx.logger?.warn?.('build-employees-rollup: chain build failed', {
        agentId,
        err: (e as Error).message,
      });
      blockerChain = null;
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

  // needsYou — filter rows whose terminal targeted the viewer; topAction is the
  // OLDEST blocker (smallest __activityMs first).
  const targeting = rows.filter((r) => r.__targetsViewer && r.blockerChain);
  targeting.sort((a, b) => (a.__activityMs ?? 0) - (b.__activityMs ?? 0));
  const top = targeting[0];
  const needsYou: NeedsYou = {
    count: targeting.length,
    topAction: top
      ? {
          agentId: top.agentId,
          humanAction: top.blockerChain!.humanAction,
          leafIssueId: top.blockerChain!.leafIssueId,
        }
      : null,
  };

  // Strip transient fields before returning the public shape.
  const employees: SituationEmployeeRow[] = rows.map((r) => {
    const { __targetsViewer, __activityMs, ...pub } = r;
    void __targetsViewer;
    void __activityMs;
    return pub;
  });

  return { employees, needsYou };
}
