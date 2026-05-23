// src/ui/surfaces/chat/index.tsx
//
// Plan 04-05 — CHAT-01 — the Employee Chat page surface.
// Plan 04.1-08 REWIRED — mounts:
//   - <ChatActionsRow>     BETWEEN <TopicStrip> and the messages scroller
//   - <ArchivePanel>       dropdown anchored to the +N archived pill
//   - <TrueTaskDialog>     dual-mode dialog (cold + promote)
//   - <ArchivedBanner>     sticky read-only banner (rendered by MessageThread)
//
// Three-gate composition mirrors bulletin/index.tsx EXACTLY (Plan 02-09
// pattern):
//   useOptIn          → opted-out renders <EnableClarityCta surfaceName="Chat">
//   useResolvedCompanyId → unresolved renders the error fallback
//   useResolvedUserId    → unresolved renders the error fallback
// userId MUST come from useResolvedUserId — never bare useHostContext().userId
// (the production null-userId gap, DEV-15-STRUCTURAL).
//
// Then the four-region shell — roster rail / [topic strip + actions row +
// message thread + composer] / context rail — a 3-column grid 264px 1fr 360px
// per Plan 04.1-08 (was 340px in 04-05; widened so right-rail labels never
// truncate at 1280px / browser zoom 100%).
//
// All chat text renders as untrusted React text — never
// dangerouslySetInnerHTML. SPA navigation via useHostNavigation().linkProps,
// never raw <a href>.

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
  useHostLocation,
  useHostNavigation,
} from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { ToastProvider, useToast } from '../../primitives/toast.tsx';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

import { RosterRail, type RosterEmployee } from './roster-rail.tsx';
import { TopicStrip, type ChatTopic } from './topic-strip.tsx';
// Plan 04.2-02 Task 2 (GAP-RCB-03) — the SHARED Reader->Chat deep-link
// contract. parseChatDeepLink is the READ half; the Reader's
// continue-in-chat-button + reverse-topics-link use the matching EMIT half.
import { parseChatDeepLink } from './deep-link.mjs';
import { ContextRail } from './context-rail.tsx';
import { Composer } from './composer.tsx';
import { ChatActionsRow } from './actions-row.tsx';
import { ArchivePanel, type ArchivedTopic } from './archive-panel.tsx';
import { useChatActiveTasks } from './active-tasks-owned.tsx';
import {
  TrueTaskDialog,
  type TrueTaskDialogMode,
  type PromoteSourceMessage,
} from './true-task/true-task-dialog.tsx';
import type { PromoteSourceMessagePayload } from './message-thread.tsx';

type ArchivedTopicsResult =
  | {
      kind: 'archivedTopics';
      topics: Array<{
        topicIssueId: string;
        topicId: string;
        title: string;
        employeeAgentId: string;
        messageCount: number;
        lastActiveAt: string;
        archivedAt: string | null;
      }>;
    }
  | { error: string }
  | null;

export function ChatPage(_props?: PluginPageProps): React.ReactElement {
  // OPTIN — gate BEFORE resolution.
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="chat">
        <EnableClarityCta surfaceName="Chat" />
      </ClaritySurfaceRoot>
    );
  }
  return <ChatPageOptedIn />;
}

function ChatPageOptedIn(): React.ReactElement {
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();
  const { userId, loading: userLoading, error: userError } = useResolvedUserId();

  if (companyLoading || userLoading) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-loading">Resolving context…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (companyError || !companyId) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-error" data-clarity-error="no-company-context">
          Chat unavailable — could not identify the active company.
        </p>
      </ClaritySurfaceRoot>
    );
  }
  if (userError || !userId) {
    return (
      <ClaritySurfaceRoot name="chat">
        <p className="clarity-chat-error" data-clarity-error="no-user-context">
          Chat unavailable — could not identify the current user.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ClaritySurfaceRoot name="chat">
      {/* Plan 04.1-09 — ToastProvider wraps the chat body so the right rail's
          Pause heartbeat Quick Action (and any future transient-feedback
          surface) can showToast(). */}
      <ToastProvider>
        <ChatPageBody companyId={companyId} userId={userId} />
      </ToastProvider>
    </ClaritySurfaceRoot>
  );
}

function ChatPageBody({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}): React.ReactElement {
  // Plan 04.1-10 drill fix #1 — useToast must be called INSIDE the
  // <ToastProvider> tree; ChatPageBody is the first descendant guaranteed
  // wrapped (ChatPageOptedIn mounts the provider above it). The hook fires
  // the bottom-right toast for task-created + the right-rail's pause/resume.
  const { showToast } = useToast();

  const [employee, setEmployee] = React.useState<RosterEmployee | null>(null);
  const [topic, setTopic] = React.useState<ChatTopic | null>(null);
  // Bumped after a successful chat.topic.create or chat.topic.archive flip
  // so the TopicStrip's key changes and its usePluginData('chat.topics')
  // re-fetches. Also drives chat.archivedTopics refresh.
  const [refreshKey, setRefreshKey] = React.useState(0);
  // A non-blocking error surfaced when chat.topic.create returns { error }.
  const [createError, setCreateError] = React.useState<string | null>(null);
  // Plan 04.1-06 — D-16 diagnostics toggle (now mounted in the actions row
  // per Plan 04.1-08).
  const [diagnostics, setDiagnostics] = React.useState(false);

  // Plan 04.1-08 — archive panel + dialog open state.
  const [archivePanelOpen, setArchivePanelOpen] = React.useState(false);
  const [dialogState, setDialogState] = React.useState<{
    open: boolean;
    mode: TrueTaskDialogMode;
    sourceMessage: PromoteSourceMessage | null;
    sourceTopic: ChatTopic | null;
  }>({ open: false, mode: 'cold', sourceMessage: null, sourceTopic: null });

  // Plan 04.1-10 drill fix #1 — pendingTaskCard state lifted to the index.tsx
  // level (was previously expected by Composer/MessageThread as a fallback
  // prop but never written by onDialogSuccess; on the 04.1-09 live drill it
  // was always null, so the inline card NEVER appeared for promote-mode tasks
  // until the 15s chat.taskOwned poll caught up). Setting this on dialog
  // success renders the optimistic InlineTaskCard immediately for promote
  // mode; cleared on (i) marker-arrival in chat.messages (via the callback
  // threaded down to MessageThread), (ii) topic switch, (iii) employee
  // switch. For cold mode the pendingTaskCard stays null (cold tasks are
  // not topic-anchored — no inline-card surface exists).
  const [pendingTaskCard, setPendingTaskCard] = React.useState<{
    issueId: string;
    title: string;
  } | null>(null);

  // Plan 04.2-01 (RCB-03) — the pre-seeded New Topic dialog. Opened when the
  // chat surface receives ?newTopic=1 from a Reader-view Continue-in-chat ->
  // new-topic jump; the title/body are pre-filled from the seedTitle/seedBody
  // URL params and the create threads originIssueId through to
  // chat.topic.create (Task 1 RCB-04 thread-through). null = closed.
  const [seedDialog, setSeedDialog] = React.useState<{
    title: string;
    body: string;
    originIssueId: string | null;
  } | null>(null);

  // Plan 04.1-09 — chat.taskOwned fetch lifted to this level so both
  // ContextRail (right rail's "Active tasks owned") AND MessageThread
  // (inline-task-card title lookup, Plan 04.1-08 drill fix #2b) share one
  // source of truth. 15s poll cadence matches the message thread.
  const { tasks: activeTasks } = useChatActiveTasks({
    companyId,
    userId,
    topicIssueId: topic?.issueId ?? null,
  });

  const handleSelectEmployee = React.useCallback((next: RosterEmployee) => {
    setEmployee(next);
    setTopic(null);
    setArchivePanelOpen(false);
    // Plan 04.1-10 — defensive clear so a stale pending card from a prior
    // employee's topic doesn't bleed onto a fresh employee's first topic.
    setPendingTaskCard(null);
  }, []);

  const handleSelectTopic = React.useCallback((next: ChatTopic) => {
    setTopic(next);
    setArchivePanelOpen(false);
    // Plan 04.1-10 — clear pending card on topic switch (the optimistic card
    // was bound to the previous topic's marker; the next topic has its own
    // life-cycle).
    setPendingTaskCard(null);
  }, []);

  const createTopic = usePluginAction('chat.topic.create');
  const archive = usePluginAction('chat.topic.archive');
  const [creating, setCreating] = React.useState(false);

  const handleNewTopic = React.useCallback(async () => {
    if (!employee) return;
    const title = (typeof window !== 'undefined' ? window.prompt('New topic title') : null)?.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createTopic({
        employeeAgentId: employee.id,
        title,
        companyId,
        userId,
      });
      if (
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: unknown }).ok === true
      ) {
        const created = result as {
          ok: true;
          topicId: string;
          issueId: string;
          parentIssueId: string;
        };
        setTopic({
          topicId: created.topicId,
          issueId: created.issueId,
          parentIssueId: created.parentIssueId,
          employeeAgentId: employee.id,
          title,
          lastActivityAt: new Date().toISOString(),
          archived: false,
        });
        setRefreshKey((k) => k + 1);
      } else {
        const errCode =
          result && typeof result === 'object' && 'error' in result
            ? String((result as { error: unknown }).error)
            : 'CREATE_FAILED';
        setCreateError(errCode);
      }
    } catch {
      setCreateError('CREATE_FAILED');
    } finally {
      setCreating(false);
    }
  }, [employee, createTopic, companyId, userId]);

  // Plan 04.2-01 (RCB-03) / Plan 04.2-02 Task 2 (GAP-RCB-03-DEEPLINK) /
  // Plan 04.2-03 Task 2 (GAP-RCB-03-CARRIER) — chat surface deep-link
  // handling.
  //
  // The Reader-view ContinueInChatButton + ReverseTopicsLink hand the chat
  // surface an exact destination through the SHARED deep-link contract
  // (src/ui/surfaces/chat/deep-link.mjs). The canonical channel is the URL
  // fragment (`#h=<base64-JSON>`) — the Countermoves probe 2026-05-23
  // proved this is the only carrier this Paperclip host preserves
  // end-to-end: `?query` is stripped by resolveHref, `{ state }` is
  // stripped by the host wrapper around useNavigate (history.state.usr ===
  // null after click), but RFC 3986 URL fragments are client-side-only
  // and never pass through path-routing. The chat surface destructures
  // `hash` from useHostLocation() and threads it through
  // parseChatDeepLink({ search, state, hash }) — search/state remain
  // accepted by the parser for defensive input handling but no longer
  // carry the canonical payload. The resolved ChatDeepLink drives:
  //   { topic }                 — switch to that topic
  //   { topic, comment }        — switch + scroll the comment into view +
  //                               flash-highlight it for ~1.6s
  //   { newTopic, seedTitle,    — open the pre-seeded New Topic dialog;
  //     seedBody, originIssueId }  create threads originIssueId (RCB-04)
  //
  // After consumption the canonical channel is CLEARED via a replace
  // navigation (pathname only, no hash / no search / no state) so a refresh
  // does not re-trigger the dialog or the flash (T-04.2-03-04 — pinned by
  // the contract test + chat-url-params Test 4).
  const { search, pathname, hash, state: locationState } = useHostLocation();
  const nav = useHostNavigation();
  // A ref guards against the effect firing twice for the same deep link
  // (e.g. a re-render before the replace-navigation lands). The key is the
  // resolved link itself so neither a stale hash nor a stale search re-fires.
  const consumedDeepLinkRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    // parseChatDeepLink reads the URL fragment (the canonical channel per
    // Plan 04.2-03 URL_HASH carrier) and tolerates missing / malformed
    // input without throwing (T-04.2-03-05). search/state are kept on the
    // argument shape for defensive input handling but the parser now reads
    // only `hash` as the canonical channel.
    const link = parseChatDeepLink({ search, state: locationState, hash });
    if (!link) return;

    // Consume-once guard — keyed on the resolved link so neither channel
    // re-triggers after the replace-navigation clears them.
    const linkKey = JSON.stringify(link);
    if (consumedDeepLinkRef.current === linkKey) return;
    consumedDeepLinkRef.current = linkKey;

    if (link.newTopic) {
      // Open the pre-seeded New Topic dialog. seedTitle / seedBody are plain
      // decoded strings — they populate controlled React inputs only, never
      // dangerouslySetInnerHTML (T-04.2-02-01). The operator confirms the
      // assignee in the dialog before Create.
      setSeedDialog({
        title: link.seedTitle ?? '',
        body: link.seedBody ?? '',
        originIssueId: link.originIssueId,
      });
    } else if (link.topic) {
      // Topic-switch deep link. `topic` is the topic ISSUE id. We open a
      // minimal ChatTopic — the message thread + topic strip both key on
      // issueId, so the strip reconciles the full row on its own
      // chat.topics fetch.
      setTopic({
        topicId: link.topic,
        issueId: link.topic,
        parentIssueId: '',
        employeeAgentId: '',
        title: '',
        lastActivityAt: new Date().toISOString(),
        archived: false,
      });
      // If a comment target was supplied, scroll it into view + flash it once
      // the thread has rendered. A short timeout lets the topic-switch render
      // + the chat.messages fetch paint the bubble first.
      if (link.comment) {
        const targetId = `msg-${link.comment}`;
        window.setTimeout(() => {
          const el =
            typeof document !== 'undefined' ? document.getElementById(targetId) : null;
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el.classList.add('flash-highlight');
            window.setTimeout(() => el.classList.remove('flash-highlight'), 1600);
          }
        }, 600);
      }
    }

    // Clear the consumed fragment so a refresh does not re-trigger the
    // dialog or the flash. A replace navigation to the bare pathname (no
    // hash, no state) keeps the history entry clean and drops the
    // `#h=<encoded>` fragment that carried the payload (Plan 04.2-03).
    nav.navigate(pathname, { replace: true });
  }, [search, pathname, hash, locationState, nav]);

  // Plan 04.2-01 (RCB-03) — the seeded New Topic dialog's Create action.
  // Threads originIssueId through chat.topic.create (RCB-04) so the created
  // topic persists chat_topics.origin_issue_id for the About-chip backlink.
  const handleSeededCreate = React.useCallback(async () => {
    if (!employee || !seedDialog) return;
    const title = seedDialog.title.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createTopic({
        employeeAgentId: employee.id,
        title,
        companyId,
        userId,
        // RCB-04 — the source issue this topic was started from. Absent ->
        // chat.topic.create writes origin_issue_id NULL.
        originIssueId: seedDialog.originIssueId ?? undefined,
      });
      if (
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: unknown }).ok === true
      ) {
        const created = result as {
          ok: true;
          topicId: string;
          issueId: string;
          parentIssueId: string;
        };
        setTopic({
          topicId: created.topicId,
          issueId: created.issueId,
          parentIssueId: created.parentIssueId,
          employeeAgentId: employee.id,
          title,
          lastActivityAt: new Date().toISOString(),
          archived: false,
        });
        setRefreshKey((k) => k + 1);
        setSeedDialog(null);
      } else {
        const errCode =
          result && typeof result === 'object' && 'error' in result
            ? String((result as { error: unknown }).error)
            : 'CREATE_FAILED';
        setCreateError(errCode);
      }
    } catch {
      setCreateError('CREATE_FAILED');
    } finally {
      setCreating(false);
    }
  }, [employee, seedDialog, createTopic, companyId, userId]);

  // Plan 04.1-08 — archive panel state + data fetch + handlers.
  const { data: archivedRaw, refresh: refreshArchived } =
    usePluginData<ArchivedTopicsResult>(
      'chat.archivedTopics',
      employee && archivePanelOpen
        ? { companyId, userId, employeeAgentId: employee.id, _refreshKey: refreshKey }
        : {},
    );
  const archivedTopics: ArchivedTopic[] = React.useMemo(() => {
    if (!archivedRaw || typeof archivedRaw !== 'object' || !('kind' in archivedRaw)) {
      return [];
    }
    if (archivedRaw.kind !== 'archivedTopics') return [];
    return archivedRaw.topics.map((t) => ({
      topicIssueId: t.topicIssueId,
      topicId: t.topicId,
      title: t.title,
      employeeName: employee?.name ?? '',
      messageCount: t.messageCount,
      lastActiveAt: t.lastActiveAt,
      archivedAt: t.archivedAt ?? t.lastActiveAt,
    }));
  }, [archivedRaw, employee]);

  const handleOpenArchivedTopic = React.useCallback(
    (topicIssueId: string) => {
      // Find the topic in the archived list and open it in ARCHIVED state.
      const found = archivedTopics.find((t) => t.topicIssueId === topicIssueId);
      if (!found || !employee) return;
      setTopic({
        topicId: found.topicId,
        issueId: found.topicIssueId,
        // Best-effort — parentIssueId isn't exposed in archived rows; the
        // composer is disabled so this field is not load-bearing. Empty
        // string is acceptable; future plans can plumb it.
        parentIssueId: '',
        employeeAgentId: employee.id,
        title: found.title,
        lastActivityAt: found.lastActiveAt,
        archived: true,
      });
      setArchivePanelOpen(false);
    },
    [archivedTopics, employee],
  );

  const handleUnarchiveFromPanel = React.useCallback(
    async (topicIssueId: string) => {
      try {
        await archive({
          archived: false,
          topicIssueId,
          companyId,
          userId,
        });
      } finally {
        setRefreshKey((k) => k + 1);
        void refreshArchived?.();
        setArchivePanelOpen(false);
        // If the operator was viewing the archived topic in the main thread,
        // flip its archived state so the composer re-enables.
        setTopic((cur) =>
          cur && cur.issueId === topicIssueId ? { ...cur, archived: false } : cur,
        );
      }
    },
    [archive, companyId, userId, refreshArchived],
  );

  // Plan 04.1-08 — handler for the banner's Unarchive button (re-uses the
  // same chat.topic.archive flip; refetches the active topics + archive
  // panel + closes the archived view).
  const handleUnarchiveActive = React.useCallback(async () => {
    if (!topic) return;
    await handleUnarchiveFromPanel(topic.issueId);
  }, [topic, handleUnarchiveFromPanel]);

  // Plan 04.1-08 — dialog open helpers.
  const openColdDialog = React.useCallback(() => {
    setDialogState({
      open: true,
      mode: 'cold',
      sourceMessage: null,
      sourceTopic: topic ?? null,
    });
  }, [topic]);

  const openPromoteDialog = React.useCallback(
    (src: PromoteSourceMessagePayload) => {
      if (!topic) return;
      setDialogState({
        open: true,
        mode: 'promote',
        sourceMessage: {
          body: src.body,
          commentId: src.commentId,
          employeeName: src.employeeName,
          occurredAt: src.occurredAt,
        },
        sourceTopic: topic,
      });
    },
    [topic],
  );

  const closeDialog = React.useCallback(() => {
    setDialogState((s) => ({ ...s, open: false }));
  }, []);

  // Plan 04.1-10 drill fix #1 — onDialogSuccess REWRITTEN. The Plan 04.1-09
  // build did exactly two things (close + bump refreshKey) and threw away the
  // dialog's success payload via `void result`. The two consequences caught on
  // Eric's 2026-05-20 drill: (a) the optimistic inline task card NEVER lit up
  // because pendingTaskCard was never set — the operator only saw the new
  // task ~15s later when the chat.messages poll surfaced the marker comment;
  // (b) cold-mode tasks have NO marker comment by spec (not topic-anchored)
  // and NO inline-card surface, so cold tasks vanished into the void with
  // zero operator confirmation. The new shape:
  //   1. Close the dialog (unchanged).
  //   2. Bump refreshKey so any caches keyed on it re-fire (unchanged).
  //   3. For PROMOTE mode only — set pendingTaskCard so the MessageThread
  //      renders the optimistic InlineTaskCard immediately, with the title
  //      the operator just typed (NOT a UUID, NOT a skeleton). The card
  //      transitions to its activeTasks-sourced render once chat.taskOwned
  //      catches up on the next 15s poll.
  //   4. For BOTH modes — fire a creation toast at bottom-right with the
  //      8-char short-id and the assignee name. This is the ONLY operator
  //      confirmation in cold mode and a defense-in-depth confirmation in
  //      promote mode (a toast is glanceable even when the inline card
  //      scrolls off-screen).
  const onDialogSuccess = React.useCallback(
    (result: { issueId: string; mode: TrueTaskDialogMode; title: string }) => {
      setDialogState((s) => ({ ...s, open: false }));
      setRefreshKey((k) => k + 1);

      const titleForCard = result.title?.trim() || '(untitled task)';

      // PROMOTE — render the optimistic inline card immediately. COLD tasks
      // are not topic-anchored (no marker comment is posted by the worker by
      // spec, see chat-true-task handler), so no inline card path exists;
      // the toast below is the sole confirmation.
      if (result.mode === 'promote') {
        setPendingTaskCard({ issueId: result.issueId, title: titleForCard });
      }

      // BOTH modes — confirmation toast. Truncated 8-char issueId is the
      // short id until v4.2 wires the proper BEAAA-NNN identifier through
      // the worker success payload (today the createTrueTask handler returns
      // only { ok: true, issueId } — identifier lookup would require a
      // follow-up read).
      const shortId = result.issueId ? result.issueId.slice(0, 8) : '—';
      const employeeName = employee?.name ?? 'employee';
      showToast({
        message: `↗ Task created — ${shortId}, assigned to ${employeeName}.`,
        duration: 6000,
      });
    },
    [employee, showToast],
  );

  // Plan 04.1-10 drill fix #1 — clear-on-marker-arrival. When the
  // chat.messages 15s poll surfaces the marker comment that matches the
  // optimistic pendingTaskCard.issueId, MessageThread fires this callback
  // so we drop the pending state (the activeTasks lookup path now owns the
  // render — no double card). Idempotent: a second arrival for the same id
  // is a no-op (pendingTaskCard is null after the first call).
  const handlePendingResolved = React.useCallback(
    (issueId: string) => {
      setPendingTaskCard((cur) =>
        cur && cur.issueId === issueId ? null : cur,
      );
    },
    [],
  );

  return (
    <div className="clarity-chat-shell" data-clarity-region="chat-shell">
      <RosterRail
        companyId={companyId}
        userId={userId}
        activeEmployeeId={employee?.id ?? null}
        onSelectEmployee={handleSelectEmployee}
      />

      <main className="thread" data-clarity-region="thread">
        <header className="thread-head">
          <div className="who-big">
            <div className="av">
              {(employee?.name ?? '?').trim()[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="role">
              {employee?.name || 'Select an employee'}
              {employee?.role ? <small>{employee.role}</small> : null}
            </div>
          </div>
          <div className="global-search">
            <span className="icon">⌕</span>
            <input
              placeholder="Search all chats and tasks across BEAAA…"
              aria-label="Search chats"
            />
          </div>
          {/* Plan 04.1-08 — .head-actions is now empty. + New topic and
              Diagnostics both moved to the ActionsRow below. The block stays
              in the markup for symmetry with the sketch shell. */}
          <div className="head-actions" />
        </header>

        <TopicStrip
          companyId={companyId}
          userId={userId}
          employeeAgentId={employee?.id ?? ''}
          activeTopicIssueId={topic?.issueId ?? null}
          onSelectTopic={handleSelectTopic}
          onOpenArchivePanel={() => setArchivePanelOpen((o) => !o)}
          archivePanelOpen={archivePanelOpen}
          key={`${employee?.id ?? 'none'}:${refreshKey}`}
        />

        {/* Plan 04.1-08 — the archive panel is mounted as a sibling of the
            topic strip so its CSS `position: absolute; top: 100%` anchors it
            below the strip. The panel handles its own click-outside and
            Escape; the parent owns the open state via archivePanelOpen. */}
        <ArchivePanel
          open={archivePanelOpen && !!employee}
          archivedTopics={archivedTopics}
          onClose={() => setArchivePanelOpen(false)}
          onOpenTopic={handleOpenArchivedTopic}
          onUnarchive={(topicIssueId) => void handleUnarchiveFromPanel(topicIssueId)}
        />

        {/* Plan 04.1-08 — actions row sits between the topic strip and the
            messages scroller. The + Create task button opens the dialog in
            COLD mode; + New topic delegates to the existing topic create
            flow; Diagnostics moved here from the thread-head. */}
        <ChatActionsRow
          onCreateTask={openColdDialog}
          onNewTopic={() => void handleNewTopic()}
          newTopicDisabled={!employee || creating}
          diagnosticsOn={diagnostics}
          onDiagnosticsToggle={() => setDiagnostics((a) => !a)}
        />

        {createError ? (
          <div className="topic-create-error" role="alert" data-clarity-error="topic-create">
            Could not start the topic ({createError}). Try + New topic again.
          </div>
        ) : null}

        {!employee ? (
          <div className="thread-empty">
            Pick an employee from the roster to open a conversation.
          </div>
        ) : !topic ? (
          <div className="thread-empty">
            No topic selected — choose a topic above or start a new one.
          </div>
        ) : (
          <Composer
            companyId={companyId}
            userId={userId}
            topicIssueId={topic.issueId}
            topicTitle={topic.title}
            assigneeAgentId={employee.id}
            employeeName={employee.name}
            employeeRole={employee.role}
            diagnostics={diagnostics}
            // Plan 04.1-09 — chat.taskOwned data threaded down so the
            // MessageThread inline-task-card branch can look up real
            // titles by issueId from the marker comment's first capture.
            activeTasks={activeTasks}
            // Plan 04.1-10 drill fix #1 — pendingTaskCard now written by
            // onDialogSuccess at this level (was always null in 04.1-09
            // because the dialog payload was discarded via `void result`).
            // onPendingResolved fires when MessageThread spots a marker
            // whose issueId matches the pending card; we clear so the
            // activeTasks render path takes over with no double-card race.
            pendingTaskCard={pendingTaskCard}
            onPendingResolved={handlePendingResolved}
            // Plan 04.1-08 — when the active topic is archived, the
            // composer goes read-only with the dashed border + "Unarchive
            // to send messages" placeholder. The ArchivedBanner sits at
            // the top of the messages thread.
            disabled={topic.archived === true}
            // Plan 04.1-08 — per-bubble "→ Promote to task" hover button
            // opens the dual-mode dialog at this level (vs the legacy
            // inline chat.promote fire-and-forget).
            onPromoteMessage={openPromoteDialog}
            // Plan 04.1-08 — the archived-banner data flows from this level
            // (the parent owns the unarchive action; message-count and
            // task-count are best-effort 0 in v1 until chat.taskOwned /
            // chat.messages enrichment lands in Phase 4.2).
            archivedBanner={
              topic.archived === true
                ? {
                    topicTitle: topic.title,
                    messageCount: 0,
                    tasksSpawned: 0,
                    lastActiveAt: topic.lastActivityAt,
                    onUnarchive: () => void handleUnarchiveActive(),
                  }
                : null
            }
            key={`composer-${topic.issueId}`}
          />
        )}
      </main>

      <ContextRail
        employee={employee}
        topic={topic}
        companyId={companyId}
        userId={userId}
        activeTasks={activeTasks}
        onArchived={() => {
          // Plan 04.1-06 Pattern E — after a successful archive, drop the
          // archived topic from the active view and force the strip to
          // re-fetch.
          setTopic(null);
          setRefreshKey((k) => k + 1);
          void refreshArchived?.();
        }}
      />

      {/* Plan 04.1-08 — dual-mode dialog. Mounted at the shell root so the
          backdrop covers the entire chat surface; the dialog's native
          showModal() handles focus-trap + Escape. */}
      {employee ? (
        <TrueTaskDialog
          open={dialogState.open}
          mode={dialogState.mode}
          onClose={closeDialog}
          onSuccess={onDialogSuccess}
          sourceMessage={dialogState.sourceMessage}
          sourceTopic={dialogState.sourceTopic}
          defaultAssigneeAgentId={employee.id}
          defaultEmployeeName={employee.name}
          companyId={companyId}
          userId={userId}
          employeeAgentId={employee.id}
        />
      ) : null}

      {/* Plan 04.2-01 (RCB-03) — the pre-seeded New Topic dialog. Opened by
          the deep-link handler above when the chat surface receives
          ?newTopic=1 from a Reader-view Continue-in-chat -> new-topic jump.
          The title + body are CONTROLLED React inputs pre-filled from the
          decoded seedTitle / seedBody params (never dangerouslySetInnerHTML —
          T-04.2-01-03). Create threads originIssueId through chat.topic.create
          so the new topic persists chat_topics.origin_issue_id (RCB-04). */}
      {seedDialog ? (
        <div
          className="new-topic-dialog-backdrop"
          data-clarity-region="new-topic-dialog"
          onClick={() => setSeedDialog(null)}
        >
          <div
            className="new-topic-dialog"
            role="dialog"
            aria-label="Start a new chat topic"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Continue in chat — new topic</h3>
            <label>
              Topic title
              <input
                type="text"
                value={seedDialog.title}
                autoFocus
                onChange={(e) =>
                  setSeedDialog((s) => (s ? { ...s, title: e.target.value } : s))
                }
                data-clarity-field="seed-title"
              />
            </label>
            <label>
              First message
              <textarea
                value={seedDialog.body}
                onChange={(e) =>
                  setSeedDialog((s) => (s ? { ...s, body: e.target.value } : s))
                }
                data-clarity-field="seed-body"
              />
            </label>
            {createError ? (
              <div className="topic-create-error" role="alert" data-clarity-error="topic-create">
                Could not start the topic ({createError}).
              </div>
            ) : null}
            <div className="new-topic-dialog-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSeedDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!employee || creating || !seedDialog.title.trim()}
                onClick={() => void handleSeededCreate()}
                data-clarity-action="seed-create-topic"
              >
                {creating ? 'Creating…' : 'Create topic'}
              </button>
            </div>
            {!employee ? (
              <p className="thread-empty">
                Pick an employee from the roster first, then create the topic.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

    </div>
  );
}
