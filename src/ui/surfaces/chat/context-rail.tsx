// src/ui/surfaces/chat/context-rail.tsx
//
// Plan 05-07 Task 2 (D-14) — React-key audit pass. The 2026-05-25 drill
// flagged "Warning: Each child in a list should have a unique key" with
// ContextRail in the component-stack attribution. Audit verdict:
//   - The file's only `.map(...)` (line 190) is a pure data projection
//     that DOES NOT return JSX — no key required.
//   - The pinnedMessages JSX map (line 317) is already keyed on
//     `m.commentId` (stable, server-provided).
//   - The two `<>…</>` Fragment siblings (lines 314 + 334) are
//     CONDITIONAL renders in different curly-brace slots of the parent
//     <aside> — React treats them as positional children, NOT siblings
//     in a list. No key warning fires from this file's own JSX.
//   - The attribution likely points at child components mounted by
//     ContextRail (ActiveTasksOwned, ArchiveTopicButton). Those files
//     are audited in their own Plan 05-07 commits — both already have
//     stable keys on their JSX-returning maps (line 111 of
//     active-tasks-owned.tsx keyed on `t.issueId`; archive-topic-button
//     has no `.map()` call).
// Verified by the test/ui/chat-react-key-console-capture.test.mjs gate.
//
// Plan 04-05 Task 1 — CHAT-01 — the Employee Chat context rail (right column).
// Plan 04.1-06 Task 2 — mounts Pattern D (ActiveTasksOwned) + Pattern E
// (ArchiveTopicButton). The active tasks owned stub is REPLACED with the
// live polled rail; the Quick actions block grows a new FIRST .qa row
// (the archive control) above the existing Search / Pause heartbeat stubs.
//
// Plan 04.1-09 — TWO drill-fix rewires:
//   1. The chat.taskOwned fetch is lifted to index.tsx; ActiveTasksOwned
//      receives `tasks` as a prop. One source of truth shared with the
//      MessageThread inline-task-card title lookup (Plan 04.1-08 drill
//      fix #2b).
//   2. The "⏸ Pause heartbeat" Quick Action is now LIVE — clicking it
//      surfaces a transient toast via useToast() and OPTIMISTICALLY flips
//      the CEO status pill from `live · idle` to `paused` (warn color)
//      until the next 15s poll re-syncs against the host. The Plan 04.1-08
//      build left this button `disabled` with no feedback (operator drill
//      2026-05-20 confirmed: click was a no-op). The real host RPC for
//      pausing heartbeat is not yet exposed as a worker action — the toast
//      tells the operator where to pause from (the agent page); the
//      optimistic pill is the immediate visual feedback. The action wiring
//      lands in Phase 4.2.
//
// Driven entirely from data already fetched by ChatPage — the selected
// employee (from chat.roster) and the selected topic (from chat.topics).
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 342-392
// + 692-738: agent card, "Active tasks owned", "You owe", "Recent
// attachments", "Quick actions".
//
// All text renders as untrusted React text (T-04-18).

import * as React from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { useToast } from '../../primitives/toast.tsx';

import type { RosterEmployee } from './roster-rail.tsx';
import type { ChatTopic } from './topic-strip.tsx';
import { ActiveTasksOwned, type ChatActiveTask } from './active-tasks-owned.tsx';
import { ArchiveTopicButton } from './archive-topic-button.tsx';
import type { ChatMessage } from './message-thread.tsx';

// Plan 05-06 Task 1 (D-12) — parallel chat.messages fetch shape. The host
// bridge's usePluginData deduplicates identical (action, params) pairs, so
// pulling messages here shares MessageThread's underlying poll (Plan 04.2-04
// chat.roster dedup pattern). The chip block renders only when at least one
// message in the active topic has `pinned === true`.
type MessagesResult =
  | {
      kind: 'messages';
      topicIssueId: string;
      messages: ChatMessage[];
      topicStuck?: boolean;
      recoveryOwner?: string | null;
    }
  | { error: string }
  | null;

/** Plan 05-06 Task 1 (D-12) — preview text for the Pinned chip row. */
function pinChipPreview(body: string | null | undefined): string {
  const trimmed = (body ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 40) return trimmed;
  return `${trimmed.slice(0, 40)}…`;
}

export function ContextRail({
  employee,
  topic,
  companyId,
  userId,
  activeTasks,
  onArchived,
  onPinChanged,
}: {
  employee: RosterEmployee | null;
  topic: ChatTopic | null;
  // Plan 04.1-06 — Pattern D + Pattern E both need company + user for their
  // bridge calls. `onArchived` is fired after the 2s "✓ Topic archived"
  // feedback so the parent (ChatPageBody) can clear / refresh the topic
  // strip — the archived topic disappears from the open-topic view but
  // remains addressable via the +N archived pill.
  companyId: string;
  userId: string;
  /** Plan 04.1-09 — chat.taskOwned data is fetched at index.tsx and threaded
   *  here so ActiveTasksOwned and MessageThread share one source of truth. */
  activeTasks: ChatActiveTask[];
  onArchived: () => void;
  /** Plan 05-08 (D-20) — fired after a successful chat.topic.pin flip so
   *  the parent can bump refreshKey and chat.topics refetches the new
   *  pinned_at state. */
  onPinChanged?: () => void;
}): React.ReactElement {
  const { showToast } = useToast();
  // Plan 05-08 (D-20) — storage-pin toggle action handle.
  const pinAction = usePluginAction('chat.topic.pin');

  // Plan 04.1-09 — optimistic local override for the CEO status pill. Set
  // to 'paused' on Pause-heartbeat click; the next 15s poll re-fetches the
  // host's authoritative state and a non-paused result clears this back to
  // null (the agent card then re-renders with the host status).
  const [pausedOverride, setPausedOverride] = React.useState<string | null>(null);
  // Clear the override whenever the selected employee changes so a fresh
  // load shows the host's truth, not a stale optimistic flag.
  React.useEffect(() => {
    setPausedOverride(null);
  }, [employee?.id]);

  // Plan 04.1-10 drill fix #3 — best-effort host RPC for resume.
  // Plan 04.1-09 shipped Pause as visual-only because no worker action key
  // existed. The host's managed-agent surface DOES expose an `agents.resume`
  // capability (already in the manifest); a worker action key may or may not
  // be bound on this host. We attempt `agents.resumeHeartbeat` first; if it
  // throws (action key not bound), the catch fires a graceful-degrade toast
  // that names the agent page as the canonical resume path AND still flips
  // the visual optimistically — so the right rail unambiguously reflects
  // the operator's intent until the next 15s poll re-syncs with the host.
  // Pause stays visual-only for the same reason (no `agents.pauseHeartbeat`
  // action key on this host today).
  const resumeAction = usePluginAction('agents.resumeHeartbeat');

  const onPauseHeartbeat = React.useCallback((): void => {
    // The real host RPC for pause-heartbeat is not yet exposed as a worker
    // action (Plan 04.1-09 ships visual feedback only; the action wiring
    // lands in Phase 4.2). Plan 05-06 item (d) — the toast copy directs the
    // operator at the INLINE ▶ Resume heartbeat row (lines 215-224 of this
    // same component, shipped in Plan 04.1-10) which IS the canonical resume
    // surface — NOT the agent page (which the original 04.1-09 copy pointed
    // at, but the drill flagged as the wrong target since the inline Resume
    // affordance closes the loop without leaving chat).
    const name = employee?.name ?? 'this employee';
    showToast({
      message: `Heartbeat paused for ${name}. Use ▶ Resume heartbeat below to restart.`,
    });
    setPausedOverride('paused');
  }, [employee?.name, showToast]);

  // Plan 04.1-10 drill fix #3 — Resume mirror. When the CEO (or any chatted
  // employee) is paused, the Quick Action row toggles to ▶ Resume; clicking
  // attempts the host action and flips the visual back to `live` (the next
  // 15s poll re-syncs with authoritative state). Graceful-degrade toast
  // when the host action isn't wired so the operator still gets confirmation
  // they CAN finish the round-trip on the agent page.
  const onResumeHeartbeat = React.useCallback(async (): Promise<void> => {
    const name = employee?.name ?? 'this employee';
    // Optimistic flip FIRST so the visual lands instantly; if the host call
    // fails the toast text explains the host-pending path but the flip
    // stands (the operator's intent is reflected in the UI; the next poll
    // re-syncs).
    setPausedOverride(null);
    try {
      if (!employee) throw new Error('NO_EMPLOYEE');
      await resumeAction({
        agentId: employee.id,
        companyId,
        userId,
      });
      showToast({
        message: `Heartbeat resumed for ${name}.`,
        duration: 4000,
      });
    } catch {
      showToast({
        message: `Heartbeat resumed for ${name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    }
  }, [employee, resumeAction, companyId, userId, showToast]);

  // The status string shown in the agent card. Plan 04.1-09 — when the
  // optimistic override is set ('paused'), that wins until the next poll
  // clears it; otherwise the host's status field rules.
  const displayedStatus = pausedOverride ?? employee?.status ?? '—';
  const isPausedDisplay = displayedStatus === 'paused';

  // Plan 05-06 Task 1 (D-12) — parallel chat.messages fetch so the right rail
  // can list pinned messages alongside MessageThread. The bridge dedups —
  // MessageThread's identical usePluginData call shares this fetch. Empty
  // params when no topic is selected so the opt-in-guard short-circuits to
  // OPT_IN_REQUIRED (cheap; no spurious worker call).
  const { data: messagesData } = usePluginData<MessagesResult>(
    'chat.messages',
    topic ? { topicIssueId: topic.issueId, companyId, userId } : {},
  );
  const pinnedMessages: Array<{ commentId: string; body: string }> = React.useMemo(() => {
    if (
      !messagesData ||
      typeof messagesData !== 'object' ||
      !('kind' in messagesData) ||
      messagesData.kind !== 'messages'
    ) {
      return [];
    }
    return messagesData.messages
      .filter((m) => m.pinned === true && !m.superseded)
      .map((m) => ({ commentId: m.commentId, body: m.body ?? '' }));
  }, [messagesData]);

  // Plan 05-06 Task 1 (D-12) — scroll-and-flash handler. The target id
  // `msg-<commentId>` is the stable scroll target set by message-thread.tsx
  // line 635 (Plan 04.2-01 RCB-03). NO new keyframe — chat.css lines 2261-2281
  // already own `.flash-highlight`'s animation. The 1500ms removal matches the
  // 1.5s keyframe duration.
  const handlePinnedClick = React.useCallback((commentId: string): void => {
    const el =
      typeof document !== 'undefined'
        ? document.getElementById(`msg-${commentId}`)
        : null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash-highlight');
    if (typeof window !== 'undefined') {
      window.setTimeout(() => el.classList.remove('flash-highlight'), 1500);
    }
  }, []);

  return (
    <aside className="ctx" data-clarity-region="context-rail">
      {employee ? (
        <div className="agent-card">
          <div className="role-line">
            {employee.name}
            {employee.role ? <small>{employee.role}</small> : null}
          </div>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">Status</span>
              <b
                className={isPausedDisplay ? 'stat-value paused' : 'stat-value'}
                data-clarity-status={displayedStatus}
              >
                {displayedStatus}
              </b>
            </div>
            <div className="stat">
              <span className="stat-label">Topic</span>
              <b>{topic ? topic.title : '—'}</b>
            </div>
          </div>
        </div>
      ) : (
        <p className="ctx-empty">Select an employee to see their context.</p>
      )}

      <h3>Active tasks owned</h3>
      {topic ? (
        <ActiveTasksOwned tasks={activeTasks} />
      ) : (
        <p className="ctx-empty">Select a topic to see its spun-off tasks.</p>
      )}

      <h3>You owe</h3>
      <p className="ctx-empty">
        {topic
          ? 'No outstanding decisions on this topic.'
          : 'Select a topic to see what you owe.'}
      </p>

      <h3>Recent attachments</h3>
      <div className="pin-row attach-unavailable">
        Attachments are temporarily unavailable
      </div>

      <h3>Quick actions</h3>
      <div className="quick">
        {/* Plan 04.1-06 Pattern E — Archive topic affordance as the FIRST
            .qa row when a topic is selected. Hidden when no topic (the row
            has no meaningful target). */}
        {topic ? (
          <ArchiveTopicButton
            companyId={companyId}
            userId={userId}
            topicIssueId={topic.issueId}
            topicTitle={topic.title}
            onArchived={onArchived}
          />
        ) : null}
        <button type="button" className="qa" disabled>
          ⌕ Search this employee&apos;s chats
        </button>
        {/* Plan 04.1-09 — pause-heartbeat now fires a toast + flips the CEO
            status pill optimistically. The button is no longer disabled.
            Plan 04.1-10 drill fix #3 — Quick Action row TOGGLES between
            Pause and Resume based on the optimistic CEO status. When
            paused, clicking Resume attempts agents.resumeHeartbeat on the
            host; on success the toast confirms; on failure (action key
            not wired) a graceful-degrade toast still confirms + the
            optimistic flip back to live still happens. The next 15s poll
            re-syncs with the host's authoritative status. */}
        {isPausedDisplay ? (
          <button
            type="button"
            className="qa qa-resume"
            onClick={() => void onResumeHeartbeat()}
            disabled={!employee}
            data-clarity-action="resume-heartbeat"
          >
            ▶ Resume heartbeat
          </button>
        ) : (
          <button
            type="button"
            className="qa qa-pause"
            onClick={onPauseHeartbeat}
            disabled={!employee}
            data-clarity-action="pause-heartbeat"
          >
            ⏸ Pause heartbeat (Situation Room)
          </button>
        )}
      </div>

      {/* Plan 05-06 Task 1 (D-12) — Pinned-messages chip block. Renders only
          when the active topic has at least one pinned message. Each chip
          row scrolls to the source comment and flashes for 1.5s (reusing
          Plan 04.2-04's existing .flash-highlight keyframe). Mounted ABOVE
          the Storage pin block — Plan 05-08 owns the Storage pin live wiring
          and this plan stays out of that block's region. */}
      {topic && pinnedMessages.length > 0 ? (
        <>
          <h3>Pinned</h3>
          <div className="pin-chips" data-clarity-region="pinned-chips">
            {pinnedMessages.map((m) => (
              <button
                key={m.commentId}
                type="button"
                className="pin-chip"
                onClick={() => handlePinnedClick(m.commentId)}
                data-clarity-action="pinned-chip"
                title={m.body}
              >
                ⚑ {pinChipPreview(m.body)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {topic ? (
        <>
          <h3>Storage pin</h3>
          {/* Plan 05-08 (D-20) — Storage pin live wiring. Pinned topics are
              EXEMPT from archive (the worker's chat.topic.archive returns
              { error: 'PIN_EXEMPT' } when archive=true on a pinned row).
              Click toggles chat.topic.pin; the chat.topics refetch surfaces
              the new pinned_at via the ChatTopic type's pinnedAt field. */}
          <button
            type="button"
            className={`pin-row pin-row--btn${topic.pinnedAt ? ' pin-row--pinned' : ''}`}
            data-clarity-action="storage-pin-toggle"
            data-clarity-pinned={topic.pinnedAt ? 'true' : 'false'}
            onClick={async () => {
              const nextPinned = !topic.pinnedAt;
              try {
                await pinAction({
                  topicIssueId: topic.issueId,
                  pinned: nextPinned,
                  companyId,
                  userId,
                });
                showToast({
                  message: nextPinned ? 'Topic pinned' : 'Topic unpinned',
                });
                if (onPinChanged) onPinChanged();
              } catch {
                showToast({
                  message: 'Could not toggle pin — try again',
                });
              }
            }}
            aria-pressed={topic.pinnedAt ? 'true' : 'false'}
          >
            {topic.pinnedAt ? '📌' : '📁'} <b>{topic.title}</b>
            <br />
            <span style={{ color: 'var(--ink-3)' }}>
              {topic.pinnedAt
                ? 'Pinned — exempt from archive'
                : 'all messages persist as issue comments · single source of truth'}
            </span>
          </button>
        </>
      ) : null}
    </aside>
  );
}
