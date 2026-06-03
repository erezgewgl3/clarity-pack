// src/worker/handlers/situation-room.ts
//
// Plan 02-04 Task 2 — situation.snapshot data handler.
//
// Plan 09-01 (WARNING 5) — this handler now computes EVERYTHING FRESH on every
// call and NO LONGER reads the materialized situation_snapshots row. The
// recompute-situation cron writer was deleted in Plan 09-01 (dead on
// paperclipai@2026.525.0 PR #6547; no synchronous UI caller), so a row is never
// written post-Phase-9 — the old SELECT + row-exists spread were permanently
// dead. The situation_snapshots TABLE is preserved (R9 additive-only; no
// migration, no DROP) — it is simply no longer written or read.
//
// Wrapped with opt-in-guard so opted-out callers receive
// {error:'OPT_IN_REQUIRED'} (OPTIN-04). companyId comes from params (the
// UI passes via useHostContext or useResolvedCompanyId).
//
// Plan 07-03 Task 2 (Phase 7 ITEM 4) — the situation.snapshot DATA HANDLER is a
// VALID HTTP-request scope (unlike the scope-dead recompute-situation job). The
// ORG-LEVEL blocked-issue backlog + the per-employee rollup (Plan 08-01) are
// computed HERE, FRESH, on every call. Both computes are degrade-safe (a thrown
// builder → an empty backlog / empty rollup, the rest of the handler intact)
// and viewer-scoped (needsYou keys on params.userId). The opt-in-guard wrap is
// unchanged.

import type {
  PluginAgentsClient,
  PluginDatabaseClient,
  PluginIssuesClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import {
  buildEdges,
  buildOrgBlockedBacklog,
  type OrgBlockedBacklog,
  type OrgBlockedBacklogCtx,
  type SharedEdgeEntry,
} from './org-blocked-backlog.ts';
// Plan 08-01 Task 3 — the per-employee rollup (ROOM-13/15/16/17) computed
// alongside org_blocked_backlog in this same valid HTTP-request scope.
import {
  buildEmployeesRollup,
  type SituationEmployeeRow,
  type NeedsYou,
  type EmployeesRollupCtx,
} from '../situation/build-employees-rollup.ts';
// Plan 15-01 Task 2 (COCK-01 / SC1 worker half / SC3) — the Pulse vital-sign
// aggregation. Pure sum over the per-row engine verdicts already on
// employeesWithCards + the already-computed needsYou.count. ADDITIVE PAYLOAD
// ONLY (15-CONTEXT D-01 / domain "No migration"): the snapshot gains a `pulse`
// field; NO situation_snapshots write, NO DDL, NO new fetch. Degrades to an
// all-zero pulse on empty input (SC4 floor — the chips never blank).
import {
  buildPulseSummary,
  type PulseSummary,
} from '../situation/build-pulse-summary.ts';
// Plan 13-02 (D-06/D-13) — the Editor-Agent action-card step. Generation runs
// HERE, in the situation.snapshot valid-scope handler (the 60s on-view
// recompute), after buildEmployeesRollup — exactly where driveTldrCompileStep
// lives for the Reader. Degrade-safe (a throw → no cards → the row renders the
// deterministic engine line); never blocks the snapshot.
import {
  ACTION_CARDS_ENABLED,
  driveActionCardsStep,
  type ActionCardsCtx,
  type ActionCardSourceRow,
} from '../agents/action-cards.ts';
import type { ActionCard } from '../../shared/types.ts';

// Plan 07-03 Task 2 + Plan 08-01 Task 3 — widen the ctx with the SDK clients the
// builders need (mirror ResolveRefsCtx in resolve-refs.ts:76-83). org-blocked-
// backlog needs issues 'list' | 'relations'; the per-employee rollup also needs
// issues 'get' (leaf-identifier lookup) and agents 'list' (roster). `agents`
// stays optional so older fixtures without it still type-check; the builders
// narrow at runtime (`typeof ctx.agents?.list === 'function'`) and degrade.
export type SituationRoomCtx = OptInGuardDataCtx & {
  issues: Pick<PluginIssuesClient, 'list' | 'get' | 'relations'>;
  agents?: Pick<PluginAgentsClient, 'list' | 'get'>;
  // Plan 16-02 (Wave A) — the data-handler ctx carries `db` at runtime (same as
  // CompileBulletinCtx / StandingNumbersCtx). The shared SQL prefetch issues two
  // SELECTs through ctx.db.query (SELECT-only; public.issues + public.agents are
  // in coreReadTables). `query` mirrors StandingNumbersCtx at
  // standing-numbers.ts:117-121.
  db: Pick<PluginDatabaseClient, 'query'>;
  logger?: PluginLogger;
};

// Plan 16-02 (Wave A) — the camelCase Issue shape both builders consume (the raw
// SQL projects snake_case, so the prefetch maps it ONCE here). The fields are the
// same loosely-typed set IssueLike carries in the two builders.
type PrefetchIssue = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  updatedAt: string | null;
};

// Plan 16-02 (Wave A) — the camelCase Agent shape buildEmployeesRollup consumes
// (snake_case from the public.agents SELECT mapped ONCE).
type PrefetchAgent = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  lastHeartbeatAt: string | null;
  status: string | null;
  pausedAt: string | null;
};

// Plan 16-02 — the OPEN status set the single issues SELECT projects (a superset
// of 'blocked', so one read serves BOTH the org-backlog blocked list AND the
// rollup per-agent focus). Mirrors build-employees-rollup.ts OPEN_STATUSES.
const PREFETCH_OPEN_STATUSES = ['in_progress', 'in_review', 'blocked'] as const;

// Plan 16-02 (T-16-05) — STATIC module-level SQL strings; the SOLE bound
// parameter is $1 (companyId). No template interpolation, no company-prefix
// literal (T-16-04 / instance-agnostic). The operation-issue exclusion is reused
// VERBATIM from standing-numbers.ts:65-66 so the Editor-Agent's own
// clarity-pack operation/bulletin issues never surface as an agent's focus
// (OQ#2). Columns are the 16-SCHEMA-VERIFY.md locked set (assignee_user_id +
// last_heartbeat_at flagged for the 16-04 live \d back-fill).
const EXCLUDE_OPERATION_ISSUES_SQL =
  "AND (origin_kind IS NULL OR origin_kind NOT LIKE 'plugin:clarity-pack%')";

const PREFETCH_ISSUES_SQL =
  "SELECT id, identifier, title, status, assignee_agent_id, assignee_user_id, updated_at " +
  "FROM public.issues " +
  "WHERE company_id = $1 AND status IN ('in_progress','in_review','blocked') AND hidden_at IS NULL " +
  EXCLUDE_OPERATION_ISSUES_SQL;

const PREFETCH_AGENTS_SQL =
  "SELECT id, name, role, title, last_heartbeat_at, status, paused_at " +
  "FROM public.agents WHERE company_id = $1";

/** Raw snake_case row from the public.issues SELECT. */
type IssueSqlRow = {
  id: string | null;
  identifier: string | null;
  title: string | null;
  status: string | null;
  assignee_agent_id: string | null;
  assignee_user_id: string | null;
  updated_at: string | null;
};

/** Raw snake_case row from the public.agents SELECT. */
type AgentSqlRow = {
  id: string | null;
  name: string | null;
  role: string | null;
  title: string | null;
  last_heartbeat_at: string | null;
  status: string | null;
  paused_at: string | null;
};

/** The shared prefetch result the handler builds ONCE and threads into both
 *  builders. */
type SnapshotPrefetchBundle = {
  blockedIssues: PrefetchIssue[];
  roster: PrefetchAgent[];
  issuesByAgentId: Map<string, PrefetchIssue[]>;
  issuesById: Map<string, PrefetchIssue>;
  nameByUuid: Map<string, string | null>;
  edgeGraph: Map<string, SharedEdgeEntry>;
};

/** The empty backlog shape — used when the builder throws so the rest of the
 *  handler still renders. */
const EMPTY_BACKLOG: OrgBlockedBacklog = {
  rows: [],
  total: 0,
  blocked_count: 0,
  need_you_count: 0,
  overflow: false,
};

/** Plan 16-02 (Wave A) — map a snake_case public.issues row to the camelCase
 *  IssueLike shape both builders read. Every field keeps the defensive `?? null`
 *  posture (16-SCHEMA-VERIFY.md: a SELECT of an absent column throws and is
 *  floored by the per-prefetch try/catch; `?? null` covers a present-but-null
 *  value). */
function mapIssueRow(r: IssueSqlRow): PrefetchIssue {
  return {
    id: r.id ?? '',
    identifier: r.identifier ?? '',
    title: r.title ?? '',
    status: r.status ?? '',
    assigneeAgentId: r.assignee_agent_id ?? null,
    assigneeUserId: r.assignee_user_id ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

/** Plan 16-02 (Wave A) — map a snake_case public.agents row to the camelCase
 *  AgentLike shape buildEmployeesRollup reads. Defensive `?? null` per field. */
function mapAgentRow(r: AgentSqlRow): PrefetchAgent {
  return {
    id: r.id ?? '',
    name: r.name ?? '',
    role: r.role ?? null,
    title: r.title ?? null,
    lastHeartbeatAt: r.last_heartbeat_at ?? null,
    status: r.status ?? null,
    pausedAt: r.paused_at ?? null,
  };
}

/**
 * Plan 16-02 (Wave A) — the SHARED SQL prefetch + shared edge graph.
 *
 * Issues exactly TWO parameterized SELECTs (one public.issues over the OPEN
 * status set — a superset of 'blocked' so it serves both the org-backlog blocked
 * list AND the rollup per-agent focus — and one public.agents roster), builds the
 * uuid→name Map ONCE from the agents rows (eliminating every per-uuid agents.get
 * in both builders), and walks the blocker BFS ONCE per distinct blocked-issue id
 * (the union {blocked roots} ∪ {blocked agent focus} — every focus issue that
 * drives a rollup chain is itself a blocked issue already in this set, so the
 * blocked-id set IS the union). A thrown walk for one startId is stored as the
 * UNCLASSIFIED sentinel (the consumers floor that row honestly) — never aborts
 * the prefetch.
 *
 * Degrade-safe: if EITHER SELECT throws, the bundle is returned EMPTY so both
 * builders fall back to their original RPC path (the handler stays up). The
 * caller wraps this in a try and logs the prefetch stage timing.
 */
async function buildSnapshotPrefetch(
  ctx: SituationRoomCtx,
  companyId: string,
): Promise<SnapshotPrefetchBundle | null> {
  // Two SELECTs. $1 = companyId (the sole bound param); the SQL strings are
  // static module constants (T-16-05). A throw on either read → null bundle
  // (the caller degrades to the RPC path).
  let issueRows: IssueSqlRow[];
  let agentRows: AgentSqlRow[];
  try {
    issueRows = await ctx.db.query<IssueSqlRow>(PREFETCH_ISSUES_SQL, [companyId]);
  } catch (e) {
    ctx.logger?.warn?.('situation.snapshot: issues prefetch failed (RPC fallback)', {
      companyId,
      err: (e as Error).message,
    });
    return null;
  }
  try {
    agentRows = await ctx.db.query<AgentSqlRow>(PREFETCH_AGENTS_SQL, [companyId]);
  } catch (e) {
    ctx.logger?.warn?.('situation.snapshot: agents prefetch failed (RPC fallback)', {
      companyId,
      err: (e as Error).message,
    });
    return null;
  }

  const issues = (Array.isArray(issueRows) ? issueRows : []).map(mapIssueRow).filter((i) => i.id);
  const agents = (Array.isArray(agentRows) ? agentRows : []).map(mapAgentRow).filter((a) => a.id);

  const blockedIssues = issues.filter((i) => i.status === 'blocked');

  // Group OPEN issues by assignee_agent_id (the rollup per-agent focus source).
  const issuesByAgentId = new Map<string, PrefetchIssue[]>();
  const issuesById = new Map<string, PrefetchIssue>();
  for (const i of issues) {
    issuesById.set(i.id, i);
    if (i.assigneeAgentId) {
      const arr = issuesByAgentId.get(i.assigneeAgentId) ?? [];
      arr.push(i);
      issuesByAgentId.set(i.assigneeAgentId, arr);
    }
  }

  // uuid→name Map built ONCE from the single agents SELECT. Eliminates every
  // per-uuid agents.get in both builders. A missing uuid (an owner not on the
  // roster) is simply absent → the consumers read null (NO_UUID_LEAK).
  const nameByUuid = new Map<string, string | null>();
  for (const a of agents) {
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    nameByUuid.set(a.id, name || null);
  }

  // Shared edge graph: walk buildEdges ONCE per distinct blocked-issue id. This
  // id set IS the union {blocked roots} ∪ {blocked agent focus} (a focus issue
  // that drives a rollup chain is a blocked issue, already here). A thrown walk
  // → the UNCLASSIFIED sentinel for that startId (surfaced, not dropped).
  const edgeGraph = new Map<string, SharedEdgeEntry>();
  // buildEdges needs only ctx.issues.relations.get — satisfied by ctx (cast to
  // the structural OrgBlockedBacklogCtx the export expects).
  const edgeCtx = { issues: ctx.issues, logger: ctx.logger } as unknown as OrgBlockedBacklogCtx;
  for (const issue of blockedIssues) {
    const startId = issue.id;
    if (!startId || edgeGraph.has(startId)) continue; // memoize by startId
    try {
      const { edges, nodeMeta } = await buildEdges(edgeCtx, companyId, startId);
      edgeGraph.set(startId, { edges, nodeMeta });
    } catch (e) {
      // A thrown root walk → the honest UNCLASSIFIED floor for this startId. The
      // prefetch is NOT aborted; the other issues' edges still build.
      ctx.logger?.warn?.('situation.snapshot: shared edge walk failed (UNCLASSIFIED)', {
        companyId,
        startId,
        err: (e as Error).message,
      });
      edgeGraph.set(startId, { unclassified: true, degradeReason: 'relations-walk-failed' });
    }
  }

  return { blockedIssues, roster: agents, issuesByAgentId, issuesById, nameByUuid, edgeGraph };
}

export function registerSituationRoomHandlers(ctx: SituationRoomCtx): void {
  wrapDataHandler(ctx, 'situation.snapshot', async (params) => {
    const companyId =
      typeof params?.companyId === 'string' && params.companyId ? params.companyId : null;
    if (!companyId) {
      // Fail loud — the UI must thread companyId via useResolvedCompanyId
      // (same pattern as Reader). An empty companyId would silently match no
      // rows; we'd rather surface the bug.
      throw new Error('situation.snapshot: companyId required');
    }

    // Plan 07-03 Task 2 — viewer is the UI-supplied userId (index.tsx:214) so
    // need_you_count is scoped to THIS operator.
    const viewerUserId =
      typeof params?.userId === 'string' && params.userId ? params.userId : '';

    // Plan 16-02 (Wave A) — the SHARED SQL prefetch + shared edge graph,
    // computed ONCE here and threaded into BOTH builders. Collapses the N+1 RPC
    // fan-out (issues.list + agents.list + per-uuid agents.get + a duplicated
    // BFS) into 2 SQL reads + one shared BFS. Degrade-safe: a thrown/null bundle
    // → the builders fall back to their original RPC path (the handler stays up).
    // Stage-timed (snap.stage) so the N+1 reduction is measurable in worker logs.
    let prefetch: SnapshotPrefetchBundle | null = null;
    {
      const t0 = Date.now();
      try {
        prefetch = await buildSnapshotPrefetch(ctx, companyId);
      } catch (e) {
        // buildSnapshotPrefetch already swallows the SELECT throws; this is
        // belt-and-suspenders for an unexpected edge-graph throw.
        ctx.logger?.warn?.('situation.snapshot: prefetch failed (RPC fallback)', {
          companyId,
          err: (e as Error).message,
        });
        prefetch = null;
      }
      ctx.logger?.info?.('snap.stage', { stage: 'prefetch', ms: Date.now() - t0, companyId });
    }

    // The prefetch slice shared by both builders (empty object when the prefetch
    // degraded — the builders then take their RPC path).
    const sharedPrefetch = prefetch
      ? {
          blockedIssues: prefetch.blockedIssues,
          nameByUuid: prefetch.nameByUuid,
          edgeGraph: prefetch.edgeGraph,
        }
      : {};

    // Compute the org-level blocked backlog FRESH (valid scope). Degrade-safe:
    // a thrown builder leaves the rest of the handler intact.
    let org_blocked_backlog: OrgBlockedBacklog;
    {
      const t0 = Date.now();
      try {
        org_blocked_backlog = await buildOrgBlockedBacklog(
          {
            issues: ctx.issues,
            agents: ctx.agents,
            logger: ctx.logger,
            ...sharedPrefetch,
          } as unknown as OrgBlockedBacklogCtx,
          companyId,
          viewerUserId,
        );
      } catch (e) {
        ctx.logger?.warn?.('situation.snapshot: org-blocked-backlog compute failed', {
          companyId,
          err: (e as Error).message,
        });
        org_blocked_backlog = { ...EMPTY_BACKLOG };
      }
      ctx.logger?.info?.('snap.stage', { stage: 'org-backlog', ms: Date.now() - t0, companyId });
    }

    // Plan 08-01 Task 3 — compute the per-employee rollup FRESH alongside the
    // backlog (same valid scope). Degrade-safe: a thrown builder leaves
    // org_blocked_backlog + the agent grid intact.
    let employees: SituationEmployeeRow[] = [];
    let needsYou: NeedsYou = { count: 0, topAction: null };
    {
      const t0 = Date.now();
      try {
        const rollup = await buildEmployeesRollup(
          {
            issues: ctx.issues,
            agents: ctx.agents,
            logger: ctx.logger,
            ...sharedPrefetch,
            // Rollup-specific prefetch slice (roster + per-agent focus + leaf set).
            ...(prefetch
              ? {
                  roster: prefetch.roster,
                  issuesByAgentId: prefetch.issuesByAgentId,
                  issuesById: prefetch.issuesById,
                }
              : {}),
          } as unknown as EmployeesRollupCtx,
          companyId,
          viewerUserId,
        );
        employees = rollup.employees;
        needsYou = rollup.needsYou;
      } catch (e) {
        ctx.logger?.warn?.('situation.snapshot: employees rollup failed', {
          companyId,
          err: (e as Error).message,
        });
      }
      ctx.logger?.info?.('snap.stage', { stage: 'employees-rollup', ms: Date.now() - t0, companyId });
    }

    // Plan 13-02 (D-06/D-07/D-12) — generate the Editor-Agent action cards for
    // the engine-flagged needsYou rows, in THIS valid-scope handler (the 60s
    // on-view recompute). D-07: only rows the deterministic engine flagged
    // (blockerChain.needsYou === true) are passed in — the AI never decides
    // WHETHER a row needs a human. Degrade-safe: a throw leaves the snapshot
    // intact (the rows fall back to the deterministic engine line). The step
    // itself never throws; this try/catch is belt-and-suspenders.
    //
    // GOTCHA 2 (ctx widening) — SituationRoomCtx does NOT declare the
    // db / agents.managed fields driveActionCardsStep needs (it carries only the
    // builder slice). The data-handler ctx at runtime DOES carry db + the full
    // agents/issues clients (same as bulletin.byCycle's CompileBulletinCtx cast),
    // so we widen via `ctx as unknown as ActionCardsCtx`.
    let cardsBySource: Record<string, ActionCard> = {};
    try {
      const needsYouRows: ActionCardSourceRow[] = employees
        .filter((e) => e.blockerChain && e.blockerChain.needsYou === true)
        .map((e) => ({
          // D-03 — the leaf UUID is the cache key / dispatch id (never rendered).
          sourceIssueId: e.blockerChain!.targetIssueUuid ?? e.blockerChain!.leafIssueUuid ?? '',
          leafIssueId: e.blockerChain!.leafIssueId,
          awaitedPartyLabel: e.blockerChain!.awaitedPartyLabel,
          humanAction: e.blockerChain!.humanAction,
          actionAffordance: e.blockerChain!.actionAffordance,
          // The focus line is the closest grounding signal available in the
          // snapshot scope (no extra host fetch); the deterministic party +
          // leaf id ground the rest.
          inputs: {
            body: e.focusLine ?? '',
            comments: [],
            refs: e.blockerChain!.leafIssueId ? [e.blockerChain!.leafIssueId] : [],
          },
        }))
        // Drop rows with no usable leaf key (can't cache/dispatch them).
        .filter((r) => r.sourceIssueId.length > 0);

      // v1.4.1 HOTFIX (BEAAA-2092) — gated OFF: do not compile on the snapshot
      // request path (it blocked the RPC → 502 and churned the op issue →
      // notification storm). cardsBySource stays {} → every row degrades to the
      // deterministic engine line (D-12).
      if (ACTION_CARDS_ENABLED && needsYouRows.length > 0) {
        const step = await driveActionCardsStep(ctx as unknown as ActionCardsCtx, {
          companyId,
          needsYouRows,
        });
        cardsBySource = step.cards;
      }
    } catch (e) {
      // Degrade-safe (D-12) — a thrown step leaves cardsBySource empty so every
      // row renders the deterministic engine line. Never blocks the snapshot.
      ctx.logger?.warn?.('situation.snapshot: action-card generation failed', {
        companyId,
        err: (e as Error).message,
      });
      cardsBySource = {};
    }

    // Attach the per-row actionCard (D-13). A fresh card → the ActionCard;
    // stale/absent/degrade → null so the UI falls back to the deterministic
    // line. The leaf UUID is the join key (dispatch-only — never rendered).
    const employeesWithCards = employees.map((e) => {
      const leafUuid = e.blockerChain?.targetIssueUuid ?? e.blockerChain?.leafIssueUuid ?? null;
      const actionCard: ActionCard | null = leafUuid ? (cardsBySource[leafUuid] ?? null) : null;
      return { ...e, actionCard };
    });

    // Plan 15-01 Task 2 (COCK-01 / SC1 / SC3) — the worker-computed Pulse vital
    // signs. Pure sum over the per-row engine verdicts ALREADY on
    // employeesWithCards (blockerChain.tier / .terminalKind / group) + the
    // already-resolved needsYou.count (D-01). No new host fetch, no await — the
    // aggregation is synchronous and pure. ADDITIVE PAYLOAD ONLY: this is NOT a
    // schema change — no situation_snapshots write, no migration (the
    // situation_snapshots table stays unwritten per WARNING 5 / R9). The
    // function returns the all-zero floor on empty input, so a degraded (empty
    // rollup) snapshot still carries a real pulse:{needYou:0,inMotion:0,stuck:0,
    // selfClearing:0} — the Pulse chips never blank (SC4).
    const pulse: PulseSummary = buildPulseSummary(employeesWithCards, needsYou);

    // Plan 09-01 (WARNING 5) — the materialized situation_snapshots read-path
    // is REMOVED. The recompute-situation cron writer was deleted in this plan,
    // so a row is never written post-Phase-9 — the SELECT + `if (row)` branch +
    // the `...payload` spread were PERMANENTLY DEAD. The handler now ALWAYS
    // returns the FRESHLY computed rollup (the no-row path became the only
    // path). The situation_snapshots TABLE is NOT dropped and no migration is
    // added — R9 additive-only leaves the empty table in place.
    return {
      org_blocked_backlog,
      situation_employees: employeesWithCards,
      needsYou,
      // Plan 15-01 (D-01) — additive worker-computed vital-sign summary; four
      // integers, NO_UUID_LEAK by construction, no migration.
      pulse,
      taken_at: new Date().toISOString(),
    };
  });
}
