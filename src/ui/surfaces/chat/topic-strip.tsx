// src/ui/surfaces/chat/topic-strip.tsx
//
// Plan 04-05 Task 1 — CHAT-01 — the horizontal topic strip under the thread
// head. Lists open chat topics for the selected employee via the chat.topics
// worker handler (04-04); selecting a topic threads its issue id up to
// ChatPage, which feeds the message thread.
//
// Plan 04.1-06 Task 2 — Pattern E tail. Topics with `archived === true`
// (Plan 04.1-05 D-10) are hidden by default; an `<ArchivedTopicsPill>`
// at the right end of the strip toggles them back in at opacity 0.6 with
// an inline Unarchive hover-action (re-fires chat.topic.archive with
// archived:false). The host issue's status remains in_progress
// throughout — D-10 invariant pinned by the handler tests.
//
// The "+ New topic" button lives in the thread head (rendered by index.tsx)
// and calls chat.topic.create — not in this component.
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 139-157.
//
// All topic titles render as untrusted React text (T-04-18).

import * as React from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

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
}: {
  companyId: string;
  userId: string;
  employeeAgentId: string;
  activeTopicIssueId: string | null;
  onSelectTopic: (topic: ChatTopic) => void;
}): React.ReactElement {
  const { data, loading, refresh } = usePluginData<TopicsResult>('chat.topics', {
    employeeAgentId,
    companyId,
    userId,
  });
  const archive = usePluginAction('chat.topic.archive');

  const [showArchived, setShowArchived] = React.useState(false);
  // Track in-flight un-archive operations per issueId so the button can show
  // a transient busy state without re-rendering the whole strip.
  const [unarchiving, setUnarchiving] = React.useState<Set<string>>(new Set());

  const allTopics: ChatTopic[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'topics'
      ? data.topics
      : [];

  // Plan 04.1-06 Pattern E — hide archived topics by default; the pill at
  // the right end exposes them on-demand.
  const visible = React.useMemo(
    () => (showArchived ? allTopics : allTopics.filter((t) => !t.archived)),
    [allTopics, showArchived],
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

  return (
    <div className="topics" data-clarity-region="topic-strip">
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
              title={isArchived ? 'Click to unarchive' : undefined}
              disabled={isBusy}
            >
              <span className="dot" />
              {topic.title}
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
        expanded={showArchived}
        onToggle={() => setShowArchived((s) => !s)}
      />
    </div>
  );
}
