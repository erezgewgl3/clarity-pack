// src/ui/surfaces/chat/message-thread.tsx
//
// Plan 04-05 Task 2 — CHAT-01 / CHAT-04 / CHAT-06 / CHAT-10 — the central
// message thread.
//
// Realtime model:
//   - usePluginData('chat.messages', …)  → the initial server thread.
//   - usePoll → the always-on PRIMARY refresh. It ticks every 15s and re-fetches
//     the thread; a single calm, STATIC "● Live" indicator marks that the thread
//     auto-updates. There is deliberately NO visible countdown number — a
//     perpetually-looping ticker read as a stuck spinner and drew repeated UX
//     complaints. The 15s poll continues silently underneath. Visibility-pause
//     is mandatory; a PLUGIN_DISABLED poll error is a terminal stop.
//   - usePluginStream(`chat:${companyId}`) → a DORMANT best-effort bonus. If the
//     host ever delivers a comment.created event we still refresh — but the
//     stream is OPTIONAL: stream.error drives NO alarming UI. See the
//     STREAMS_AVAILABLE NO-PATH comment near the usePluginStream call.
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
  // 'pending'  — the chat.send round-trip is in flight ("sending…").
  // 'sent'     — chat.send returned ok; the bubble shows "✓ sent" until the
  //              reconciled server comment arrives on the next poll (GAP 9).
  // 'failed'   — chat.send failed; the bubble keeps a Retry affordance.
  status: 'pending' | 'sent' | 'failed';
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

  // STREAMS_AVAILABLE — host NO-PATH. The live Countermoves re-drill confirmed
  // the Paperclip host returns HTTP 501 (Not Implemented) for the plugin-streams
  // endpoint (`/api/plugins/<plugin-id>`) — `usePluginStream` / `ctx.streams`
  // has no path on this host. This is NOT a plugin bug and NOT a channel-naming
  // bug. Polling is the v1 realtime reality (see usePoll below). The
  // usePluginStream call is kept as a DORMANT best-effort: if a future host
  // implements plugin streams, comment.created events will resume driving
  // refresh() with no further change. `stream.error` must NEVER drive alarming
  // UI — the stream is optional/bonus. Mirrors composer.tsx's ATTACHMENTS_
  // AVAILABLE NO-PATH switch — this comment is the known re-enable point.
  const stream = usePluginStream<ChatStreamEvent>(`chat:${companyId}`);

  // DORMANT bonus — on any comment.created event for THIS topic, re-fetch the
  // thread. On the current host the stream never delivers (501), so this
  // effect is inert; it is a no-cost re-enable seam for a future host.
  const lastEventRef = React.useRef<ChatStreamEvent | null>(null);
  React.useEffect(() => {
    const ev = stream.lastEvent;
    if (!ev || ev === lastEventRef.current) return;
    lastEventRef.current = ev;
    if (ev.type === 'comment.created' && ev.issueId === topicIssueId) {
      void refresh?.();
    }
  }, [stream.lastEvent, topicIssueId, refresh]);

  // PRIMARY refresh — always-on 15s poll. usePluginData does the initial fetch;
  // this poll drives every ongoing refresh. usePoll owns the visibility-pause +
  // PLUGIN_DISABLED terminal-stop semantics. This is the calm steady-state, not
  // a degraded fallback.
  const REFRESH_INTERVAL_MS = 15_000;
  const poll = usePoll<MessagesResult>({
    key: `chat.messages.refresh:${topicIssueId}`,
    fetcher: async () => {
      void refresh?.();
      return null;
    },
    intervalMs: REFRESH_INTERVAL_MS,
    dedupeBy: 'off',
    pauseOnHidden: true,
  });
  const pollDisabled = poll.error?.kind === 'PLUGIN_DISABLED';

  // GAP 8 — the auto-refresh indicator is a single STATIC label, not a ticker.
  //
  // Earlier builds rendered a live "Auto-refreshing · next in Ns" countdown
  // that decremented 15→0 and WRAPPED back to 15, looping forever. Operators
  // read the perpetual loop as a stuck spinner and it drew UX complaints three
  // times. The countdown number, its state, and its 1s interval are removed
  // entirely. The 15s poll above is unchanged — it just runs silently. The
  // visible indicator is now a calm, motionless "● Live" badge (role="status").

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
      {!pollDisabled ? (
        <div className="auto-refresh" role="status">
          Live
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
              // GAP 10 — sender identity comes from sender_kind, NOT
              // authorUserId. PITFALL #3: ctx.issues.createComment posts the
              // comment as the plugin WORKER, so an operator-sent message comes
              // back from listComments with an EMPTY authorUserId — the old
              // `!!msg.authorUserId` test rendered every operator message as
              // "Agent". The chat_messages side table stamps sender_kind='user'
              // on every operator send; an agent reply has no row (senderKind
              // null) and correctly stays "Agent".
              isMine={msg.senderKind === 'user'}
              companyId={companyId}
              userId={userId}
              topicIssueId={topicIssueId}
              onRefresh={refresh}
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
  onRefresh,
}: {
  msg: ChatMessage;
  ms: number;
  isMine: boolean;
  companyId: string;
  userId: string;
  topicIssueId: string;
  /** Re-fetch the thread — used so a pin's persisted ⚑ marker appears. */
  onRefresh?: () => void;
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
            pinned={msg.pinned}
            onRefresh={onRefresh}
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
//
// GAP 12 — host-contract audit fix. Promote and Pin sit on AGENT messages.
//   - WIRE: both actions now pass `commentId` + `topicIssueId` (the exact keys
//     the reworked chat.promote / chat.pin handlers consume). The old code
//     passed `messageUuid: commentId` — a comment id under a message_uuid key —
//     so the handlers' chat_messages lookup never resolved an agent comment.
//   - CONFIRMATION UX: the old onPromote/onPin swallowed BOTH success and
//     failure in an empty catch. Now Promote shows "✓ Task created" (with the
//     new issue id) on { ok } and a visible error on { error }; Pin flips an
//     optimistic "⚑ Pinned" marker and triggers a thread refresh so the
//     persisted marker lands, and surfaces a visible error on { error }.
// ---------------------------------------------------------------------------
function PromoteActions({
  commentId,
  companyId,
  userId,
  topicIssueId,
  pinned,
  onRefresh,
}: {
  commentId: string;
  companyId: string;
  userId: string;
  topicIssueId: string;
  pinned: boolean;
  onRefresh?: () => void;
}): React.ReactElement {
  // usePluginAction is imported lazily here to keep the bubble light; the
  // hook itself is cheap and safe to call per-bubble.
  const promote = usePromote();
  const pin = usePin();
  const [busy, setBusy] = React.useState(false);
  // Visible feedback — replaces the old silent empty-catch (GAP 12).
  const [feedback, setFeedback] = React.useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);
  const [optimisticPinned, setOptimisticPinned] = React.useState(false);

  /** A worker { error: ... } result — actions RETURN errors, they rarely throw. */
  function resultError(result: unknown): string | null {
    if (result && typeof result === 'object' && 'error' in result) {
      return String((result as { error: unknown }).error);
    }
    return null;
  }

  const onPromote = React.useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await promote({ commentId, topicIssueId, companyId, userId });
      const err = resultError(result);
      if (err) {
        setFeedback({ kind: 'error', text: `Could not promote (${err})` });
      } else {
        const issueId =
          result && typeof result === 'object' && 'issueId' in result
            ? String((result as { issueId: unknown }).issueId)
            : null;
        setFeedback({
          kind: 'ok',
          text: issueId ? `✓ Task created · ${issueId}` : '✓ Task created',
        });
      }
    } catch {
      // A genuine transport-level throw (rare — the handler returns errors).
      setFeedback({ kind: 'error', text: 'Could not promote (CREATE_FAILED)' });
    } finally {
      setBusy(false);
    }
  }, [promote, commentId, topicIssueId, companyId, userId]);

  const onPin = React.useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await pin({
        commentId,
        topicIssueId,
        companyId,
        userId,
        pinned: !(pinned || optimisticPinned),
      });
      const err = resultError(result);
      if (err) {
        setFeedback({ kind: 'error', text: `Could not pin (${err})` });
      } else {
        // Optimistic marker now; the thread refresh below makes the persisted
        // ⚑ Pinned marker on the bubble itself appear.
        setOptimisticPinned(true);
        setFeedback({ kind: 'ok', text: '⚑ Pinned' });
        onRefresh?.();
      }
    } catch {
      setFeedback({ kind: 'error', text: 'Could not pin (PIN_FAILED)' });
    } finally {
      setBusy(false);
    }
  }, [pin, commentId, topicIssueId, companyId, userId, pinned, optimisticPinned, onRefresh]);

  return (
    <span className={`promote${feedback ? ' has-feedback' : ''}`}>
      <button type="button" className="pa" onClick={onPromote} disabled={busy}>
        ↗ Promote to task
      </button>
      <button type="button" className="pa" onClick={onPin} disabled={busy}>
        ⚑ Pin
      </button>
      {feedback ? (
        <span
          className={`pa-feedback ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </span>
      ) : null}
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
  const sent = optimistic.status === 'sent';
  // GAP 9 — a successful chat.send flips the bubble to 'sent' so Eric gets
  // immediate confirmation. The bubble still drops on the next 15s poll once
  // the reconciled server comment arrives; 'sent' fills the gap until then.
  const bubbleClass = failed ? 'failed' : sent ? 'sent' : 'pending';
  const tsLabel = failed ? 'failed' : sent ? '✓ sent' : 'sending…';
  return (
    <article className="msg me">
      <div className={`bubble ${bubbleClass}`}>
        <div className="b-meta">
          <span className="who">Eric · You</span>
          <span className="ts">{tsLabel}</span>
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
        {sent ? <div className="send-confirmed">✓ Sent</div> : null}
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
