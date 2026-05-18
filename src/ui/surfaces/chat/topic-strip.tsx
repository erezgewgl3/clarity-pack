// src/ui/surfaces/chat/topic-strip.tsx
//
// Plan 04-05 Task 1 — CHAT-01 — the horizontal topic strip under the thread
// head. Lists open chat topics for the selected employee via the chat.topics
// worker handler (04-04); selecting a topic threads its issue id up to
// ChatPage, which feeds the message thread.
//
// The "+ New topic" button lives in the thread head (rendered by index.tsx)
// and calls chat.topic.create — not in this component.
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 139-157.
//
// All topic titles render as untrusted React text (T-04-18).

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

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
  const { data, loading } = usePluginData<TopicsResult>('chat.topics', {
    employeeAgentId,
    companyId,
    userId,
  });

  const topics: ChatTopic[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'topics'
      ? data.topics
      : [];

  // Auto-select the most-recent topic when none is active yet.
  React.useEffect(() => {
    if (!activeTopicIssueId && topics.length > 0) {
      onSelectTopic(topics[0]!);
    }
    // Only react to the topic list changing — onSelectTopic is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.map((t) => t.issueId).join(','), activeTopicIssueId]);

  return (
    <div className="topics" data-clarity-region="topic-strip">
      <span className="topic-lbl">Topics ·</span>
      {loading && topics.length === 0 ? (
        <span className="topics-empty">Loading topics…</span>
      ) : topics.length === 0 ? (
        <span className="topics-empty">No topics yet — start one with + New topic</span>
      ) : (
        topics.map((topic) => (
          <button
            type="button"
            key={topic.issueId}
            className={`topic${topic.issueId === activeTopicIssueId ? ' active' : ''}`}
            onClick={() => onSelectTopic(topic)}
            aria-pressed={topic.issueId === activeTopicIssueId}
          >
            <span className="dot" />
            {topic.title}
            <span className="id">{chtLabel(topic)}</span>
          </button>
        ))
      )}
    </div>
  );
}
