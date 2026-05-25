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
//
// Plan 05-07 Task 2 (D-14) — React-key audit pass for ChatPageBody.
// Audit verdict: the body's only `.map()` (line 538 archivedRaw.topics)
// is a pure data projection — no JSX, no key needed. The outer
// `return (<>...</>)` (line 701) wraps two children (AgentPauseBanner +
// .clarity-chat-shell) as the single root return of a component, NOT
// as a sibling-in-list — no key required. Every conditional render
// branch (`{!employee ? … : !topic ? … : <Composer/>}`, archive panel,
// dialog, seed dialog) is in its own curly-brace slot — positional
// children, no key warning. Child components (RosterRail, TopicStrip,
// ChatActionsRow, ArchivePanel, MessageThread, Composer, ContextRail,
// TrueTaskDialog) are audited in their own Plan 05-07 commits or in
// no-react-key-warnings.test.mjs's static FILES set. Verified by
// test/ui/chat-react-key-console-capture.test.mjs.

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
  useHostLocation,
} from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { ClaritySurfaceHeader } from '../../primitives/clarity-surface-header.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
// Plan 05-08 Task 5 (D-17) — `ToastProvider` is now hoisted into
// ClaritySurfaceRoot; ChatPage no longer wraps a duplicate provider here.
// `useToast` is still imported because ChatPageBody calls it for the
// in-body task-created + pause-toast surfaces.
import { useToast } from '../../primitives/toast.tsx';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

import {
  RosterRail,
  normalizeRoster,
  type RosterEmployee,
  type RosterResult,
} from './roster-rail.tsx';
// Plan 05-05 (D-06 + D-07) — generic paused-agent banner shared with Reader.
// Mounted at the TOP of ChatPageBody (above the .clarity-chat-shell). When
// the selected employee changes, the banner's agentId prop re-keys
// usePluginData and the new pause status fetches automatically.
import { AgentPauseBanner } from '../../primitives/agent-pause-banner.tsx';
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
      {/* Plan 05-08 Task 5 (D-17) — the in-body <ToastProvider> wrapper that
          existed under Plan 04.1-09 has been REMOVED. ToastProvider now
          lives in ClaritySurfaceRoot (Task 4 hoist), so ChatPageBody's
          useToast() finds the provider one level up. */}
      <ChatPageBody companyId={companyId} userId={userId} />
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
        // Plan 04.2-05 D7 — thread the operator-friendly employeeName so
        // any newly-bootstrapped per-employee parent issue gets the "Chat
        // — CEO" title (not "Chat — <UUID>").
        employeeName: employee.name,
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
  // Plan 05-07 Task 2 (D-13) — `nav` (useHostNavigation) was previously
  // used to scrub `#h=` from the URL after the deep-link consume effect
  // ran. That replace-nav has been removed (see the React.useEffect
  // comment block below), so the hook is no longer needed in this file.
  const { search, pathname, hash, state: locationState } = useHostLocation();

  // Plan 04.2-04 (GAP-RCB-03-DISPATCH) — the chat shell renders entirely
  // conditionally on `employee` being non-null (the empty-state below). To
  // dispatch an existing-topic deep link we need to look up the employee by
  // the UUID in link.employee and call setEmployee with the matched
  // RosterEmployee. RosterRail also fetches chat.roster; the host bridge's
  // usePluginData deduplicates identical (action, params) pairs, so this
  // parallel call shares the underlying fetch.
  const { data: rosterData, loading: rosterLoading } = usePluginData<RosterResult>(
    'chat.roster',
    { companyId, userId },
  );
  const roster = normalizeRoster(rosterData);

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

    // Plan 04.2-04 (GAP-RCB-03-DISPATCH) race-safe defer. The chat surface
    // mount typically lands the deep link in `hash` before chat.roster
    // returns. If we consumed now, the employee lookup would miss (roster
    // is null), the consume-once ref would close the door, and replace-nav
    // would clear the hash — settling the surface on its empty state with
    // no recovery path. Hold consume back until roster is available (or
    // until the fetch settles with no data, in which case we proceed with
    // employeeAgentId set but employee unmatched — graceful degrade).
    //
    // Plan 04.2-05 D1 — defer applies to BOTH the existing-topic AND the
    // newTopic branches. The newTopic dispatch also needs a matched
    // RosterEmployee so setEmployee can run before the seed dialog opens
    // (otherwise CREATE TOPIC stays disabled with "Pick an employee from
    // the roster first" — operator drill 2026-05-24).
    if (link.employee && roster === null && rosterLoading) {
      return;
    }

    // Consume-once guard — keyed on the resolved link so neither channel
    // re-triggers after the replace-navigation clears them.
    const linkKey = JSON.stringify(link);
    if (consumedDeepLinkRef.current === linkKey) return;
    consumedDeepLinkRef.current = linkKey;

    if (link.newTopic) {
      // Plan 04.2-05 D1 — extend the race-safe employee lookup that
      // existed only in the link.topic branch to ALSO run for newTopic
      // dispatch. Setting employee BEFORE setSeedDialog means the dialog's
      // CREATE TOPIC button is enabled immediately (instead of waiting for
      // the operator to click the roster row manually — the 2026-05-24
      // drill captured this gap: dialog opened seeded, button disabled,
      // footer "Pick an employee from the roster first"). An unmatched
      // link.employee (employee absent from this user's roster) leaves
      // employee null and the dialog footer still prompts — graceful
      // degrade for the legacy / cross-user case.
      if (link.employee && roster) {
        const matched = roster.find((e) => e.id === link.employee);
        if (matched) setEmployee(matched);
      }
      // Open the pre-seeded New Topic dialog. seedTitle / seedBody are plain
      // decoded strings — they populate controlled React inputs only, never
      // dangerouslySetInnerHTML (T-04.2-02-01).
      setSeedDialog({
        title: link.seedTitle ?? '',
        body: link.seedBody ?? '',
        originIssueId: link.originIssueId,
      });
    } else if (link.topic) {
      // Plan 04.2-04 (GAP-RCB-03-DISPATCH) — set the employee FIRST so the
      // chat shell renders the thread region (the empty-state branch checks
      // `!employee`). The roster lookup matches by UUID; an unmatched id
      // (employee absent from this user's roster) leaves employee null and
      // the surface degrades to the empty state — acceptable, this is the
      // legacy-deep-link case where employee is no longer addressable.
      if (link.employee && roster) {
        const matched = roster.find((e) => e.id === link.employee);
        if (matched) setEmployee(matched);
      }
      // Topic-switch deep link. `topic` is the topic ISSUE id. We open a
      // minimal ChatTopic — the message thread + topic strip both key on
      // issueId, so the strip reconciles the full row on its own
      // chat.topics fetch. employeeAgentId is threaded from link.employee
      // so the topic-strip / context-rail can reconcile from the topic side
      // even before the roster lookup completes.
      setTopic({
        topicId: link.topic,
        issueId: link.topic,
        parentIssueId: '',
        employeeAgentId: link.employee ?? '',
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

    // Plan 05-07 Task 2 (D-13) — the URL_HASH fragment is now LEFT IN PLACE
    // post-consume. The 1.0.0-rc.7 drill captured the operator gotcha:
    // pre-05-07 the consume effect ended with a `nav.navigate(pathname,
    // { replace: true })` that scrubbed `#h=<base64-JSON>` from the address
    // bar. Hitting Browser-Back after a Reader→Chat jump then returned to
    // the chat surface with NO hash, and Forward landed on a hash-less chat
    // URL — the deep-link state was destroyed. The fix: do not replace-nav.
    //
    // The `consumedDeepLinkRef` guard above (keyed on JSON.stringify(link))
    // owns the consume-once invariant — even though the hash sits in the
    // URL after consumption, the effect's body short-circuits on the next
    // re-render because the linkKey matches. Refresh re-evaluates `link`
    // from the still-present hash and dispatches once more (same destination
    // — idempotent), which is the intended behaviour: the URL is honest
    // about the SPA state. Browser-Back navigates to the previous
    // Paperclip page (the host owns this via history.back). Forward then
    // lands on the chat surface with `#h=` intact, the effect runs, the
    // guard matches the cached linkKey, and the consume is a no-op —
    // chat state already reflects the dispatched destination.
  }, [search, pathname, hash, locationState, roster, rosterLoading]);

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
        // Plan 04.2-05 D7 — same employeeName thread-through as
        // handleNewTopic so a Reader-originated first-ever topic also
        // gets a non-UUID parent title.
        employeeName: employee.name,
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
    <>
      {/* Plan 05-08 (D-17) — shared `+ Create task` header. Mounted above
          the paused-agent banner so the affordance is consistently in the
          top-right regardless of pause state. Defaults thread the current
          employee context so the dialog opens with the chatted employee
          preselected; the actions-row T-shortcut continues to handle the
          in-thread cold-task affordance. */}
      <ClaritySurfaceHeader
        companyId={companyId}
        userId={userId}
        surface="chat"
        defaultAssigneeAgentId={employee?.id ?? ''}
        defaultEmployeeName={employee?.name ?? ''}
        employeeAgentId={employee?.id ?? ''}
        onTaskCreated={() => setRefreshKey((k) => k + 1)}
      />
      {/* Plan 05-05 (D-06 + D-07) — generic paused-agent banner. Sits above
          the .clarity-chat-shell so it spans the full chat surface width
          and is visible regardless of which employee/topic is selected.
          agentId tracks the currently-selected employee; when no employee
          is selected the banner keys on the Editor-Agent default (the
          worker's hard-coded EDITOR_AGENT_KEY). Renders nothing when the
          targeted agent is healthy. */}
      <AgentPauseBanner companyId={companyId} agentId={employee?.id ?? null} />
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
          // Plan 05-08 (D-15) — derive companyPrefix from the current URL so
          // the View-all link can navigate to /<companyPrefix>/archive. The
          // chat page is mounted at /<prefix>/chat so prefix is the first
          // non-empty path segment.
          companyPrefix={
            typeof window !== 'undefined'
              ? window.location.pathname.split('/').filter(Boolean)[0] ?? ''
              : ''
          }
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
          // Plan 05-08 (D-18) — the toggle's localStorage-restore path
          // can set the value directly; bare-click path bubbles undefined
          // (toggle behavior unchanged).
          onDiagnosticsToggle={(next) =>
            setDiagnostics((a) => (typeof next === 'boolean' ? next : !a))
          }
          // Plan 05-08 (D-18) — per-topic persistence; null when no active topic.
          diagnosticsTopicId={topic?.issueId ?? null}
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
        // Plan 05-08 (D-20) — bump refreshKey so chat.topics refetches the
        // updated pinned_at and the topic strip / Storage pin card render
        // live state.
        onPinChanged={() => setRefreshKey((k) => k + 1)}
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
            // Plan 04.2-05 D2 — the seed dialog uses role='dialog' +
            // aria-labelledby pointing at the visible <h3> heading.
            // Equivalent to Radix's `<DialogTitle>` primitive for a
            // non-Radix custom dialog shell; the 2026-05-24 drill console
            // captured an "unlabelled dialog" warning that aria-label alone
            // did not silence on this React/Radix combo.
            aria-labelledby="new-topic-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="new-topic-dialog-title">Continue in chat — new topic</h3>
            <label>
              Topic title
              <input
                type="text"
                value={seedDialog.title}
                aria-label="New topic title"
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
                aria-label="First message"
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
    </>
  );
}
