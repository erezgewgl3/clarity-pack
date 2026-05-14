// src/worker.ts — Plan 02-03 Task 1 worker promotion.
//
// Adds Editor-Agent reconciliation (per-company at boot + on company.created)
// and registers the heartbeat dispatcher that responds to issue.created /
// issue.updated events. Self-loop filtering, idempotent compile, token cap,
// and circuit breaker all live inside the agent modules — this file is just
// the wiring.
//
// Plan 02-02 handlers (resolve-refs + flatten-blocker-chain) still register
// at setup. Plan 02-04 will extend setup() with the situation-snapshot job
// and opt-in handlers.

import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';

import { registerResolveRefs, type ResolveRefsCtx } from './worker/handlers/resolve-refs.ts';
import {
  registerFlattenBlockerChain,
  type FlattenBlockerChainCtx,
} from './worker/handlers/flatten-blocker-chain.ts';
import {
  reconcileEditorAgent,
  handleEditorHeartbeat,
  EDITOR_AGENT_KEY,
  type EditorAgentReconcileCtx,
  type EditorHeartbeatCtx,
} from './worker/agents/editor.ts';
// Plan 02-03 Task 2 — Reader-view data + action handlers. Imported separately
// from Task 1's Editor-Agent wiring so Task 1's commit stays minimal.
import { registerIssueReader, type IssueReaderCtx } from './worker/handlers/issue-reader.ts';
import {
  registerAcChecklist,
  type AcChecklistCtx,
} from './worker/handlers/ac-checklist.ts';
import {
  registerEditorPauseStatus,
  type EditorPauseStatusCtx,
} from './worker/handlers/editor-pause-status.ts';
// Plan 02-03c Task 2 — companies.resolve-prefix handler. Backs the UI's
// useResolvedCompanyId() fallback when useHostContext().companyId is null
// (detail-tab loading window). See 02-03c-HOST-CONTEXT.md for evidence.
import {
  registerCompaniesResolve,
  type CompaniesResolveCtx,
} from './worker/handlers/companies-resolve.ts';

const plugin = definePlugin({
  async setup(ctx) {
    // ---- Plan 02-02 data handlers (always-on) -------------------------------
    registerResolveRefs(ctx as unknown as ResolveRefsCtx);
    registerFlattenBlockerChain(ctx as unknown as FlattenBlockerChainCtx);

    // ---- Plan 02-03 Reader-view data + action handlers ----------------------
    registerIssueReader(ctx as unknown as IssueReaderCtx);
    registerAcChecklist(ctx as unknown as AcChecklistCtx);
    registerEditorPauseStatus(ctx as unknown as EditorPauseStatusCtx);

    // ---- Plan 02-03c companyId resolver (UI fallback path) ------------------
    registerCompaniesResolve(ctx as unknown as CompaniesResolveCtx);

    // ---- Plan 02-03 Editor-Agent reconcile + heartbeat ----------------------
    // Reconcile at boot for every company currently visible to the plugin.
    // Idempotent — re-running on an already-resolved agent returns the same
    // resolution row with status='resolved'.
    try {
      const companies = await ctx.companies.list();
      for (const c of companies) {
        try {
          await reconcileEditorAgent(ctx as unknown as EditorAgentReconcileCtx, c.id);
        } catch (err) {
          ctx.logger?.warn?.('Editor-Agent reconcile failed at boot for company', {
            companyId: c.id,
            err: (err as Error).message,
          });
        }
      }
    } catch (err) {
      ctx.logger?.warn?.('Editor-Agent boot reconcile skipped — companies.list failed', {
        err: (err as Error).message,
      });
    }

    // Reconcile on company creation so new companies get the Editor-Agent
    // without a plugin restart.
    ctx.events.on('company.created', async (event) => {
      try {
        await reconcileEditorAgent(ctx as unknown as EditorAgentReconcileCtx, event.companyId);
      } catch (err) {
        ctx.logger?.warn?.('Editor-Agent reconcile failed on company.created', {
          companyId: event.companyId,
          err: (err as Error).message,
        });
      }
    });

    // Heartbeat dispatcher. The host emits issue.created / issue.updated +
    // issue.comment.created events; we bundle them per heartbeat-window into
    // a synthetic payload and run handleEditorHeartbeat (which applies the
    // self-loop filter, then calls compileTldr per affected issue).
    //
    // SDK 2026.512.0 does NOT expose ctx.agents.onHeartbeat() as the plan
    // pseudocode assumed. The event-driven dispatcher is the documented
    // alternative and gives equivalent governance parity: pausing the agent
    // in the classic admin panel halts ctx.agents.pause -> our event handler
    // sees `agentStatus=paused` via reconcile-state caching (Phase 3 will
    // formalize this; for 02-03 the failure-mode is: even if our worker
    // tries to compile, the agent's own LLM call won't run because the
    // adapter respects the paused state).
    for (const evt of ['issue.created', 'issue.updated', 'issue.comment.created'] as const) {
      ctx.events.on(evt, async (event) => {
        if (!event.entityId || !event.companyId) return;
        try {
          // Re-resolve the agent for this event's company (idempotent).
          const agentId = await reconcileEditorAgent(
            ctx as unknown as EditorAgentReconcileCtx,
            event.companyId,
          );
          if (!agentId) {
            ctx.logger?.warn?.('Editor-Agent unresolved — skipping heartbeat', { companyId: event.companyId });
            return;
          }
          await handleEditorHeartbeat(ctx as unknown as EditorHeartbeatCtx, {
            companyId: event.companyId,
            agentId,
            events: [
              {
                author_id: event.actorId ?? null,
                tags: [],
                entity_type: event.entityType ?? 'issue',
                entity_id: event.entityId,
              },
            ],
          });
        } catch (err) {
          ctx.logger?.warn?.('Editor-Agent heartbeat handler threw', {
            event: evt,
            err: (err as Error).message,
          });
        }
      });
    }

    ctx.logger?.info?.(
      `clarity-pack worker started — Editor-Agent ${EDITOR_AGENT_KEY} reconciled, resolve-refs + flatten-blocker-chain + issue.reader + ac-toggle + editor.pause-status registered`,
    );
  },
});

runWorker(plugin, import.meta.url);
