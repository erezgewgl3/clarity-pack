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

  // PRIM-03: deterministic chain. flattenBlockerChain returns one of the
  // four canonical Terminal kinds — never an LLM-derived label.
  const blockerChain = flattenBlockerChain({
    startId: startId || userId,
    edges,
    nodeMeta,
    viewerUserId,
  });

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

      const employeeRows: EmployeeSnapshot[] = [];
      for (const emp of employees) {
        try {
          employeeRows.push(await buildEmployeeRow(ctx, emp, companyId, viewerUserId));
        } catch (e) {
          ctx.logger?.warn?.('situation-snapshot: employee row build failed', {
            err: (e as Error).message,
          });
        }
      }

      const criticalPath = pickTopChains(
        employeeRows.map((e) => e.blocker_chain),
        CRITICAL_PATH_MAX,
      );

      const awaitingYouCount = employeeRows.filter(
        (e) => e.blocker_chain.terminal.kind === 'HUMAN_ACTION_ON',
      ).length;

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
