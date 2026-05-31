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
  PluginIssuesClient,
  PluginLogger,
} from '@paperclipai/plugin-sdk';

import { wrapDataHandler, type OptInGuardDataCtx } from '../opt-in-guard.ts';
import {
  buildOrgBlockedBacklog,
  type OrgBlockedBacklog,
  type OrgBlockedBacklogCtx,
} from './org-blocked-backlog.ts';
// Plan 08-01 Task 3 — the per-employee rollup (ROOM-13/15/16/17) computed
// alongside org_blocked_backlog in this same valid HTTP-request scope.
import {
  buildEmployeesRollup,
  type SituationEmployeeRow,
  type NeedsYou,
  type EmployeesRollupCtx,
} from '../situation/build-employees-rollup.ts';

// Plan 07-03 Task 2 + Plan 08-01 Task 3 — widen the ctx with the SDK clients the
// builders need (mirror ResolveRefsCtx in resolve-refs.ts:76-83). org-blocked-
// backlog needs issues 'list' | 'relations'; the per-employee rollup also needs
// issues 'get' (leaf-identifier lookup) and agents 'list' (roster). `agents`
// stays optional so older fixtures without it still type-check; the builders
// narrow at runtime (`typeof ctx.agents?.list === 'function'`) and degrade.
export type SituationRoomCtx = OptInGuardDataCtx & {
  issues: Pick<PluginIssuesClient, 'list' | 'get' | 'relations'>;
  agents?: Pick<PluginAgentsClient, 'list' | 'get'>;
  logger?: PluginLogger;
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

    // Compute the org-level blocked backlog FRESH (valid scope). Degrade-safe:
    // a thrown builder leaves the rest of the handler intact.
    let org_blocked_backlog: OrgBlockedBacklog;
    try {
      org_blocked_backlog = await buildOrgBlockedBacklog(
        { issues: ctx.issues, agents: ctx.agents, logger: ctx.logger } as unknown as OrgBlockedBacklogCtx,
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

    // Plan 08-01 Task 3 — compute the per-employee rollup FRESH alongside the
    // backlog (same valid scope). Degrade-safe: a thrown builder leaves
    // org_blocked_backlog + the agent grid intact.
    let employees: SituationEmployeeRow[] = [];
    let needsYou: NeedsYou = { count: 0, topAction: null };
    try {
      const rollup = await buildEmployeesRollup(
        { issues: ctx.issues, agents: ctx.agents, logger: ctx.logger } as unknown as EmployeesRollupCtx,
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

    // Plan 09-01 (WARNING 5) — the materialized situation_snapshots read-path
    // is REMOVED. The recompute-situation cron writer was deleted in this plan,
    // so a row is never written post-Phase-9 — the SELECT + `if (row)` branch +
    // the `...payload` spread were PERMANENTLY DEAD. The handler now ALWAYS
    // returns the FRESHLY computed rollup (the no-row path became the only
    // path). The situation_snapshots TABLE is NOT dropped and no migration is
    // added — R9 additive-only leaves the empty table in place.
    return {
      org_blocked_backlog,
      situation_employees: employees,
      needsYou,
      taken_at: new Date().toISOString(),
    };
  });
}
