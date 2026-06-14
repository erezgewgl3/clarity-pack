// src/worker.ts — Plan 02-04 worker wiring.
//
// Plan 02-03 brought Editor-Agent + Reader handlers. Plan 02-04 adds:
//   - get-opt-in + set-opt-in (boot-time exempt handlers)
//   - get-instance-config (boot-time exempt handler, per 02-01 Check F)
//   - opt-in-guard wrap around every 02-02/02-03 non-exempt handler
// Plan 02-04 Task 2 adds:
//   - situation.snapshot + situation.active-viewer-ping (wrapped)
//   - the situation-snapshot 60s cron job (REMOVED in Plan 09-01 — dead path)

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
// Debug editor-heartbeat-db-churn (v1.4.4) — Fix 1 (batch + debounce) + the
// Fix-2 read-side short-circuit live in the dispatcher. The worker feeds host
// events into it instead of running a per-event reconcile + heartbeat.
import { HeartbeatDispatcher } from './worker/agents/heartbeat-dispatcher.ts';
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
// T1-D (no-rabbit-holes self-health, 2026-06-15) — a dependency-free worker
// liveness probe (opt-in-exempt, zero-DB). Ops/host can hit it to detect a
// crashed/not-ready worker (the BEAAA blank-UI incident's root class).
import { registerClarityHealth, type ClarityHealthCtx } from './worker/handlers/clarity-health.ts';
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
// Plan 09-01 — the situation-snapshot 60s job (registerSituationSnapshotJob,
// formerly src/worker/jobs/situation-snapshot.ts) was REMOVED. It was dead on
// 2026.525.0 (PR #6547 invocation-scope) and had no synchronous UI caller; the
// live Situation Room renders from the FRESH situation.snapshot data handler.
// The jobs[] manifest entry + the orphaned file were deleted in this plan; the
// situation_snapshots TABLE is preserved (R9 additive-only).
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
// Quick task 260528-nns — bulletin.compileNow action: the operator's "Generate
// bulletin now" button. Reuses the shared compileBulletinForCompany pipeline
// with force:true (bypasses the due-gate, dedupes on content_hash, leaves the
// daily schedule pointer untouched). Opt-in-guard wrapped.
import {
  registerBulletinCompileNow,
  type BulletinCompileNowCtx,
} from './worker/handlers/bulletin-compile-now.ts';
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
// Plan 05-08 — D-20 storage-pin = topic exempt from archive (chat.topic.pin)
// AND D-16 bulk-unarchive for archive full-view (chat.topic.bulkUnarchive).
// Both are plugin-side only; CTT-07 invariant preserved (no host issue
// mutation -- regression-guarded by handler tests).
import {
  registerChatTopicPin,
  type ChatTopicPinCtx,
} from './worker/handlers/chat-topic-pin.ts';
import {
  registerChatTopicBulkUnarchive,
  type ChatTopicBulkUnarchiveCtx,
} from './worker/handlers/chat-topic-bulk-unarchive.ts';
import {
  registerChatActiveTasks,
  type ChatActiveTasksCtx,
} from './worker/handlers/chat-active-tasks.ts';
// Plan 04.1-08 — chat.archivedTopics: data handler powering the archive panel
// (dropdown anchored to the +N archived pill). ORDER BY archived_at DESC.
import {
  registerChatArchivedTopics,
  type ChatArchivedTopicsCtx,
} from './worker/handlers/chat-archived-topics.ts';
// Plan 04.2-01 — chat.openForIssue: deterministic Reader -> Chat lineage
// routing (RCB-02). Read-only -- never mutates the host issue.
import {
  registerChatOpenForIssue,
  type ChatOpenForIssueCtx,
} from './worker/handlers/chat-open-for-issue.ts';
// Plan 05-03 (DIST-03) — reader.ac.autostatus: comment-marker scanner that
// promotes the Phase 2 manual AC checklist to event-derived auto-status.
// Read-only over ctx.issues.listComments + ctx.agents.get.
import {
  registerReaderAcAutostatus,
  type ReaderAcAutostatusCtx,
} from './worker/handlers/reader-ac-autostatus.ts';
// Plan 05-04 (DIST-04) — deliverable.preview: full-fidelity previewer
// dispatch (xlsx-grid / pdf-embed / md / img / placeholder). SheetJS
// (xlsx) lives ONLY in this file's worker-bundle dependency graph; the
// UI bundle imports react-markdown but never xlsx (T-05-04-06 supply-
// chain split). Read-only over ctx.issues.documents.{list,get}.
import {
  registerDeliverablePreview,
  type DeliverablePreviewCtx,
} from './worker/handlers/deliverable-preview.ts';
// Plan 05-11 (CHAT-07 gap closure) — chat.attachment.list (data) +
// chat.attachment.upload (action). Composer attachments via the plugin-
// owned ctx.issues.documents.upsert store; chat_message_attachments side
// table links attachments to chat_messages rows. CTT-07 invariant by
// construction (no ctx.issues.update).
import {
  registerChatAttachmentList,
  type ChatAttachmentListCtx,
} from './worker/handlers/chat-attachment-list.ts';
import {
  registerChatAttachmentUpload,
  type ChatAttachmentUploadCtx,
} from './worker/handlers/chat-attachment-upload.ts';
// Phase 6.1 ROOM-09 -- agent.takeOwnership: operator claims ownership of
// an agent's blocker-chain leaf. Writes plugin_clarity_pack_cdd6bda4bd.
// clarity_agent_owners (migration 0013); the snapshot recompute job
// consults the side table FIRST. CTT-07 invariant by construction --
// no ctx.issues.update call site (pinned by runtime spy + source-grep).
import {
  registerAgentTakeOwnership,
  type AgentTakeOwnershipCtx,
} from './worker/handlers/agent-take-ownership.ts';
// Plan 09-01 ROOM/R3 -- situation.assignOwner: the FIRST plugin core-issue
// mutation. The operator assigns an owner to an unowned blocking issue from a
// Situation Room row via ctx.issues.update (NOT the plugin-namespace side
// table). Company-scope authority gate mirrors agent.takeOwnership; the update's
// actor arg carries the operator userId for audit attribution. Requires the new
// issues.update manifest capability (added in Task 3).
import {
  registerSituationAssignOwner,
  type SituationAssignOwnerCtx,
} from './worker/handlers/situation-assign-owner.ts';
// Plan 14-01 (DO-01 / DO-02) — situation.replyAndResume: the Do-It-Here reply+
// resume mutation. Posts the operator's reply as a canonical issue_comments
// comment (native resume trigger) then, ONLY when the caller passes
// needsDurabilityFlip===true (Shape B), applies the operator-attributed durable
// {status:'in_progress'} flip. Idempotent on a client messageUuid (migration
// 0016). Capabilities issue.comments.create + issues.update are ALREADY declared
// (D-14, no new cap; NOT issue.relations.write).
import {
  registerSituationReplyAndResume,
  type SituationReplyAndResumeCtx,
} from './worker/handlers/situation-reply-and-resume.ts';
// Plan 18-03 (LEG-03) — situation.closeAsDone: the confirm-gated close mutation
// behind the "Looks done — close it?" affordance. Flips the leaf issue to
// status='done' via ctx.issues.update (operator-attributed), reusing the SR
// assign-owner privilege boundary (A7) + the already-declared issues.update
// capability. Never fires without the operator's explicit "Close as done".
import {
  registerSituationCloseAsDone,
  type SituationCloseAsDoneCtx,
} from './worker/handlers/situation-close-as-done.ts';
// Plan 09-02 (R4 / R7) — agents.pauseHeartbeat (Stand down) + issues.requestWakeup
// (Wake): the two real write paths the actionable cockpit's idle/stale + blocked-
// owned rows dispatch. No new capability (agents.pause + issues.wakeup already
// declared); no version bump. Mirror agents.resumeHeartbeat's THROW-on-failure
// contract so the UI callers degrade gracefully.
import {
  registerAgentPauseHeartbeat,
  type AgentPauseHeartbeatCtx,
} from './worker/handlers/agent-pause-heartbeat.ts';
import {
  registerIssueRequestWakeup,
  type IssueRequestWakeupCtx,
} from './worker/handlers/issue-request-wakeup.ts';
// Quick task 260528-mn0 -- agents.resumeHeartbeat action handler. Both the
// paused-agent banner (Reader + chat header) and the chat Quick Action row
// call usePluginAction('agents.resumeHeartbeat'); the key was never registered
// so the host returned 502 on click. Resolves the Editor-Agent UUID (or honors
// an explicit agentId) + calls ctx.agents.resume. Opt-in-guard wrapped.
import {
  registerAgentResumeHeartbeat,
  type AgentResumeHeartbeatCtx,
} from './worker/handlers/agent-resume-heartbeat.ts';
// Phase 16.1 Plan 16.1-03 (LOOP-01 / LOOP-02 / LOOP-04) — the ingress
// loop-break. ensureSeeded + isCompanyOptedIn are the lazy-seeded opt-in scope
// gate (D-12/D-13); isOwnOperationIssue is the durable restart-safe provenance
// check (D-04). Both run at ingress BEFORE any host call. invalidateOptedInCache
// is wired below so an opt-in change refreshes the company set.
import {
  ensureSeeded,
  isCompanyOptedIn,
  type OptedInCompanySetCtx,
} from './worker/opted-in-company-set.ts';
import {
  isOwnOperationIssue,
  type OwnOperationIssuesRepoCtx,
} from './worker/db/own-operation-issues-repo.ts';
// The in-memory fast-path cache that fronts the durable provenance read. Kept as
// a zero-DB pre-check; the durable isOwnOperationIssue is authoritative (D-04).
import { isRememberedOwnOperationIssue } from './worker/agents/op-issue-set.ts';

const plugin = definePlugin({
  async setup(ctx) {
    // ---- Plan 02-04 Task 1 — exempt-key handlers FIRST -----------------------
    // These must register BEFORE any wrapped handler so the prefs table is
    // wire-ready (and the exempt set is honoured at register time, not just
    // dispatch time).
    registerGetOptIn(ctx as unknown as GetOptInCtx);
    registerSetOptIn(ctx as unknown as SetOptInCtx);
    registerGetInstanceConfig(ctx as unknown as GetInstanceConfigCtx);
    // T1-D — opt-in-exempt worker liveness probe (clarity-pack/health).
    registerClarityHealth(ctx as unknown as ClarityHealthCtx);

    // ---- Plan 02-02 data handlers (now wrapped with opt-in-guard) -----------
    registerResolveRefs(ctx as unknown as ResolveRefsCtx);
    registerFlattenBlockerChain(ctx as unknown as FlattenBlockerChainCtx);

    // ---- Plan 02-03 Reader-view data + action handlers (now wrapped) --------
    registerIssueReader(ctx as unknown as IssueReaderCtx);
    registerAcChecklist(ctx as unknown as AcChecklistCtx);
    registerEditorPauseStatus(ctx as unknown as EditorPauseStatusCtx);
    // Plan 05-03 (DIST-03) — reader.ac.autostatus is a Reader-view data
    // handler (mounts alongside issue.reader). Lives in the Reader block
    // because that is the sole consumer (ReaderViewReady's usePluginData
    // hook in src/ui/surfaces/reader/index.tsx). Read-only — never mutates.
    registerReaderAcAutostatus(ctx as unknown as ReaderAcAutostatusCtx);
    // Plan 05-04 (DIST-04) — deliverable.preview is the Reader-view data
    // handler that replaces the locked "Phase 5 (DIST-04)" placeholder. It
    // dispatches per documentKey extension and returns a discriminated
    // union the UI mounts directly (xlsx-grid / pdf-embed / md / img /
    // placeholder). SheetJS lives ONLY in this handler's import graph;
    // the UI bundle never imports xlsx.
    registerDeliverablePreview(ctx as unknown as DeliverablePreviewCtx);

    // ---- Plan 02-03c companyId resolver (UI fallback path) ------------------
    // NOTE: companies.resolve-prefix is NOT wrapped — it's also a boot-time
    // resolver used by the UI to compute companyId BEFORE the user is even
    // identified. Task 2 will decide if it should be added to the EXEMPT set.
    registerCompaniesResolve(ctx as unknown as CompaniesResolveCtx);

    // ---- Plan 02-04 Task 2 — Situation Room handlers + job ------------------
    registerSituationRoomHandlers(ctx as unknown as SituationRoomCtx);
    registerActiveViewerPing(ctx as unknown as ActiveViewerPingCtx);
    // Plan 09-01 — registerSituationSnapshotJob (the situation-snapshot cron)
    // removed (dead on 2026.525.0; no synchronous UI caller). situation.snapshot
    // DATA handler above is the sole live read path and computes fresh per request.

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
    // Quick task 260528-nns — on-demand "Generate bulletin now" action.
    registerBulletinCompileNow(ctx as unknown as BulletinCompileNowCtx);

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
    // Plan 05-08 — D-20 chat.topic.pin (storage-pin toggle; pinned topics
    // are exempt from archive — see chat-topic-archive.ts PIN_EXEMPT guard).
    // D-16 chat.topic.bulkUnarchive (archive full-view's bulk-select action;
    // single round-trip multi-row flip). Both CTT-07 invariant by
    // construction — plugin-namespace UPDATE only, never ctx.issues.update.
    registerChatTopicPin(ctx as unknown as ChatTopicPinCtx);
    registerChatTopicBulkUnarchive(ctx as unknown as ChatTopicBulkUnarchiveCtx);
    // Plan 04.1-05 — D-08 active-tasks-per-topic data handler. Reads the
    // chat_topic_tasks side table (populated by createTrueTask's retrofit
    // best-effort write) + enriches per-row via ctx.issues.get. Never
    // calls ctx.issues.list (Wave 1 lock: REST originId filters do not
    // work; the side table is the steady-state lookup path).
    registerChatActiveTasks(ctx as unknown as ChatActiveTasksCtx);
    // Plan 04.1-08 — chat.archivedTopics: lists every archived topic for an
    // employee+company, newest-archived-first. Reads via
    // listArchivedChatTopicsForEmployee which uses the archived_at column
    // added by migration 0008.
    registerChatArchivedTopics(ctx as unknown as ChatArchivedTopicsCtx);
    // Plan 04.2-01 — chat.openForIssue: the Reader-view Continue-in-chat
    // primitive resolves an issue's deterministic chat route through this
    // handler (RCB-02). Non-exempt, opt-in-guard wrapped. Read-only.
    registerChatOpenForIssue(ctx as unknown as ChatOpenForIssueCtx);
    // Plan 05-11 (CHAT-07) — chat.attachment.list data handler (right-rail
    // Recent Attachments panel + Reader empty-state cross-check). Read-only
    // over plugin_clarity_pack_cdd6bda4bd.chat_message_attachments.
    registerChatAttachmentList(ctx as unknown as ChatAttachmentListCtx);
    // Plan 05-11 (CHAT-07) — chat.attachment.upload action handler.
    // Upload-on-send semantics (Option B locked 2026-05-26): chat.send
    // commits the chat_messages row FIRST; this handler commits the
    // chat_message_attachments row AFTER with the just-returned message
    // uuid. Mime-sniff + 10 MB/file + 50 MB/message guards. CTT-07
    // invariant by construction (no ctx.issues.update -- pinned by both
    // runtime spy and source-grep test).
    registerChatAttachmentUpload(ctx as unknown as ChatAttachmentUploadCtx);

    // ---- Phase 6.1 ROOM-09 -- agent.takeOwnership action handler -----------
    // Operator claims ownership of an agent's blocker-chain leaf so the
    // Situation Room Critical Path renders HUMAN_ACTION_ON(<real_user_id>)
    // instead of HUMAN_ACTION_ON(__unowned__). Writes the plugin-namespace
    // clarity_agent_owners side table (migration 0013). T-04-16 viewer-
    // authority re-check: ctx.agents.get gates by company. CTT-07
    // invariant by construction -- pinned by runtime spy + source-grep.
    registerAgentTakeOwnership(ctx as unknown as AgentTakeOwnershipCtx);

    // ---- Plan 09-01 R3 -- situation.assignOwner action handler -------------
    // The first plugin core-issue mutation. Reassigns the blocker-chain leaf's
    // assignee (agentId, or assigneeUserId for the D-02 "Take it myself" path)
    // via ctx.issues.update with the operator as the audit actor. Same ctx
    // clients as agent.takeOwnership (issues, agents, db for opt-in-guard).
    registerSituationAssignOwner(ctx as unknown as SituationAssignOwnerCtx);

    // ---- Plan 14-01 (DO-01 / DO-02) — situation.replyAndResume -------------
    // The Do-It-Here reply+resume mutation. Posts the operator's reply as a
    // canonical public.issue_comments comment (the Phase-10 native resume
    // trigger for both Shape A and Shape B), then — ONLY when the caller passes
    // the REAL needsDurabilityFlip===true boolean (Shape B, leaf status=blocked;
    // NOT a terminal.kind proxy) — applies the operator-attributed durable
    // {status:'in_progress'} flip (the CTT-07 exception). Idempotent on the
    // client messageUuid via the additive plugin-namespace dedup table
    // (migration 0016). Same ctx clients as assign-owner (issues, db for the
    // opt-in-guard + the reply-resume repo). The fire-and-forget requestWakeup
    // carries idempotencyKey:messageUuid.
    registerSituationReplyAndResume(ctx as unknown as SituationReplyAndResumeCtx);

    // ---- Plan 18-03 (LEG-03) — situation.closeAsDone -----------------------
    // The confirm-gated close mutation behind the honest-divergence affordance.
    // Flips the blocker leaf to status='done' via ctx.issues.update with the
    // operator as the audit actor — ONLY after the operator explicitly selects
    // "Close as done" in the UI (never auto-closes). Same ctx clients + privilege
    // boundary as situation.assignOwner (issues.update + db for the opt-in-guard).
    registerSituationCloseAsDone(ctx as unknown as SituationCloseAsDoneCtx);

    // ---- Plan 09-02 (R1 / BLOCKER 1) — situation.artifacts handler REMOVED ---
    // The dead AgentCard grid was situation.artifacts' only consumer; both the
    // UI fetch and this worker handler are deleted ATOMICALLY in this same plan
    // (no wave-gap where the UI calls a removed handler). The 24h artifact-chip
    // window + its instanceConfigSchema key are gone with it.

    // ---- Plan 09-02 (R4 / R7) — Stand down + Wake action handlers -----------
    // agents.pauseHeartbeat backs the idle/stale row's "Stand down" (behind a
    // confirm dialog); issues.requestWakeup backs the blocked-owned row's
    // "Wake". Both make the cockpit's buttons real actions (R4 — no dead
    // buttons). Opt-in-guard wrapped; THROW-on-failure so the UI degrades.
    registerAgentPauseHeartbeat(ctx as unknown as AgentPauseHeartbeatCtx);
    registerIssueRequestWakeup(ctx as unknown as IssueRequestWakeupCtx);

    // ---- Quick task 260528-mn0 -- agents.resumeHeartbeat action handler -----
    // Resolves the Editor-Agent UUID (pause-banner caller) or honors an
    // explicit agentId (chat Quick Action's chatted employee) and calls
    // ctx.agents.resume. Throws on failure so the UI callers degrade
    // gracefully. Opt-in-guard wrapped. No new capability (agents.resume +
    // agents.managed already declared) and no version bump.
    registerAgentResumeHeartbeat(ctx as unknown as AgentResumeHeartbeatCtx);

    // ---- Plan 02-03 Editor-Agent reconcile + heartbeat ----------------------
    //
    // 2026-05-28 — REMOVED the boot-time `ctx.companies.list()` +
    // reconcile-all-companies loop. Paperclip PR #6547 (shipped in
    // paperclipai@2026.525.0) requires every worker->host call to carry a
    // valid invocationId from an active host->worker invocation (parked in
    // AsyncLocalStorage). A call issued at worker BOOT runs outside any
    // invocation, so `ctx.companies.list()` was rejected on every startup
    // with "the worker referenced a missing, expired, or unknown invocation
    // scope" — caught and warned, but noisy and non-functional (the loop
    // body never ran).
    //
    // The loop was also fully REDUNDANT. The Editor-Agent is reconciled —
    // inside valid invocation scopes — by all three of:
    //   - the per-event handler below (issue.created/updated/comment.created),
    //   - the company.created handler below (new companies), and
    //   - the compile-bulletin scheduled job, which reconciles per company at
    //     cycle start (src/worker/jobs/compile-bulletin.ts — ctx.agents.managed
    //     .reconcile(EDITOR_AGENT_KEY, company.id)).
    // So no boot-time reconcile is needed; removing it eliminates the
    // invocation-scope boot warning with zero behavioral change. Verified on
    // BEAAA (2026-05-28): TL;DR compiles + bulletin cycles succeed without it.

    // Reconcile on company creation so new companies get the Editor-Agent
    // without a plugin restart.
    //
    // Phase 16.1 Plan 16.1-03 (L-5 disposition #1): reconcileEditorAgent is NOT
    // a wake, but it IS unscoped host work (a host round-trip) that previously
    // ran for EVERY company on the instance regardless of opt-in. Gate it on the
    // opted-in-company scope (D-13) — a company nobody has opted into never gets
    // a reconcile. ensureSeeded runs in handler scope (lazy, never boot — L-3).
    ctx.events.on('company.created', async (event) => {
      try {
        await ensureSeeded(ctx as unknown as OptedInCompanySetCtx);
        if (!isCompanyOptedIn(event.companyId)) return; // out-of-scope — no host work
        await reconcileEditorAgent(ctx as unknown as EditorAgentReconcileCtx, event.companyId);
      } catch (err) {
        ctx.logger?.warn?.('Editor-Agent reconcile failed on company.created', {
          companyId: event.companyId,
          err: (err as Error).message,
        });
      }
    });

    // ---- Heartbeat dispatcher (batch + debounce) ---------------------------
    //
    // Debug editor-heartbeat-db-churn (v1.4.4) — RC1 fix. The host emits
    // issue.created / issue.updated + issue.comment.created events; the OLD
    // wiring ran, FOR EVERY event in the WHOLE instance, a synchronous
    // reconcileEditorAgent() (a host round-trip, no cache) + a single-event
    // handleEditorHeartbeat(). The plugin's own operation issues generate
    // events that re-entered that path (caught by isOwnOperationIssue only
    // AFTER a reconcile + issues.get). Measured on BEAAA: ~3.8 self-triggered
    // heartbeats/sec, each a reconcile + a get.
    //
    // The HeartbeatDispatcher restores the long-documented "bundle events per
    // heartbeat-window" intent:
    //   - Fix 2 (read short-circuit): an event whose entityId is a remembered
    //     plugin-created operation issue (or whose actorType is 'plugin') is
    //     DROPPED before any reconcile/DB call — a zero-DB recursion guard.
    //   - Fix 1 (batch + debounce): surviving events accumulate per company and
    //     flush on a ~12s debounce (or a 50-issue burst cap). Per flush:
    //     reconcile ONCE (cached per company), dedupe issueIds, run ONE batched
    //     handleEditorHeartbeat.
    //
    // Fix 4 (tags): the host PluginEvent carries NO top-level `tags` field
    // (verified against @paperclipai/plugin-sdk@2026.512.0 types.d.ts — only
    // actorId/actorType/entityId/entityType/companyId/payload). So the dead
    // `tags:[]` of the old wiring had nothing host-carried to pass through; the
    // honest defense-in-depth is the author_id check inside filterSelfLoopEvents
    // PLUS the Fix-2 remembered-op-issue id short-circuit PLUS the cheap
    // actorType==='plugin' drop above. The tag-based half of the self-loop
    // filter remains for any FUTURE event source that does carry tags (e.g. a
    // plugin-emitted event), but is not relied upon for the host issue events.
    //
    // Governance parity preserved: nothing here resumes/invokes an agent; a
    // paused Editor-Agent still performs no LLM work downstream. The debounce is
    // a local unref'd timer that only exists while events are pending.
    //
    // Phase 16.1 Plan 16.1-03 (Open Q #4 — disposition (b)): the ingress event
    // handler below NO LONGER feeds this dispatcher. The dispatcher is retained
    // as the agent's own pull-side batching primitive (used by the native
    // heartbeat path, not event-triggered) AND, deliberately, as the Plan 05
    // Task 1 gate-scope anchor: its runHeartbeat/handleEditorHeartbeat config
    // keys must stay in MODULE scope, OUTSIDE every ctx.events.on body, so the
    // handler-body-scoped static no-wake gate does not false-positive on them.
    // Do NOT move this constructor into an event handler.
    const heartbeatDispatcher = new HeartbeatDispatcher({
      resolveAgentId: (companyId) =>
        reconcileEditorAgent(ctx as unknown as EditorAgentReconcileCtx, companyId),
      runHeartbeat: (companyId, agentId, events) =>
        handleEditorHeartbeat(ctx as unknown as EditorHeartbeatCtx, {
          companyId,
          agentId,
          events,
        }),
      logger: ctx.logger,
    });
    // Retained-but-not-event-fed (disposition (b)): reference it so the module
    // scope binding is not flagged dead while the ingress handler stays
    // observe-only. The native heartbeat path owns the actual dispatch.
    void heartbeatDispatcher;

    // ---- Phase 16.1 Plan 16.1-03 — OBSERVE-ONLY ingress (loop-break) --------
    //
    // THE 2026-06-04 LOOP. The OLD wiring fed every instance-wide issue/comment
    // event into heartbeatDispatcher.enqueue, whose flush ran reconcile +
    // handleEditorHeartbeat — host work + a wake of the Editor-Agent. Clarity's
    // own op-issue writes re-entered that path; the in-memory op-issue guard was
    // empty after a restart, so a self-sustaining wake storm (~3.8/sec) ignited.
    //
    // THE FIX (D-02/D-04/D-13). This handler is now OBSERVE-ONLY. The dispatcher
    // is NEVER fed from ingress (disposition (b), Open Q #4): no enqueue, no
    // reconcile, no runHeartbeat/handleEditorHeartbeat, no requestWakeup, no
    // ctx.agents.* reachable from this body. The Editor-Agent's own native
    // heartbeat (the compile-bulletin scheduled job, which reconciles + pulls per
    // company at cycle start) is the SOLE dispatch path. The HeartbeatDispatcher
    // constructor above stays in MODULE scope, outside every ctx.events.on body,
    // so Plan 05 Task 1's handler-body-scoped static gate does not false-positive
    // on its runHeartbeat/handleEditorHeartbeat config keys.
    //
    // Short-circuit order — ALL before any host call (D-04/D-13):
    //   (1) scope gate (LOOP-04): companyId not in the lazy-seeded opted-in set
    //       -> return; zero host work for out-of-scope companies.
    //   (2) provenance gate (LOOP-02): a Clarity-authored op-issue (durable
    //       own_operation_issues row) -> return; the restart-safe loop-break,
    //       authoritative over the in-memory fast-path set (D-04).
    //   (3) surviving events are OBSERVED only (a structured log line — the
    //       lightweight durable-namespace dirty-marker is intentionally NOT a new
    //       table here; the native heartbeat already pulls open issues, so no
    //       enqueue-to-wake is needed). This carries NO wake.
    for (const evt of ['issue.created', 'issue.updated', 'issue.comment.created'] as const) {
      ctx.events.on(evt, async (event) => {
        // A throwing host event handler would be logged by the host, but we keep
        // this defensive try so one malformed event can never wedge the bus.
        try {
          const companyId = event.companyId;
          const entityId = event.entityId;
          if (!companyId || !entityId) return;

          // (1) opt-in / active-company scope gate (LOOP-04). ensureSeeded runs
          // lazily in handler scope (never boot — L-3); membership is then a
          // pure in-memory test (zero per-event DB call).
          await ensureSeeded(ctx as unknown as OptedInCompanySetCtx);
          if (!isCompanyOptedIn(companyId)) return; // out-of-scope — no host work

          // (2) durable own-operation provenance check (LOOP-02 / D-04). The
          // in-memory fast-path may run first, but the durable read is
          // authoritative — it survives a restart (the empty-on-restart set was
          // the loop's restart-window bypass). A Clarity-authored op-issue is
          // dropped here BEFORE any further work.
          if (isRememberedOwnOperationIssue(entityId)) return; // fast-path cache
          if (await isOwnOperationIssue(ctx as unknown as OwnOperationIssuesRepoCtx, companyId, entityId)) {
            return; // durable provenance — own write, drop
          }

          // (3) OBSERVE-ONLY. A surviving event is a real, in-scope, non-own
          // change. We record an observation marker (log) and do NOTHING that
          // could wake an agent. The native heartbeat pull picks up the work.
          ctx.logger?.info?.('clarity ingress: observed in-scope event (observe-only)', {
            event: evt,
            companyId,
            entityId,
          });
        } catch (err) {
          ctx.logger?.warn?.('clarity ingress: observe-only handler threw', {
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
      `clarity-pack worker started — Editor-Agent ${EDITOR_AGENT_KEY} reconciled, resolve-refs + flatten-blocker-chain + issue.reader + ac-toggle + editor.pause-status + chat.send/chat.edit + chat-stream-bridge + chat.roster/topics/messages/search/promote/pin + reader.ac.autostatus + deliverable.preview registered`,
    );
  },
});

runWorker(plugin, import.meta.url);
