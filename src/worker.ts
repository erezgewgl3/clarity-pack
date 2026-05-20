// src/worker.ts — Plan 02-04 worker wiring.
//
// Plan 02-03 brought Editor-Agent + Reader handlers. Plan 02-04 adds:
//   - get-opt-in + set-opt-in (boot-time exempt handlers)
//   - get-instance-config (boot-time exempt handler, per 02-01 Check F)
//   - opt-in-guard wrap around every 02-02/02-03 non-exempt handler
// Plan 02-04 Task 2 adds:
//   - situation.snapshot + situation.active-viewer-ping (wrapped)
//   - recompute-situation 60s job

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
import { registerIssueReader, type IssueReaderCtx } from './worker/handlers/issue-reader.ts';
import {
  registerAcChecklist,
  type AcChecklistCtx,
} from './worker/handlers/ac-checklist.ts';
import {
  registerEditorPauseStatus,
  type EditorPauseStatusCtx,
} from './worker/handlers/editor-pause-status.ts';
import {
  registerCompaniesResolve,
  type CompaniesResolveCtx,
} from './worker/handlers/companies-resolve.ts';
// Plan 02-04 Task 1 — opt-in handlers.
import { registerGetOptIn, type GetOptInCtx } from './worker/handlers/get-opt-in.ts';
import { registerSetOptIn, type SetOptInCtx } from './worker/handlers/set-opt-in.ts';
import {
  registerGetInstanceConfig,
  type GetInstanceConfigCtx,
} from './worker/handlers/get-instance-config.ts';
// Plan 02-04 Task 2 — Situation Room handlers + 60s job.
import {
  registerSituationRoomHandlers,
  type SituationRoomCtx,
} from './worker/handlers/situation-room.ts';
import {
  registerActiveViewerPing,
  type ActiveViewerPingCtx,
} from './worker/handlers/active-viewer-ping.ts';
import {
  registerSituationSnapshotJob,
  type SituationSnapshotCtx,
} from './worker/jobs/situation-snapshot.ts';
// Plan 03-01 — Daily Bulletin compile job (Wave 1 skeleton).
import {
  registerCompileBulletinJob,
  type CompileBulletinCtx,
} from './worker/jobs/compile-bulletin.ts';
// Plan 03-03 — Bulletin UI data + action handlers.
import {
  registerBulletinByCycle,
  type BulletinByCycleCtx,
} from './worker/handlers/bulletin-by-cycle.ts';
import {
  registerBulletinActionApprove,
  type BulletinActionApproveCtx,
} from './worker/handlers/bulletin-action-approve.ts';
import {
  registerBulletinActionDecline,
  type BulletinActionDeclineCtx,
} from './worker/handlers/bulletin-action-decline.ts';
import {
  registerBulletinErrata,
  type BulletinErrataCtx,
} from './worker/handlers/bulletin-errata.ts';
import {
  registerBulletinLatestStatus,
  type BulletinLatestStatusCtx,
} from './worker/handlers/bulletin-latest-status.ts';
// Plan 04-03 — Employee Chat send / edit action handlers + realtime bridge.
import { registerChatSend, type ChatSendCtx } from './worker/handlers/chat-send.ts';
import { registerChatEdit, type ChatEditCtx } from './worker/handlers/chat-edit.ts';
import {
  registerChatStreamBridge,
  type ChatStreamBridgeCtx,
} from './worker/streams/chat-stream-bridge.ts';
// Plan 04-04 — Employee Chat read + CRUD handlers (UI surface consumes these).
import { registerChatRoster, type ChatRosterCtx } from './worker/handlers/chat-roster.ts';
import { registerChatTopics, type ChatTopicsCtx } from './worker/handlers/chat-topics.ts';
import {
  registerChatMessages,
  type ChatMessagesCtx,
} from './worker/handlers/chat-messages.ts';
import { registerChatSearch, type ChatSearchCtx } from './worker/handlers/chat-search.ts';
import {
  registerChatPromote,
  type ChatPromoteCtx,
} from './worker/handlers/chat-promote.ts';
import { registerChatPin, type ChatPinCtx } from './worker/handlers/chat-pin.ts';
// Plan 04.1-02 — operator composer "true task" handler (delegates to the
// shared createTrueTask helper that chat.promote also uses).
import {
  registerChatTrueTask,
  type ChatTrueTaskCtx,
} from './worker/handlers/chat-true-task.ts';
// Plan 04.1-05 — D-10 plugin-side topic archive + D-08 active-tasks-per-topic
// (the host issue stays in_progress for archive; active-tasks reads the
// chat_topic_tasks side table populated by createTrueTask's retrofit write).
import {
  registerChatTopicArchive,
  type ChatTopicArchiveCtx,
} from './worker/handlers/chat-topic-archive.ts';
import {
  registerChatActiveTasks,
  type ChatActiveTasksCtx,
} from './worker/handlers/chat-active-tasks.ts';

const plugin = definePlugin({
  async setup(ctx) {
    // ---- Plan 02-04 Task 1 — exempt-key handlers FIRST -----------------------
    // These must register BEFORE any wrapped handler so the prefs table is
    // wire-ready (and the exempt set is honoured at register time, not just
    // dispatch time).
    registerGetOptIn(ctx as unknown as GetOptInCtx);
    registerSetOptIn(ctx as unknown as SetOptInCtx);
    registerGetInstanceConfig(ctx as unknown as GetInstanceConfigCtx);

    // ---- Plan 02-02 data handlers (now wrapped with opt-in-guard) -----------
    registerResolveRefs(ctx as unknown as ResolveRefsCtx);
    registerFlattenBlockerChain(ctx as unknown as FlattenBlockerChainCtx);

    // ---- Plan 02-03 Reader-view data + action handlers (now wrapped) --------
    registerIssueReader(ctx as unknown as IssueReaderCtx);
    registerAcChecklist(ctx as unknown as AcChecklistCtx);
    registerEditorPauseStatus(ctx as unknown as EditorPauseStatusCtx);

    // ---- Plan 02-03c companyId resolver (UI fallback path) ------------------
    // NOTE: companies.resolve-prefix is NOT wrapped — it's also a boot-time
    // resolver used by the UI to compute companyId BEFORE the user is even
    // identified. Task 2 will decide if it should be added to the EXEMPT set.
    registerCompaniesResolve(ctx as unknown as CompaniesResolveCtx);

    // ---- Plan 02-04 Task 2 — Situation Room handlers + job ------------------
    registerSituationRoomHandlers(ctx as unknown as SituationRoomCtx);
    registerActiveViewerPing(ctx as unknown as ActiveViewerPingCtx);
    registerSituationSnapshotJob(ctx as unknown as SituationSnapshotCtx);

    // ---- Plan 03-01/03-02/03-05 — Daily Bulletin compile job ----------------
    // The compile-bulletin job runs the two-pass compile pipeline; Plan 03-05
    // wired a real session-backed LlmAdapter into it. Every member of
    // CompileBulletinCtx is now a genuine PluginContext field (the synthetic
    // `llm` member is gone) — so the `as unknown as` cast that previously
    // manufactured the missing `llm` is no longer needed. A plain
    // structural-narrowing cast is all that remains.
    registerCompileBulletinJob(ctx as CompileBulletinCtx);

    // ---- Plan 03-03 — Bulletin UI + Action Inbox handlers -------------------
    // bulletin.byCycle is the page's data handler; bulletin.action.approve /
    // bulletin.action.decline are the Action Inbox card bridge actions. All
    // three are opt-in-guard wrapped.
    registerBulletinByCycle(ctx as unknown as BulletinByCycleCtx);
    registerBulletinActionApprove(ctx as unknown as BulletinActionApproveCtx);
    registerBulletinActionDecline(ctx as unknown as BulletinActionDeclineCtx);
    registerBulletinErrata(ctx as unknown as BulletinErrataCtx);
    registerBulletinLatestStatus(ctx as unknown as BulletinLatestStatusCtx);

    // ---- Plan 04-03 — Employee Chat send / edit action handlers -------------
    // chat.send is the canonical-write path (createComment -> public.
    // issue_comments, CHAT-02) with message_uuid dedup (CHAT-06) and auto-
    // reopen (D-06). chat.edit appends a superseding comment (CHAT-05 / D-11).
    // Both are non-exempt — registered AFTER the exempt-key handlers, and
    // opt-in-guard wrapped (T-04-08).
    registerChatSend(ctx as unknown as ChatSendCtx);
    registerChatEdit(ctx as unknown as ChatEditCtx);

    // ---- Plan 04-04 — Employee Chat read + CRUD handlers --------------------
    // The six handlers the 04-05 chat UI consumes:
    //   chat.roster        — employee list, Editor-Agent excluded (CHAT-01)
    //   chat.topics        — CHT-NN topic strip for a selected employee
    //   chat.topic.create  — creates a child topic issue + chat_topics row
    //   chat.messages      — server-ordered thread, supersedes/pin metadata
    //   chat.search        — ILIKE global search over chat comments (CHAT-08)
    //   chat.promote       — promote-to-task: real linked issue (CHAT-09)
    //   chat.pin           — toggles the chat-metadata pin flag (CHAT-09)
    // All non-exempt — registered AFTER the exempt-key handlers and opt-in-
    // guard wrapped (T-04-15, OPTIN-04). chat-topics registers both a data
    // key (chat.topics) and an action key (chat.topic.create).
    registerChatRoster(ctx as unknown as ChatRosterCtx);
    registerChatTopics(ctx as unknown as ChatTopicsCtx);
    registerChatMessages(ctx as unknown as ChatMessagesCtx);
    registerChatSearch(ctx as unknown as ChatSearchCtx);
    registerChatPromote(ctx as unknown as ChatPromoteCtx);
    registerChatPin(ctx as unknown as ChatPinCtx);
    // Plan 04.1-02 — operator-composer "create a true task" (D-04 partner of
    // chat.promote; both delegate to createTrueTask).
    registerChatTrueTask(ctx as unknown as ChatTrueTaskCtx);
    // Plan 04.1-05 — D-10 plugin-side archive action handler. NEVER calls
    // ctx.issues.update — the host issue MUST stay non-terminal (the OQ3
    // attempt-2 evidence shows the host's disposition-recovery service
    // engages on terminal chat-topic issues).
    registerChatTopicArchive(ctx as unknown as ChatTopicArchiveCtx);
    // Plan 04.1-05 — D-08 active-tasks-per-topic data handler. Reads the
    // chat_topic_tasks side table (populated by createTrueTask's retrofit
    // best-effort write) + enriches per-row via ctx.issues.get. Never
    // calls ctx.issues.list (Wave 1 lock: REST originId filters do not
    // work; the side table is the steady-state lookup path).
    registerChatActiveTasks(ctx as unknown as ChatActiveTasksCtx);

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

    // ---- Plan 04-03 — Employee Chat realtime stream bridge ------------------
    // Subscribes to the core issue.comment.created event and re-emits comments
    // on chat-topic issues onto the per-company plugin SSE channel
    // chat:<companyId> (CHAT-04 / D-08). The handler body is try/catch wrapped
    // internally — a throwing event handler never crashes the worker (T-04-12).
    registerChatStreamBridge(ctx as unknown as ChatStreamBridgeCtx);

    ctx.logger?.info?.(
      `clarity-pack worker started — Editor-Agent ${EDITOR_AGENT_KEY} reconciled, resolve-refs + flatten-blocker-chain + issue.reader + ac-toggle + editor.pause-status + chat.send/chat.edit + chat-stream-bridge + chat.roster/topics/messages/search/promote/pin registered`,
    );
  },
});

runWorker(plugin, import.meta.url);
