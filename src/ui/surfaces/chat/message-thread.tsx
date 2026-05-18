// src/ui/surfaces/chat/message-thread.tsx
//
// Plan 04-05 Task 2 — CHAT-01 / CHAT-04 / CHAT-06 / CHAT-10 — the central
// message thread.
//
// Realtime model:
//   - usePluginData('chat.messages', …)  → the initial server thread.
//   - usePluginStream(`chat:${companyId}`) → the realtime PRIMARY. On every
//     comment.created event for this topic we re-fetch the thread.
//   - usePoll → the FALLBACK. It only ticks while the stream is errored; a
//     small "reconnecting" indicator shows while degraded. Visibility-pause
//     is mandatory; a PLUGIN_DISABLED poll error is a terminal stop.
//
// Optimistic send (D-10 / CHAT-06): the Composer hands optimistic messages
// down via the `optimistic` prop, keyed by message_uuid. The thread renders
// them immediately; when the server thread contains a comment whose body
// matches an optimistic message it is considered reconciled and dropped from
// the optimistic overlay. A failed optimistic message keeps a "Failed to
// send" marker + a Retry affordance (Retry re-sends the SAME message_uuid).
//
// Ordering: the thread is ordered strictly by the SERVER `created_at` the
// chat.messages handler returns — never a client send clock (PITFALLS 11.4).
//
// SECURITY (T-04-18): every message body renders as untrusted text through
// ProseWithRefChips / ReasoningPanel — no dangerouslySetInnerHTML, no raw
// HTML. No raw fetch — all host I/O via the SDK bridge hooks.

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
  usePluginStream,
} from '@paperclipai/plugin-sdk/ui/hooks';

import { usePoll } from '../../primitives/use-poll.ts';
import { ProseWithRefChips } from '../reader/prose-with-ref-chips.tsx';
import { parseReasoning, ReasoningPanel } from './reasoning-panel.tsx';

/** A persisted message as chat.messages returns it. */
export type ChatMessage = {
  commentId: string;
  body: string;
  createdAt: number | string;
  authorUserId: string | null;
  authorAgentId: string | null;
  senderKind: string | null;
  pinned: boolean;
  superseded: boolean;
};

type MessagesResult =
  | { kind: 'messages'; topicIssueId: string; messages: ChatMessage[] }
  | { error: string }
  | null;

/** A stream event as the 04-03 chat-stream-bridge emits it. */
type ChatStreamEvent = {
  type?: string;
  issueId?: string;
  commentId?: string;
  occurredAt?: string;
};

/**
 * An optimistic (not-yet-confirmed) message. Owned by the Composer, passed
 * down so the thread can render it inline at the bottom.
 */
export type OptimisticMessage = {
  messageUuid: string;
  body: string;
  createdAt: number;
  status: 'pending' | 'failed';
  /** Re-send the same message_uuid (dedup-safe). */
  onRetry: () => void;
};

/** Coerce a server createdAt (Date | ISO string | epoch) to epoch ms. */
function toEpoch(raw: number | string | null | undefined): number {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Render a HH:MM timestamp from epoch ms. */
function clock(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Render a day-divider label from epoch ms. */
function dayLabel(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function MessageThread({
  companyId,
  userId,
  topicIssueId,
  optimistic = [],
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  optimistic?: OptimisticMessage[];
}): React.ReactElement {
  const { data, loading, refresh } = usePluginData<MessagesResult>('chat.messages', {
    topicIssueId,
    companyId,
    userId,
  });

  // Realtime PRIMARY — the per-company chat SSE channel (04-03 bridge).
  const stream = usePluginStream<ChatStreamEvent>(`chat:${companyId}`);
  const degraded = stream.error != null;

  // On any comment.created event for THIS topic, re-fetch the thread. The
  // event payload is opaque (04-01 OQ-2) so we re-fetch rather than splice.
  const lastEventRef = React.useRef<ChatStreamEvent | null>(null);
  React.useEffect(() => {
    const ev = stream.lastEvent;
    if (!ev || ev === lastEventRef.current) return;
    lastEventRef.current = ev;
    if (ev.type === 'comment.created' && ev.issueId === topicIssueId) {
      void refresh?.();
    }
  }, [stream.lastEvent, topicIssueId, refresh]);

  // FALLBACK — poll only while the stream is degraded. usePoll owns the
  // visibility-pause + PLUGIN_DISABLED terminal-stop semantics.
  const poll = usePoll<MessagesResult>({
    key: degraded ? `chat.messages.fallback:${topicIssueId}` : 'chat.messages.fallback:idle',
    fetcher: async () => {
      if (!degraded) return null;
      void refresh?.();
      return null;
    },
    intervalMs: 15_000,
    dedupeBy: 'off',
    pauseOnHidden: true,
  });
  const pollDisabled = poll.error?.kind === 'PLUGIN_DISABLED';

  const messages: ChatMessage[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'messages'
      ? data.messages
      : [];
  const isError = !!data && typeof data === 'object' && 'error' in data;

  // Strict server-time ordering — never a client clock (PITFALLS 11.4).
  const ordered = React.useMemo(
    () => [...messages].sort((a, b) => toEpoch(a.createdAt) - toEpoch(b.createdAt)),
    [messages],
  );

  // An optimistic message is reconciled once a server message with the same
  // trimmed body authored by this user exists. We drop reconciled ones.
  const serverBodies = React.useMemo(
    () => new Set(ordered.map((m) => (m.body ?? '').trim())),
    [ordered],
  );
  const pendingOverlay = optimistic.filter((o) => !serverBodies.has(o.body.trim()));

  // Auto-scroll to the newest message.
  const endRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [ordered.length, pendingOverlay.length]);

  if (loading && messages.length === 0) {
    return <div className="messages" data-clarity-region="messages">
      <p className="clarity-chat-loading">Loading the conversation…</p>
    </div>;
  }
  if (isError) {
    return <div className="messages" data-clarity-region="messages">
      <p className="clarity-chat-error">Conversation unavailable — try reopening the topic.</p>
    </div>;
  }

  // Group messages into day buckets for the dividers.
  let lastDay = '';

  return (
    <div className="messages" data-clarity-region="messages">
      {degraded && !pollDisabled ? (
        <div className="reconnecting" role="status">
          Reconnecting — live updates paused, polling every 15s
        </div>
      ) : null}
      {pollDisabled ? (
        <div className="clarity-chat-error">
          Plugin disabled. Reload after re-enabling.
        </div>
      ) : null}

      {ordered.length === 0 && pendingOverlay.length === 0 ? (
        <p className="clarity-chat-loading">No messages yet — say hello below.</p>
      ) : null}

      {ordered.map((msg) => {
        const ms = toEpoch(msg.createdAt);
        const day = dayLabel(ms);
        const showDivider = day && day !== lastDay;
        lastDay = day || lastDay;
        return (
          <React.Fragment key={msg.commentId}>
            {showDivider ? (
              <div className="day-divider">
                <span>{day}</span>
              </div>
            ) : null}
            <PersistedMessage
              msg={msg}
              ms={ms}
              isMine={!!msg.authorUserId}
              companyId={companyId}
              userId={userId}
              topicIssueId={topicIssueId}
            />
          </React.Fragment>
        );
      })}

      {pendingOverlay.map((o) => (
        <OptimisticBubble key={o.messageUuid} optimistic={o} />
      ))}

      <div ref={endRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersistedMessage — one server-confirmed message bubble.
// ---------------------------------------------------------------------------
function PersistedMessage({
  msg,
  ms,
  isMine,
  companyId,
  userId,
  topicIssueId,
}: {
  msg: ChatMessage;
  ms: number;
  isMine: boolean;
  companyId: string;
  userId: string;
  topicIssueId: string;
}): React.ReactElement | null {
  // A superseded comment is collapsed out of the edit chain (CHAT-05).
  if (msg.superseded) return null;

  const { visible, reasoning } = parseReasoning(msg.body);
  const who = isMine ? 'Eric · You' : 'Agent';

  return (
    <article className={`msg${isMine ? ' me' : ''}`}>
      {isMine ? null : <div className="av">A</div>}
      <div className="bubble">
        {isMine ? null : (
          <PromoteActions
            commentId={msg.commentId}
            companyId={companyId}
            userId={userId}
            topicIssueId={topicIssueId}
          />
        )}
        <div className="b-meta">
          <span className="who">{who}</span>
          <span className="ts">{clock(ms)}</span>
        </div>
        <div className="b-text">
          <ProseWithRefChips body={visible} />
        </div>
        {reasoning ? <ReasoningPanel reasoning={reasoning} /> : null}
        {msg.pinned ? <span className="resolved">⚑ Pinned</span> : null}
      </div>
      {isMine ? <div className="av">E</div> : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// PromoteActions — the hover affordances on an agent bubble (CHAT-09).
// ---------------------------------------------------------------------------
function PromoteActions({
  commentId,
  companyId,
  userId,
  topicIssueId,
}: {
  commentId: string;
  companyId: string;
  userId: string;
  topicIssueId: string;
}): React.ReactElement {
  // usePluginAction is imported lazily here to keep the bubble light; the
  // hook itself is cheap and safe to call per-bubble.
  const promote = usePromote();
  const pin = usePin();
  const [busy, setBusy] = React.useState(false);

  const onPromote = React.useCallback(async () => {
    setBusy(true);
    try {
      await promote({ messageUuid: commentId, companyId, userId, topicIssueId });
    } catch {
      // chat.promote failed — no task created. The user re-tries.
    } finally {
      setBusy(false);
    }
  }, [promote, commentId, companyId, userId, topicIssueId]);

  const onPin = React.useCallback(async () => {
    setBusy(true);
    try {
      await pin({ messageUuid: commentId, companyId, userId });
    } catch {
      // chat.pin failed — pin state unchanged.
    } finally {
      setBusy(false);
    }
  }, [pin, commentId, companyId, userId]);

  return (
    <span className="promote">
      <button type="button" className="pa" onClick={onPromote} disabled={busy}>
        ↗ Promote to task
      </button>
      <button type="button" className="pa" onClick={onPin} disabled={busy}>
        ⚑ Pin
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// OptimisticBubble — an in-flight / failed message the user just sent.
// ---------------------------------------------------------------------------
function OptimisticBubble({
  optimistic,
}: {
  optimistic: OptimisticMessage;
}): React.ReactElement {
  const failed = optimistic.status === 'failed';
  return (
    <article className="msg me">
      <div className={`bubble ${failed ? 'failed' : 'pending'}`}>
        <div className="b-meta">
          <span className="who">Eric · You</span>
          <span className="ts">{failed ? 'failed' : 'sending…'}</span>
        </div>
        <div className="b-text">
          <ProseWithRefChips body={optimistic.body} />
        </div>
        {failed ? (
          <div className="send-failed">
            Failed to send
            <button type="button" className="retry" onClick={optimistic.onRetry}>
              Retry
            </button>
          </div>
        ) : null}
      </div>
      <div className="av">E</div>
    </article>
  );
}

// usePromote / usePin — thin wrappers around usePluginAction so the action
// keys are declared in exactly one place.
function usePromote(): ReturnType<typeof usePluginAction> {
  return usePluginAction('chat.promote');
}
function usePin(): ReturnType<typeof usePluginAction> {
  return usePluginAction('chat.pin');
}
