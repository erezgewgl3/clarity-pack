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

      if (needsYouRows.length > 0) {
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
