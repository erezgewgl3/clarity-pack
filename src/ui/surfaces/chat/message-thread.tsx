// src/ui/surfaces/chat/message-thread.tsx
//
// Plan 04-05 Task 2 — CHAT-01 / CHAT-04 / CHAT-06 / CHAT-10 — the central
// message thread.
//
// Realtime model:
//   - usePluginData('chat.messages', …)  → the initial server thread.
//   - usePoll → the always-on PRIMARY refresh. It ticks every 15s and re-fetches
//     the thread; a single calm "Live" indicator marks that the thread
//     auto-updates. The lone dot is the CSS `.auto-refresh::before` pseudo-
//     element — the pulsing, state-colored dot — NOT a glyph in the label
//     string. There is deliberately NO visible countdown number — a
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

import { deriveLiveness, usePoll, type LivenessState } from '../../primitives/use-poll.ts';
import { ProseWithRefChips } from '../reader/prose-with-ref-chips.tsx';
import { parseReasoning, ReasoningPanel } from './reasoning-panel.tsx';
// Plan 04.1-06 — Patterns C, F (RuntimeNoiseRow inline), G.
import { InlineTaskCard } from './true-task/inline-task-card.tsx';
import type { ChatActiveTask } from './active-tasks-owned.tsx';
import { HostStuckBanner } from './host-stuck-banner.tsx';
// Plan 04.1-08 — sticky read-only banner shown when the active topic is
// archived (the operator opened it from the archive panel).
import { ArchivedBanner } from './archived-banner.tsx';

/**
 * Plan 04.1-08 — when the operator clicks "→ Promote to task" on an agent
 * reply bubble, the parent (index.tsx) opens the dialog in PROMOTE mode.
 * The source message is threaded up via this callback shape. The old
 * inline chat.promote call (Plan 04.1-06) is REPLACED by this hand-off so
 * the operator gets the full dual-mode dialog (title pre-fill, topic
 * dropdown, etc.).
 */
export type PromoteSourceMessagePayload = {
  body: string;
  commentId: string;
  employeeName: string;
  occurredAt: string | null;
};

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
  // Plan 04.1-06 D-16 diagnostics view — Wave 1 spike captured a structured
  // presentation envelope on system-classified comments. When the chat.messages
  // handler is passed includeDiagnostics:true (Plan 04.1-04), runtime-noise
  // comments are kept in the messages array; the UI distinguishes them via
  // authorType/presentation and renders them as `.runtime-noise-comment`
  // blocks instead of bubbles.
  authorType?: string | null;
  presentation?: {
    kind?: string | null;
    title?: string | null;
    tone?: string | null;
  } | null;
  metadata?: {
    version?: number;
    sections?: Array<{
      title?: string;
      rows?: Array<Record<string, unknown>>;
    }>;
  } | null;
};

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
  assigneeAgentId,
  employeeName,
  employeeRole = null,
  diagnostics = false,
  activeTasks = [],
  pendingTaskCard = null,
  onPendingResolved = null,
  onPromoteMessage = null,
  archivedBanner = null,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  optimistic?: OptimisticMessage[];
  // Plan 04.1-06 — D-04 Promote upgrade requires the new chat.promote params
  // assigneeAgentId + employeeName (Plan 04.1-02). Threaded from index.tsx
  // via Composer.
  assigneeAgentId?: string;
  employeeName?: string;
  employeeRole?: string | null;
  // Plan 04.1-06 D-16 — when true, includeDiagnostics:true is sent to the
  // chat.messages handler and runtime-noise comments render inline as
  // `.runtime-noise-comment` blocks.
  diagnostics?: boolean;
  /** Plan 04.1-09 — chat.taskOwned data threaded from index.tsx so the
   *  marker-comment branch can look up real titles by issueId (NOT parse
   *  the title from the marker body — Plan 04.1-08 drill fix #2b: the
   *  marker's first capture is the issueId, not the title). Default `[]`
   *  keeps backwards compatibility for legacy mount points. */
  activeTasks?: ChatActiveTask[];
  /** Optimistic InlineTaskCard rendered until chat.taskOwned catches up. */
  pendingTaskCard?: { issueId: string; title: string } | null;
  /** Plan 04.1-10 — fired when the chat.messages poll surfaces a marker
   *  comment whose issueId matches the optimistic pendingTaskCard. The
   *  parent (index.tsx) clears its pending state so the activeTasks render
   *  path takes over — no double card render. Fires AT MOST once per
   *  matching marker (the parent's clear races but the firing is bounded
   *  by the messages list iteration on the next poll). */
  onPendingResolved?: ((issueId: string) => void) | null;
  /** Plan 04.1-08 — opens the dual-mode dialog in PROMOTE mode at index.tsx.
   *  When null, the PromoteActions falls back to its in-place chat.promote
   *  fire-and-forget (used by older mount points). */
  onPromoteMessage?: ((src: PromoteSourceMessagePayload) => void) | null;
  /** Plan 04.1-08 — when set, renders the sticky read-only ArchivedBanner
   *  at the top of `.messages`. Caller computes message/task counts. */
  archivedBanner?: {
    topicTitle: string;
    messageCount: number;
    tasksSpawned: number;
    lastActiveAt: string | null;
    onUnarchive: () => void;
  } | null;
}): React.ReactElement {
  const { data, loading, refresh } = usePluginData<MessagesResult>('chat.messages', {
    topicIssueId,
    companyId,
    userId,
    // D-16 toggle — OFF by default; the handler returns the unfiltered list
    // when this flips true.
    includeDiagnostics: diagnostics,
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

  // GAP 8 (0.7.7 rework) — the live indicator is now PULSING, STICKY, and
  // TRUTHFUL. Three earlier-flagged problems with the static "Live" label:
  //   (1) it never pulsed — no glanceable sign anything was alive;
  //   (2) it rendered inline at the top of the scrolling .messages container,
  //       so it scrolled out of view in a multi-turn chat;
  //   (3) it was a hardcoded string — it claimed "Live" even after polling
  //       had silently died.
  // The fix: derive a REAL liveness state from the poll's genuine signals
  // (poll.error + poll.lastSuccessAt — the 0.7.7 usePoll addition: the epoch
  // ms of the most recent SUCCESSFUL refresh). deriveLiveness() in use-poll.ts
  // turns those into 'healthy' | 'stalled' | 'disabled'. The single dot is the
  // CSS `.auto-refresh::before` pseudo-element — it pulses and carries the
  // per-state color; the label strings carry NO glyph. The dot pulses ONLY
  // when healthy; a stalled poll (a transient error, or no successful refresh
  // within 2x the 15s interval — i.e. the timer silently died) shows a
  // non-pulsing amber "Updates delayed"; a terminal PLUGIN_DISABLED shows
  // "Updates stopped". The 15s poll cadence, the usePluginStream dormant
  // handling, and the PLUGIN_DISABLED terminal-stop are all UNCHANGED — only
  // the indicator is reworked.
  //
  // Liveness is time-dependent: a poll whose timer silently died emits no
  // further state change, so a render driven only by poll events would never
  // notice the stall. A self-rescheduling setTimeout (NOT a fast setInterval
  // ticker — it re-evaluates once per poll interval, the calm cadence) nudges
  // a re-render so deriveLiveness re-runs against a fresh clock and a dead
  // timer is caught. No countdown number, no decrement, no wrap.
  const [livenessTick, setLivenessTick] = React.useState(0);
  React.useEffect(() => {
    if (pollDisabled) return; // terminal — nothing left to re-evaluate
    let handle: ReturnType<typeof setTimeout>;
    const reschedule = (): void => {
      handle = setTimeout(() => {
        setLivenessTick((n) => n + 1);
        reschedule();
      }, REFRESH_INTERVAL_MS);
    };
    reschedule();
    return () => clearTimeout(handle);
  }, [pollDisabled]);

  const liveness: LivenessState = React.useMemo(
    () =>
      deriveLiveness({
        error: poll.error,
        lastSuccessAt: poll.lastSuccessAt,
        intervalMs: REFRESH_INTERVAL_MS,
        now: Date.now(),
      }),
    // livenessTick is an intentional dependency — it forces a re-derivation
    // against a fresh Date.now() so a silently-dead poll timer flips the
    // indicator to 'stalled' even though no poll event fired.
    [poll.error, poll.lastSuccessAt, livenessTick],
  );

  // The honest indicator label + status text per derived state. The amber /
  // green styling is carried by the data-liveness attribute (see chat.css);
  // role="status" text must speak the SAME truth a sighted operator sees. The
  // map is keyed on every LivenessState so a healthy poll is the ONLY state
  // that ever shows the word "Live".
  const INDICATOR_BY_STATE: Record<LivenessState, { label: string; statusText: string }> = {
    healthy: { label: 'Live', statusText: 'Live — updates are refreshing.' },
    stalled: {
      label: 'Updates delayed',
      statusText: 'Updates delayed — reconnecting.',
    },
    disabled: {
      label: 'Updates stopped',
      statusText: 'Updates stopped — the plugin is disabled.',
    },
  };
  const indicator = INDICATOR_BY_STATE[liveness];

  const messages: ChatMessage[] =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'messages'
      ? data.messages
      : [];
  const isError = !!data && typeof data === 'object' && 'error' in data;
  // Plan 04.1-06 D-13 — host-stuck signal (Plan 04.1-04 response shape).
  const topicStuck =
    !!data &&
    typeof data === 'object' &&
    'kind' in data &&
    data.kind === 'messages' &&
    data.topicStuck === true;
  const recoveryOwner =
    data && typeof data === 'object' && 'kind' in data && data.kind === 'messages'
      ? (data.recoveryOwner ?? null)
      : null;

  // Strict server-time ordering — never a client clock (PITFALLS 11.4).
  const ordered = React.useMemo(
    () => [...messages].sort((a, b) => toEpoch(a.createdAt) - toEpoch(b.createdAt)),
    [messages],
  );

  // Plan 04.1-10 drill fix #1 — clear-on-marker-arrival. When chat.messages
  // surfaces a marker comment whose first capture (the issueId) matches the
  // optimistic pendingTaskCard.issueId, fire onPendingResolved so the parent
  // (index.tsx) clears its pending state. The activeTasks-sourced render
  // path then owns the InlineTaskCard with no double-render race. We scan
  // the ordered list each poll; the firing is idempotent on the parent
  // side (the parent's setPendingTaskCard guards by issueId match).
  React.useEffect(() => {
    if (!pendingTaskCard || !onPendingResolved) return;
    const pendingId = pendingTaskCard.issueId;
    const matched = ordered.some((m) => {
      const match = /^Task created — ([^,]+), assigned to .+\.$/.exec(
        (m.body ?? '').trim(),
      );
      return match?.[1] === pendingId;
    });
    if (matched) onPendingResolved(pendingId);
  }, [ordered, pendingTaskCard, onPendingResolved]);

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
      {/* GAP 8 (0.7.7) — the live indicator is `position: sticky` pinned to the
          top of the .messages scroll container (see chat.css) so it stays
          visible no matter how far down a multi-turn conversation the operator
          has scrolled. It is a thin strip; it pulses ONLY when healthy; its
          label + role="status" text reflect the REAL derived poll state. */}
      <div
        className="auto-refresh"
        role="status"
        data-liveness={liveness}
      >
        <span aria-hidden="true">{indicator.label}</span>
        <span className="sr-only">{indicator.statusText}</span>
      </div>
      {/* Plan 04.1-08 — sticky archived banner shown when the active topic
          is archived (operator opened it via the archive panel). Rendered
          BEFORE host-stuck so a stuck-AND-archived topic shows both. */}
      {archivedBanner ? (
        <ArchivedBanner
          topicTitle={archivedBanner.topicTitle}
          messageCount={archivedBanner.messageCount}
          tasksSpawned={archivedBanner.tasksSpawned}
          lastActiveAt={archivedBanner.lastActiveAt}
          onUnarchive={archivedBanner.onUnarchive}
        />
      ) : null}
      {/* Plan 04.1-06 Pattern G — Host-stuck banner rendered BELOW the
          live indicator (CSS makes it sticky) when chat.messages returns
          topicStuck:true. Silently unmounts on the next poll where
          topicStuck flips back to false. */}
      {topicStuck ? (
        <HostStuckBanner topicIssueId={topicIssueId} recoveryOwner={recoveryOwner} />
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

        // Plan 04.1-06 Pattern C — D-07 marker comment intercepted and
        // rendered as an inline task card. The marker prefix is locked by
        // src/worker/chat/true-task.ts (`Task created — <issueId>, assigned
        // to <name>.`). Plan 04.1-04's classifyComment treats the marker as
        // conversational so it always lands in the messages array, never
        // filtered as runtime noise (Pitfall 4 anti-regression).
        //
        // Plan 04.1-09 — the FIRST capture is the issueId, NOT the title.
        // The Plan 04.1-06 build used it as the title which rendered the
        // raw UUID in the card (operator drill 2026-05-20). The title is
        // now looked up from chat.taskOwned (`activeTasks`) by issueId.
        // Precedence: activeTasks hit > pendingTaskCard match > null
        // (renders skeleton — race window of up to 15s).
        const markerMatch = /^Task created — ([^,]+), assigned to (.+)\.$/.exec(
          (msg.body ?? '').trim(),
        );
        if (markerMatch) {
          const parsedIssueId = markerMatch[1] ?? null;
          const parsedAssignee = markerMatch[2] ?? employeeName ?? 'employee';
          // Look up the real title from chat.taskOwned (threaded down from
          // index.tsx via Composer).
          const matchedTask = parsedIssueId
            ? activeTasks.find((t) => t.issueId === parsedIssueId)
            : null;
          const resolvedTitle: string | null =
            matchedTask?.title ??
            (pendingTaskCard?.issueId === parsedIssueId
              ? pendingTaskCard.title
              : null);
          return (
            <React.Fragment key={msg.commentId}>
              {showDivider ? (
                <div className="day-divider">
                  <span>{day}</span>
                </div>
              ) : null}
              <InlineTaskCard
                identifier={matchedTask?.identifier ?? null}
                issueId={parsedIssueId}
                title={resolvedTitle}
                employeeName={parsedAssignee}
                role={employeeRole}
                status={matchedTask?.status ?? null}
                createdAt={
                  typeof msg.createdAt === 'string'
                    ? msg.createdAt
                    : new Date(ms).toISOString()
                }
              />
            </React.Fragment>
          );
        }

        // Plan 04.1-06 D-16 — runtime-noise comments rendered as
        // `.runtime-noise-comment` blocks (NOT bubbles). The handler only
        // returns them when diagnostics:true; this filter guards belt-and-
        // suspenders for an old cache.
        const isRuntimeNoise =
          msg.authorType === 'system' ||
          msg.presentation?.kind === 'system_notice';
        if (isRuntimeNoise) {
          if (!diagnostics) return null;
          return (
            <React.Fragment key={msg.commentId}>
              {showDivider ? (
                <div className="day-divider">
                  <span>{day}</span>
                </div>
              ) : null}
              <RuntimeNoiseRow msg={msg} />
            </React.Fragment>
          );
        }

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
              assigneeAgentId={assigneeAgentId ?? ''}
              employeeName={employeeName ?? ''}
              onRefresh={refresh}
              onPromoteMessage={onPromoteMessage}
            />
          </React.Fragment>
        );
      })}

      {/* Plan 04.1-06 Pattern C — optimistic InlineTaskCard rendered until
          the marker comment lands in the thread on the next 15s poll. The
          parent (Composer) clears `pendingTaskCard` when the operator
          starts a new send. */}
      {pendingTaskCard ? (
        <InlineTaskCard
          identifier={null}
          issueId={pendingTaskCard.issueId}
          title={pendingTaskCard.title}
          employeeName={employeeName ?? 'employee'}
          role={employeeRole}
          status={null}
          createdAt={new Date().toISOString()}
        />
      ) : null}

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
  assigneeAgentId,
  employeeName,
  onRefresh,
  onPromoteMessage,
}: {
  msg: ChatMessage;
  ms: number;
  isMine: boolean;
  companyId: string;
  userId: string;
  topicIssueId: string;
  // Plan 04.1-06 — Plan 04.1-02 chat.promote rewrite required two new
  // params: assigneeAgentId (D-06 wake contract) + employeeName (D-07
  // marker copy). Threaded from index.tsx via Composer + MessageThread.
  assigneeAgentId: string;
  employeeName: string;
  /** Re-fetch the thread — used so a pin's persisted ⚑ marker appears. */
  onRefresh?: () => void;
  /** Plan 04.1-08 — wire up to opening the dual-mode dialog at index.tsx. */
  onPromoteMessage?: ((src: PromoteSourceMessagePayload) => void) | null;
}): React.ReactElement | null {
  // A superseded comment is collapsed out of the edit chain (CHAT-05).
  if (msg.superseded) return null;

  const { visible, reasoning } = parseReasoning(msg.body);
  const who = isMine ? 'Eric · You' : 'Agent';

  return (
    // Plan 04.2-01 (RCB-03) — `id="msg-<commentId>"` is the stable DOM scroll
    // target for the chat surface's `?comment=<id>` deep link: the URL-param
    // handler in index.tsx does getElementById('msg-' + commentId) to scroll
    // + flash-highlight the source comment a Reader-view Continue-in-chat
    // jump points at.
    <article id={`msg-${msg.commentId}`} className={`msg${isMine ? ' me' : ''}`}>
      {isMine ? null : <div className="av">A</div>}
      <div className="bubble">
        {isMine ? null : (
          <PromoteActions
            commentId={msg.commentId}
            companyId={companyId}
            userId={userId}
            topicIssueId={topicIssueId}
            assigneeAgentId={assigneeAgentId}
            employeeName={employeeName}
            pinned={msg.pinned}
            onRefresh={onRefresh}
            sourceBody={msg.body}
            occurredAt={
              typeof msg.createdAt === 'string'
                ? msg.createdAt
                : new Date(ms).toISOString()
            }
            onPromoteMessage={onPromoteMessage}
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
  assigneeAgentId,
  employeeName,
  pinned,
  onRefresh,
  sourceBody,
  occurredAt,
  onPromoteMessage,
}: {
  commentId: string;
  companyId: string;
  userId: string;
  topicIssueId: string;
  /** Plan 04.1-02 — D-06 wake contract: chat.promote now requires the
   *  chatted employee's agent id (the promoted task is assigned to them). */
  assigneeAgentId: string;
  /** Plan 04.1-02 — D-07 marker comment copy. */
  employeeName: string;
  pinned: boolean;
  onRefresh?: () => void;
  /** Plan 04.1-08 — full source body for the dialog's FROM-MESSAGE block. */
  sourceBody?: string;
  /** Plan 04.1-08 — ISO timestamp for the FROM-MESSAGE eyebrow's HH:MM. */
  occurredAt?: string | null;
  /** Plan 04.1-08 — when provided, click opens the PROMOTE dialog at the
   *  index.tsx level (the new flow). When null, falls back to the old
   *  fire-and-forget chat.promote (legacy path). */
  onPromoteMessage?: ((src: PromoteSourceMessagePayload) => void) | null;
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
    // Plan 04.1-08 — when the parent provided onPromoteMessage, open the
    // dual-mode dialog in PROMOTE mode at index.tsx (the operator gets to
    // see title pre-fill + topic dropdown + FROM-MESSAGE block). The dialog
    // itself dispatches chat.createTrueTask; this component no longer fires
    // chat.promote inline.
    if (onPromoteMessage) {
      onPromoteMessage({
        body: sourceBody ?? '',
        commentId,
        employeeName,
        occurredAt: occurredAt ?? null,
      });
      return;
    }
    // Legacy path: when no parent handler is wired, fall back to the
    // inline fire-and-forget chat.promote — same behaviour as Plan 04.1-06.
    setBusy(true);
    setFeedback(null);
    try {
      const result = await promote({
        commentId,
        topicIssueId,
        companyId,
        userId,
        assigneeAgentId,
        employeeName,
      });
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
      setFeedback({ kind: 'error', text: 'Could not promote (CREATE_FAILED)' });
    } finally {
      setBusy(false);
    }
  }, [
    onPromoteMessage,
    sourceBody,
    occurredAt,
    promote,
    commentId,
    topicIssueId,
    companyId,
    userId,
    assigneeAgentId,
    employeeName,
  ]);

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

// ---------------------------------------------------------------------------
// RuntimeNoiseRow — Plan 04.1-06 D-16 diagnostics view.
//
// Renders a system-classified comment as a `.runtime-noise-comment` block
// (NEVER a bubble). When the host populates the structured presentation
// envelope (Wave 1 spike capture: presentation.kind === 'system_notice'
// AND metadata.sections), the row renders a <details> collapsible with
// typed rows: issue_link / agent_link / run_link → identifier chips;
// key_value → label + value. When the structured envelope is absent (the
// classifier matched the body-pattern fallback only) we render the raw
// body in a muted block.
//
// XSS posture: every parsed field renders as React text. NO
// dangerouslySetInnerHTML.
// ---------------------------------------------------------------------------
type SectionRow = {
  type?: string;
  label?: string;
  value?: string;
  identifier?: string;
  title?: string;
  name?: string;
  issueId?: string;
  agentId?: string;
  runId?: string;
};

function RuntimeNoiseRow({ msg }: { msg: ChatMessage }): React.ReactElement {
  const presentationKind = msg.presentation?.kind ?? 'message';
  const authorType = msg.authorType ?? 'unknown';
  const title = msg.presentation?.title ?? null;
  const sections = msg.metadata?.sections ?? null;
  const hasStructured = Array.isArray(sections) && sections.length > 0;

  return (
    <div className="runtime-noise-comment" role="note">
      <div className="runtime-noise-comment-header">
        ⏿ SYSTEM · {authorType} · {presentationKind}
      </div>
      {hasStructured ? (
        <details className="runtime-noise-comment-details">
          <summary>{title ?? 'System notice'}</summary>
          {/* Plan 04.2-05 D4/D5 — composite stable keys. The section + row
              indices were the only remaining bare-index `key={i}` / `key={j}`
              callsites in the chat surface. Composing the index with a
              stable field (section.title for sections; row.type for rows)
              keeps reconciliation correct if a section is added in the
              middle or a row's shape changes. Defensive — the 2026-05-24
              drill captured key-warning attributions on parent components
              that no longer reproduce on a clean install of 1.0.0-rc.2, but
              these were the index-only patterns worth hardening. */}
          {sections!.map((section, i) => (
            <div
              key={`section-${i}-${section.title ?? ''}`}
              className="runtime-noise-comment-section"
            >
              {section.title ? (
                <div className="runtime-noise-comment-section-title">{section.title}</div>
              ) : null}
              {(section.rows ?? []).map((row, j) => (
                <RuntimeNoiseStructuredRow
                  key={`row-${i}-${j}-${(row as SectionRow).type ?? ''}`}
                  row={row as SectionRow}
                />
              ))}
            </div>
          ))}
        </details>
      ) : (
        <div className="runtime-noise-comment-body">{msg.body}</div>
      )}
    </div>
  );
}

function RuntimeNoiseStructuredRow({ row }: { row: SectionRow }): React.ReactElement {
  const label = row.label ?? row.type ?? '·';
  switch (row.type) {
    case 'issue_link':
      return (
        <div className="runtime-noise-comment-row">
          <span className="runtime-noise-comment-row-label">{label}</span>
          <span className="clarity-ref-chip" data-clarity-noise-chip="issue">
            {row.identifier ?? 'ISSUE'}
            {row.title ? ` · ${row.title}` : ''}
          </span>
        </div>
      );
    case 'agent_link':
      return (
        <div className="runtime-noise-comment-row">
          <span className="runtime-noise-comment-row-label">{label}</span>
          <span className="clarity-ref-chip" data-clarity-noise-chip="agent">
            {row.name ?? 'agent'}
          </span>
        </div>
      );
    case 'run_link':
      return (
        <div className="runtime-noise-comment-row">
          <span className="runtime-noise-comment-row-label">{label}</span>
          <span className="clarity-ref-chip" data-clarity-noise-chip="run">
            run · {(row.runId ?? '').slice(0, 8)}
            {row.title ? ` · ${row.title}` : ''}
          </span>
        </div>
      );
    case 'key_value':
    default:
      return (
        <div className="runtime-noise-comment-row">
          <span className="runtime-noise-comment-row-label">{label}</span>
          <span className="runtime-noise-comment-row-value">{row.value ?? '—'}</span>
        </div>
      );
  }
}
