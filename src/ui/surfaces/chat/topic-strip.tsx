// src/ui/surfaces/chat/topic-strip.tsx
//
// Plan 04-05 Task 1 — CHAT-01 — the horizontal topic strip under the thread
// head. Lists open chat topics for the selected employee via the chat.topics
// worker handler (04-04); selecting a topic threads its issue id up to
// ChatPage, which feeds the message thread.
//
// Plan 04.1-06 Task 2 — Pattern E tail. Topics with `archived === true`
// (Plan 04.1-05 D-10) are hidden by default; an `<ArchivedTopicsPill>` at
// the right end of the strip surfaces a dropdown panel of the archived
// topics (Plan 04.1-08 — the panel replaces the original inline-reveal).
//
// Plan 04.1-08 — TopicStrip now accepts an optional `onOpenArchivePanel`
// callback from the parent (index.tsx). When provided, clicking the +N
// archived pill invokes that callback (which opens the ArchivePanel
// dropdown at the parent level). The legacy inline-reveal behavior is
// preserved as a fallback when no callback is wired.
//
// The host issue's status remains in_progress throughout — D-10 invariant
// pinned by the handler tests.
//
// The "+ New topic" button lives in the actions row (Plan 04.1-08; was the
// thread head pre-04.1-08) — index.tsx renders it.
//
// Visual contract: sketches/paperclip-fix-chat-true-task.html ll. 167-216.
//
// All topic titles render as untrusted React text (T-04-18).

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
  useHostNavigation,
} from '@paperclipai/plugin-sdk/ui/hooks';

import { ArchivedTopicsPill } from './archived-topics-pill.tsx';

/** A chat topic as chat.topics returns it. */
export type ChatTopic = {
  topicId: string;
  issueId: string;
  parentIssueId: string;
  employeeAgentId: string;
  title: string;
  lastActivityAt: string;
  archived: boolean;
  /** Plan 04.2-01 (RCB-05) — the source Paperclip issue this topic was
   *  started from via the Reader-view Continue-in-chat flow. NULL for topics
   *  created the ordinary way and every pre-0009 row. Optional so existing
   *  ChatTopic literals (deep-link minimal topics, archived-panel rows)
   *  compile unchanged. */
  originIssueId?: string | null;
  /** Plan 04.2-06 D10 — server-resolved BEAAA-NNN identifier for
   *  `originIssueId`. Used by the About-chip for BOTH the visible text AND
   *  the click-through URL (per runbook paperclip-issue-url-pattern). Null
   *  when the resolution degraded; the chip then hides rather than
   *  rendering a broken `/<prefix>/issues/<UUID>` link. Optional for the
   *  same compile-compat reason as `originIssueId`. */
  originIssueIdentifier?: string | null;
};

type TopicsResult =
  | { kind: 'topics'; employeeAgentId: string; topics: ChatTopic[] }
  | { error: string }
  | null;

/**
 * Derive the CHT-NN label from a topic. The worker exposes a topicId; if it
 * is already CHT-shaped use it verbatim, otherwise fall back to a short slug.
 */
export function chtLabel(topic: ChatTopic): string {
  const id = topic.topicId ?? '';
  if (/^CHT-\d+$/i.test(id)) return id.toUpperCase();
  if (/^\d+$/.test(id)) return `CHT-${id}`;
  return id ? id.slice(0, 8).toUpperCase() : 'CHT-—';
}

export function TopicStrip({
  companyId,
  userId,
  employeeAgentId,
  activeTopicIssueId,
  onSelectTopic,
  onOpenArchivePanel = null,
  archivePanelOpen = false,
}: {
  companyId: string;
  userId: string;
  employeeAgentId: string;
  activeTopicIssueId: string | null;
  onSelectTopic: (topic: ChatTopic) => void;
  /** Plan 04.1-08 — clicking the +N archived pill calls this callback (the
   *  parent opens the ArchivePanel dropdown). When null, falls back to the
   *  legacy inline-reveal behavior. */
  onOpenArchivePanel?: (() => void) | null;
  /** Plan 04.1-08 — drives the pill's `expanded` aria-pressed visual. */
  archivePanelOpen?: boolean;
}): React.ReactElement {
  const { data, loading, refresh } = usePluginData<TopicsResult>('chat.topics', {
    employeeAgentId,
    companyId,
    userId,
  });
  const archive = usePluginAction('chat.topic.archive');
  // Plan 04.2-01 (RCB-05) — the host navigation hook drives the About-issue
  // backlink chip. resolveHref() prepends the active company prefix so the
  // chip lands on /<prefix>/issues/<originIssueId>.
  const nav = useHostNavigation();

  const [showArchived, setShowArchived] = React.useState(false);
  // Plan 04.2-01 (RCB-05) — per-topic dismissal of the About-issue chip.
  // Keyed by the topic issue id so dismissing one topic's chip does not hide
  // another's; persisted in localStorage so it stays dismissed for the
  // session. The state mirror lets a dismiss re-render without a full fetch.
  const [aboutChipDismissed, setAboutChipDismissed] = React.useState<Set<string>>(
    () => new Set(),
  );
  // Track in-flight un-archive operations per issueId so the button can show
  // a transient busy state without re-rendering the whole strip.
  const [unarchiving, setUnarchiving] = React.useState<Set<string>>(new Set());

  const allTopics: ChatTopic[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'topics'
      ? data.topics
      : [];

  // Plan 04.1-06 Pattern E — hide archived topics by default; Plan 04.1-08
  // the +N pill now opens an ArchivePanel dropdown (parent owns the open
  // state). When the parent supplied an onOpenArchivePanel callback, we
  // skip the inline-reveal — the strip stays clean.
  const visible = React.useMemo(
    () => (showArchived && !onOpenArchivePanel
      ? allTopics
      : allTopics.filter((t) => !t.archived)),
    [allTopics, showArchived, onOpenArchivePanel],
  );
  const archivedCount = React.useMemo(
    () => allTopics.filter((t) => t.archived).length,
    [allTopics],
  );

  // Auto-select the most-recent NON-ARCHIVED topic when none is active yet.
  React.useEffect(() => {
    if (!activeTopicIssueId && visible.length > 0) {
      onSelectTopic(visible[0]!);
    }
    // Only react to the topic list changing — onSelectTopic is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((t) => t.issueId).join(','), activeTopicIssueId]);

  const handleUnarchive = React.useCallback(
    async (topic: ChatTopic) => {
      setUnarchiving((s) => {
        const next = new Set(s);
        next.add(topic.issueId);
        return next;
      });
      try {
        await archive({
          companyId,
          userId,
          topicIssueId: topic.issueId,
          archived: false,
        });
        // Refresh the topics list so the row drops back into the open set.
        void refresh?.();
      } finally {
        setUnarchiving((s) => {
          const next = new Set(s);
          next.delete(topic.issueId);
          return next;
        });
      }
    },
    [archive, companyId, userId, refresh],
  );

  // Plan 04.2-01 (RCB-05) — the active topic, resolved from the loaded list
  // so its origin_issue_id is in hand for the About-issue backlink chip.
  const activeTopic = React.useMemo(
    () => allTopics.find((t) => t.issueId === activeTopicIssueId) ?? null,
    [allTopics, activeTopicIssueId],
  );
  // Plan 04.2-06 D10 — the About-chip uses the SERVER-RESOLVED BEAAA-NNN
  // identifier for both the visible label AND the navigation target. Pre-D10
  // the chip rendered the raw originIssueId UUID (visible UUID leak) AND
  // navigated to `/<prefix>/issues/<UUID>` which 404s per runbook
  // paperclip-issue-url-pattern. When the server resolution degraded
  // (originIssueIdentifier === null), HIDE the chip entirely rather than
  // rendering a broken target. The legacy `originIssueId` UUID is intentionally
  // no longer consumed by this surface — keeping the type field around only
  // so existing minimal ChatTopic literals compile unchanged.
  const aboutIssueId =
    activeTopic &&
    typeof activeTopic.originIssueIdentifier === 'string' &&
    activeTopic.originIssueIdentifier
      ? activeTopic.originIssueIdentifier
      : null;
  // localStorage key — topic-scoped so each topic's chip dismissal is
  // independent. Read once per render; the Set mirror drives re-render.
  const aboutChipDismissKey = activeTopic
    ? `clarity-about-chip-dismissed:${activeTopic.issueId}`
    : null;
  const aboutChipIsDismissed =
    (activeTopic ? aboutChipDismissed.has(activeTopic.issueId) : false) ||
    (typeof window !== 'undefined' && aboutChipDismissKey
      ? window.localStorage.getItem(aboutChipDismissKey) === '1'
      : false);

  const handleDismissAboutChip = React.useCallback(() => {
    if (!activeTopic || !aboutChipDismissKey) return;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(aboutChipDismissKey, '1');
      }
    } catch {
      // localStorage may be unavailable (privacy mode) — the Set mirror below
      // still hides the chip for this session.
    }
    setAboutChipDismissed((s) => {
      const next = new Set(s);
      next.add(activeTopic.issueId);
      return next;
    });
  }, [activeTopic, aboutChipDismissKey]);

  return (
    <div className="topics" data-clarity-region="topic-strip">
      {/* Plan 04.2-01 (RCB-05) — the About-issue backlink chip. Rendered at
          the LEFT end ONLY when the active topic was started from a Reader
          (origin_issue_id set) AND the operator has not dismissed it this
          session. Click navigates to the source issue's Reader. The issue id
          renders as untrusted React text (T-04.2-01-03). */}
      {aboutIssueId && !aboutChipIsDismissed ? (
        <span className="topic-about-chip" data-clarity-region="about-issue-chip">
          <button
            type="button"
            className="topic-about-chip-link"
            title={`Open the source issue ${aboutIssueId}`}
            onClick={() => nav.navigate(nav.resolveHref(`/issues/${aboutIssueId}`))}
            data-clarity-action="about-issue-backlink"
          >
            About {aboutIssueId} ↗
          </button>
          <button
            type="button"
            className="topic-about-chip-dismiss"
            aria-label="Dismiss the about-issue chip"
            onClick={handleDismissAboutChip}
          >
            ×
          </button>
        </span>
      ) : null}
      <span className="topic-lbl">Topics ·</span>
      {loading && allTopics.length === 0 ? (
        <span className="topics-empty">Loading topics…</span>
      ) : visible.length === 0 && archivedCount === 0 ? (
        <span className="topics-empty">No topics yet — start one with + New topic</span>
      ) : (
        visible.map((topic) => {
          const isArchived = topic.archived;
          const isBusy = unarchiving.has(topic.issueId);
          return (
            <button
              type="button"
              key={topic.issueId}
              className={`topic${
                topic.issueId === activeTopicIssueId ? ' active' : ''
              }${isArchived ? ' archived-topic-row' : ''}`}
              onClick={() => {
                if (isArchived) {
                  // Clicking an archived row UN-ARCHIVES it (UI-SPEC §"+N
                  // archived pill" — "an inline `Unarchive` hover action").
                  if (!isBusy) void handleUnarchive(topic);
                } else {
                  onSelectTopic(topic);
                }
              }}
              aria-pressed={topic.issueId === activeTopicIssueId}
              // Plan 04.1-10 drill fix #2b — `title=` shows the full topic
              // title on hover when the .topic-title span truncates long
              // titles with ellipsis. Archived rows keep the "Click to
              // unarchive" hint.
              title={isArchived ? 'Click to unarchive' : topic.title}
              disabled={isBusy}
            >
              <span className="dot" />
              {/* Plan 04.1-10 — wrap the title in .topic-title so chat.css can
                  ellipsis-truncate long titles at max-width 220px (the strip
                  was pushing the whole chat shell past the viewport on long
                  titles like "Explain how paperclip.ai works…"). */}
              <span className="topic-title">{topic.title}</span>
              <span className="id">{chtLabel(topic)}</span>
              {isArchived ? (
                <span className="archived-topic-suffix">
                  {isBusy ? '…' : 'Unarchive'}
                </span>
              ) : null}
            </button>
          );
        })
      )}
      <ArchivedTopicsPill
        archivedCount={archivedCount}
        // Plan 04.1-08 — when the parent wired an onOpenArchivePanel, the
        // pill drives THAT (the dropdown panel opens). Otherwise legacy
        // inline-reveal behavior remains for older mount points.
        expanded={onOpenArchivePanel ? archivePanelOpen : showArchived}
        onToggle={() => {
          if (onOpenArchivePanel) {
            onOpenArchivePanel();
            return;
          }
          setShowArchived((s) => !s);
        }}
      />
    </div>
  );
}
