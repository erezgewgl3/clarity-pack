// src/worker/jobs/situation-snapshot.ts
//
// Plan 02-04 Task 2 — recompute-situation 60s job. Materializes one
// situation_snapshots row per company per minute when ≥1 active viewer
// is present (ROOM-05). Otherwise no-op.
//
// Ctx composed from real SDK clients — NO narrow lying-about-the-SDK
// local Ctx (02-04 blocking anti-pattern).
//
// Critical-path NARRATION may later be compiled by the Editor-Agent
// (Plan 02-03 compileTldr) but the CHAIN SELECTION is deterministic via
// flattenBlockerChain (PRIM-03). v1 of this job ships the deterministic
// chain only; the Editor-Agent prose pass is a Phase 3 polish item.

import type {
  PluginAgentsClient,
  PluginCompaniesClient,
  PluginDatabaseClient,
  PluginIssuesClient,
  PluginJobsClient,
  PluginLogger,
  Company,
  Agent,
} from '@paperclipai/plugin-sdk';

import {
  flattenBlockerChain,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
import type { BlockerChainResult } from '../../shared/types.ts';
import { humanizeChain, buildIdLookup, type IdLookup } from './humanize-snapshot.ts';
// Phase 6.1 ROOM-09 -- consult the plugin-namespace clarity_agent_owners
// side table (migration 0013) BEFORE the blocker-chain walk. Side-table-
// wins resolution per D-01: operator-claimed owners override host
// public.agents.owner_user_id. The fix is at the chain leaf, NOT in the
// chain walk (src/shared/blocker-chain.ts ships byte-identical).
import { listClarityAgentOwnersForCompany } from '../db/clarity-agent-owners-repo.ts';

const MAX_CHAIN_DEPTH = 6;
const CRITICAL_PATH_MAX = 3;
const ACTIVE_VIEWER_WINDOW_SECS = 90;

export type SituationSnapshotCtx = {
  logger?: PluginLogger;
  db: PluginDatabaseClient;
  jobs: PluginJobsClient;
  companies: PluginCompaniesClient;
  agents: PluginAgentsClient;
  issues: PluginIssuesClient;
};

export type EmployeeSnapshot = {
  userId: string;
  role: string;
  state: string;
  age_ms: number;
  now_doing: string | null;
  blocker_chain: BlockerChainResult;
  latest_artifact: unknown | null;
  velocity_7d: number[];
};

export type SituationPayload = {
  employees: EmployeeSnapshot[];
  critical_path: BlockerChainResult[];
  artifacts_shipped_today: unknown[];
  awaiting_you_count: number;
  awaiting_you_oldest_age: number | null;
};

/**
 * Sync hash of a JSON-stringified payload. Reuses the murmur3_32 helper
 * pattern but inlined here so the worker doesn't need to import the UI
 * primitive (DOM-shaped imports stay in the UI bundle).
 */
function syncHash(input: string): string {
  let h1 = 0 | 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const bytes = input.length - (input.length & 3);
  let i = 0;
  while (i < bytes) {
    let k1 =
      (input.charCodeAt(i) & 0xff) |
      ((input.charCodeAt(i + 1) & 0xff) << 8) |
      ((input.charCodeAt(i + 2) & 0xff) << 16) |
      ((input.charCodeAt(i + 3) & 0xff) << 24);
    i += 4;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }
  h1 ^= input.length;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

async function buildEmployeeRow(
  ctx: SituationSnapshotCtx,
  emp: Agent,
  companyId: string,
  viewerUserId: string,
  lookup: IdLookup,
  // Phase 6.1 ROOM-09 -- side-table-wins owner resolution. ownerMap is
  // pre-built per-company by registerSituationSnapshotJob from
  // (host employees ∪ clarity_agent_owners) with side-table entries
  // OVERRIDING host fallback (D-01). The reconciliation pass below
  // backfills any null nodeMeta[id].ownerUserId from ownerMap BEFORE
  // flattenBlockerChain runs, so the chain leaf inherits a resolved
  // ownerUserId and the walk emits HUMAN_ACTION_ON(<real_user_id>)
  // instead of HUMAN_ACTION_ON(__unowned__). src/shared/blocker-chain.ts
  // ships byte-identical.
  ownerMap: Map<string, string>,
): Promise<EmployeeSnapshot> {
  const anyEmp = emp as unknown as {
    id?: string;
    user_id?: string;
    role?: string;
    state?: string;
    last_state_change_at?: string;
    current_focus_issue_id?: string;
    current_task_summary?: string;
    latest_work_product?: unknown;
    velocity_7d_array?: number[];
  };
  const userId = anyEmp.user_id ?? anyEmp.id ?? '';
  const state = anyEmp.state ?? 'Standby';
  const lastChange = anyEmp.last_state_change_at
    ? new Date(anyEmp.last_state_change_at).getTime()
    : Date.now();
  const startId = anyEmp.current_focus_issue_id ?? '';

  // Walk blockers via ctx.issues.relations.get — same pattern as
  // flatten-blocker-chain handler (Plan 02-03b §7). Bound at MAX_CHAIN_DEPTH.
  const edges: BlockerEdge[] = [];
  const nodeMeta: Record<string, { ownerUserId: string | null; etaIso: string | null; status: string }> = {};
  if (startId) {
    try {
      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (visited.has(id) || depth > MAX_CHAIN_DEPTH) continue;
        visited.add(id);
        let summary;
        try {
          summary = await ctx.issues.relations.get(id, companyId);
        } catch {
          continue;
        }
        const blockedBy = summary?.blockedBy ?? [];
        for (const blocker of blockedBy) {
          const b = blocker as unknown as {
            id?: string;
            issueId?: string;
            key?: string;
            assigneeUserId?: string | null;
            ownerUserId?: string | null;
            etaIso?: string | null;
            status?: string;
          };
          const toId = b.id ?? b.issueId ?? b.key ?? '';
          if (!toId) continue;
          edges.push({ from: id, to: toId, reason: 'blocks' });
          nodeMeta[toId] = {
            ownerUserId: b.assigneeUserId ?? b.ownerUserId ?? null,
            etaIso: b.etaIso ?? null,
            status: b.status ?? 'awaiting',
          };
          if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) {
            queue.push({ id: toId, depth: depth + 1 });
          }
        }
      }
    } catch (e) {
      ctx.logger?.warn?.('situation-snapshot: relations walk failed', { userId, err: (e as Error).message });
    }
  }

  // Phase 6.1 HOTFIX (Plan 06.1-05) -- the reconciliation loop below
  // iterates `nodeMeta`, which the relations walk above populates ONLY
  // with blocker issue ids (line 172). For an agent with no blockers
  // (idle: no current_focus_issue_id, or an active agent currently
  // unblocked), `nodeMeta` is empty after the walk and the
  // reconciliation runs over zero entries. flattenBlockerChain then
  // walks from `(startId || userId)`, finds no edges, terminates at the
  // start node, looks up `nodeMeta[startNode]` -> undefined, and emits
  // __unowned__ via the blocker-chain.ts:178 fallback even when
  // clarity_agent_owners has a row for the agent. Seed the chain's
  // start node here from ownerMap (keyed by agent.id, see
  // registerSituationSnapshotJob line 323) so the side-table override
  // applies to the degenerate idle chain. Without this seed, the
  // operator's drill on rc.8 Phase 6.1 STILL shows "no owner assigned"
  // on idle agent cards (Plan 06.1-04 closure drill 2026-05-27).
  const chainStartId = startId || userId;
  const agentIdForOwnerLookup = anyEmp.id ?? userId;
  if (chainStartId && !nodeMeta[chainStartId]) {
    const claimedOwner = ownerMap.get(agentIdForOwnerLookup);
    nodeMeta[chainStartId] = {
      ownerUserId: claimedOwner ?? null,
      etaIso: null,
      status: 'awaiting',
    };
  }

  // Phase 6.1 ROOM-09 -- side-table-wins reconciliation. Backfill any
  // null nodeMeta[id].ownerUserId from ownerMap BEFORE flattenBlockerChain
  // runs. The walk reads meta.ownerUserId at HUMAN_ACTION_ON leaves and
  // emits the __unowned__ sentinel when null (src/shared/blocker-chain.ts
  // :178 -- LOCKED INVARIANT, not modified). Pre-populating from
  // clarity_agent_owners (side-table wins) means the walk sees the
  // resolved owner and never emits __unowned__ for claimed agents.
  // humanize-snapshot.ts's __unowned__ rewrite pass then becomes a no-op
  // for those rows -- no change to that file needed either.
  for (const [nodeId, meta] of Object.entries(nodeMeta)) {
    if (meta.ownerUserId == null) {
      const resolved = ownerMap.get(nodeId);
      if (resolved) {
        meta.ownerUserId = resolved;
      }
    }
  }

  // PRIM-03: deterministic chain. flattenBlockerChain returns one of the
  // four canonical Terminal kinds — never an LLM-derived label.
  const rawChain = flattenBlockerChain({
    startId: startId || userId,
    edges,
    nodeMeta,
    viewerUserId,
  });

  // Plan 02-08 Task 2 (DEV-11) — humanize before reaching the UI.
  // Every blocker_chain.terminal.label is asserted UUID-free by
  // test/worker/situation-snapshot-narration.test.mjs.
  const blockerChain = humanizeChain(rawChain, lookup);

  return {
    userId,
    role: anyEmp.role ?? 'agent',
    state,
    age_ms: Math.max(0, Date.now() - lastChange),
    now_doing: anyEmp.current_task_summary ?? null,
    blocker_chain: blockerChain,
    latest_artifact: anyEmp.latest_work_product ?? null,
    velocity_7d: Array.isArray(anyEmp.velocity_7d_array) ? anyEmp.velocity_7d_array : [],
  };
}

function pickTopChains(chains: BlockerChainResult[], max: number): BlockerChainResult[] {
  // Priority: HUMAN_ACTION_ON > SELF_RESOLVING > EXTERNAL > CYCLE.
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

export function registerSituationSnapshotJob(ctx: SituationSnapshotCtx): void {
  ctx.jobs.register('recompute-situation', async () => {
    // ROOM-05 gate: skip when no recent active viewers.
    let activeViewerCount = 0;
    try {
      const rows = await ctx.db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM plugin_clarity_pack_cdd6bda4bd.active_viewers WHERE surface = 'situation-room' AND last_seen_at > now() - interval '${ACTIVE_VIEWER_WINDOW_SECS} seconds'`,
      );
      activeViewerCount = rows[0]?.n ?? 0;
    } catch (e) {
      ctx.logger?.warn?.('situation-snapshot: active_viewers count failed', { err: (e as Error).message });
      return;
    }
    if (activeViewerCount === 0) {
      return;
    }

    let companies: Company[] = [];
    try {
      companies = await ctx.companies.list();
    } catch (e) {
      ctx.logger?.warn?.('situation-snapshot: companies.list failed', { err: (e as Error).message });
      return;
    }

    for (const company of companies) {
      const anyCompany = company as unknown as { id: string; owner_user_id?: string };
      const companyId = anyCompany.id;
      const viewerUserId = anyCompany.owner_user_id ?? '';
      let employees: Agent[] = [];
      try {
        employees = await ctx.agents.list({ companyId });
      } catch (e) {
        ctx.logger?.warn?.('situation-snapshot: agents.list failed', { companyId, err: (e as Error).message });
        continue;
      }

      // Plan 02-08 Task 2 — build the per-company IdLookup BEFORE we walk the
      // employees. Agents-only (DEV-11-AGENT-ONLY): SDK 2026.512.0 has no
      // PluginUsersClient, so we don't try to resolve human-user UUIDs. The
      // captured drill payload contained only agent UUIDs anyway.
      const lookup: IdLookup = buildIdLookup({
        agents: employees as unknown as Array<{ user_id?: string; id?: string; role?: string }>,
        users: [],
      });

      // Phase 6.1 ROOM-09 -- fetch plugin-namespace owner claims for this
      // company. Graceful degrade on error: empty array means host-only
      // resolution applies (same behavior as before this phase shipped).
      let sideTableOwners: Array<{ agent_id: string; owner_user_id: string }> = [];
      try {
        sideTableOwners = await listClarityAgentOwnersForCompany(ctx, companyId);
      } catch (e) {
        ctx.logger?.warn?.(
          'situation-snapshot: clarity_agent_owners SELECT failed',
          { companyId, err: (e as Error).message },
        );
      }

      // Phase 6.1 ROOM-09 -- build the per-company ownerMap with side-table-
      // wins semantics. Seed from the host employees array (each Agent
      // structurally carries owner_user_id; fall back to null when absent),
      // then OVERWRITE with side-table entries so an operator-claimed
      // owner_user_id beats the host's pre-claim value. The map is keyed by
      // either e.id or e.user_id (whichever the snake_case Agent cast
      // exposes -- matches buildEmployeeRow's userId resolution at L117).
      const ownerMap = new Map<string, string>();
      for (const emp of employees) {
        const anyEmp = emp as unknown as {
          id?: string;
          user_id?: string;
          owner_user_id?: string | null;
        };
        const key = anyEmp.id ?? anyEmp.user_id ?? '';
        if (key && typeof anyEmp.owner_user_id === 'string' && anyEmp.owner_user_id) {
          ownerMap.set(key, anyEmp.owner_user_id);
        }
      }
      for (const row of sideTableOwners) {
        ownerMap.set(row.agent_id, row.owner_user_id);
      }

      const employeeRows: EmployeeSnapshot[] = [];
      for (const emp of employees) {
        try {
          employeeRows.push(
            await buildEmployeeRow(ctx, emp, companyId, viewerUserId, lookup, ownerMap),
          );
        } catch (e) {
          ctx.logger?.warn?.('situation-snapshot: employee row build failed', {
            err: (e as Error).message,
          });
        }
      }

      // Plan 02-08 Task 2 — critical_path chains are picked from already-
      // humanized employee chains, so they inherit UUID-free labels. No
      // second humanizeChain pass needed; the integration test asserts both
      // surfaces are UUID-free anyway.
      const criticalPath = pickTopChains(
        employeeRows.map((e) => e.blocker_chain),
        CRITICAL_PATH_MAX,
      );

      // Plan 02-08 Task 3 (DEV-13) — Awaiting You count must filter on
      // userId === viewerUserId. The previous implementation counted every
      // HUMAN_ACTION_ON terminal including '__unowned__' which inflated the
      // pill count in the drill. Now: only count terminals whose userId
      // matches the company owner's userId (the current viewer).
      const awaitingYouCount = employeeRows.filter((e) => {
        const t = e.blocker_chain.terminal;
        return t.kind === 'HUMAN_ACTION_ON' && t.userId === viewerUserId;
      }).length;

      const payload: SituationPayload = {
        employees: employeeRows,
        critical_path: criticalPath,
        artifacts_shipped_today: [], // Phase 5 DIST-04 fills this.
        awaiting_you_count: awaitingYouCount,
        awaiting_you_oldest_age: null,
      };

      const payloadJson = JSON.stringify(payload);
      const contentHash = syncHash(payloadJson);
      try {
        await ctx.db.execute(
          'INSERT INTO plugin_clarity_pack_cdd6bda4bd.situation_snapshots (computed_for_company_id, payload, content_hash) VALUES ($1, $2::jsonb, $3) ON CONFLICT (computed_for_company_id, content_hash) DO NOTHING',
          [companyId, payloadJson, contentHash],
        );
      } catch (e) {
        ctx.logger?.warn?.('situation-snapshot: INSERT failed', { companyId, err: (e as Error).message });
      }
    }
  });
}
