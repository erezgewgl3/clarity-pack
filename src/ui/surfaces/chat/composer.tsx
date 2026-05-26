// src/ui/surfaces/chat/composer.tsx
//
// Plan 04-05 Task 2 — CHAT-06 / CHAT-07 — the message composer.
// Plan 04.1-08 STRIPPED — single-purpose chat textarea. The Send-as-task
// TOGGLE is REMOVED entirely. The send button always says SEND. The placeholder
// is `Message {employee}…`. Cold task creation lives in the new actions row
// (`+ Create task` primary button); promote-from-message lives in the per-bubble
// hover affordance. This component is no longer responsible for opening any
// task dialog.
//
// Send model (D-10 / CHAT-06 / RESEARCH Pattern 3):
//   - On send, the composer generates a crypto.randomUUID() message_uuid
//     BEFORE the bridge call and renders an optimistic bubble in the thread
//     keyed by that uuid.
//   - On success the optimistic bubble reconciles away once the server
//     thread (re-fetched by MessageThread on the stream event) contains the
//     comment.
//   - On failure the optimistic bubble STAYS marked "Failed to send" with a
//     Retry affordance — Retry re-sends the SAME message_uuid so chat.send's
//     dedup makes the retry idempotent. Eric's typed text is never silently
//     lost (T-04-21).
//
// Disabled state (Plan 04.1-08): when the active topic is archived, the
// parent passes `disabled={true}`. The textarea becomes read-only, the send
// button is disabled, the wrapper picks up `.composer--disabled` (dashed
// border + dim text), and the placeholder flips to "Unarchive to send
// messages." No chat.send call can fire from a disabled composer.
//
// Plan 05-11 (CHAT-07 gap closure) — attachments LIVE.
// The Plan 04-01 OQ-1 NO-PATH verdict (no plugin-accessible attachments
// route) was reframed by the 2026-05-26 debugger investigation: while the
// host's "Attachments" widget writes to public.assets / public.issue_
// attachments (no SDK client), the plugin-owned ctx.issues.documents store
// IS reachable and is what the Plan 05-04 DIST-04 dispatcher already reads.
// Plan 05-11 uploads chat-attached files into THAT store and writes a
// plugin-namespace chat_message_attachments row linking each upload to its
// chat_messages row.
//
// Upload-on-send semantics (Option B locked 2026-05-26):
//   1. operator picks file(s) -> useAttachmentPicker stages them in
//      browser memory; the chip mounts with state 'staged'. NO host call.
//   2. operator clicks Send -> handleSend calls doSend(messageUuid, body)
//      which dispatches chat.send. chat.send commits the chat_messages
//      row with that messageUuid as the PK, returns { ok, commentId }.
//   3. After chat.send returns, handleSend calls uploadAll(messageUuid)
//      from the picker hook -- the FK target on chat_message_attachments
//      is chat_messages.message_uuid, which the composer already knows
//      because the composer generated it client-side. The chain runs
//      per-file: chip flips staged -> uploading -> ready (or failed +
//      Retry). The chat message is ALREADY persisted before any upload
//      fires; partial-attachment-failure is recoverable without re-typing
//      the message body.
//
// SECURITY: no raw fetch — chat.send + chat.attachment.upload both go
// through usePluginAction. Body text + attachment bytes are untrusted
// input; the worker mime-sniffs + size-caps every upload.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import {
  MessageThread,
  type OptimisticMessage,
  type PromoteSourceMessagePayload,
} from './message-thread.tsx';
import type { ChatActiveTask } from './active-tasks-owned.tsx';
// Plan 05-08 (D-19) — composer shortcuts popover with TWO parallel `?` triggers.
import { ComposerShortcutsPopover } from './shortcuts-popover.tsx';
// Plan 05-11 (CHAT-07 gap closure) — composer attachments wire-up.
import { useAttachmentPicker } from './attachment-picker.tsx';
import { AttachmentChip } from './attachment-chip.tsx';

/** Generate a message_uuid — crypto.randomUUID with a safe fallback. */
function newMessageUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Composer({
  companyId,
  userId,
  topicIssueId,
  topicTitle,
  assigneeAgentId,
  employeeName,
  employeeRole,
  diagnostics = false,
  disabled = false,
  activeTasks = [],
  pendingTaskCard = null,
  onPendingResolved = null,
  onPromoteMessage = null,
  archivedBanner = null,
}: {
  companyId: string;
  userId: string;
  topicIssueId: string;
  topicTitle: string;
  /** D-06 default assignee for chat.send — the chatted employee. Plan 04.1-08
   *  removed the dialog wiring from this component; the composer no longer
   *  passes assigneeAgentId to a child dialog. Threaded down to MessageThread
   *  for PromoteActions (per-bubble hover). */
  assigneeAgentId: string;
  /** Locked copywriting — the placeholder reads `Message {employeeName}…`. */
  employeeName: string;
  /** Optional employee role suffix for downstream components. */
  employeeRole?: string | null;
  /** Plan 04.1-06 — threaded down from index.tsx so chat.messages receives
   *  includeDiagnostics:true and MessageThread renders runtime-noise inline. */
  diagnostics?: boolean;
  /** Plan 04.1-08 — true when the active topic is archived. Disables sending
   *  and applies `.composer--disabled` styling. */
  disabled?: boolean;
  /** Plan 04.1-09 — chat.taskOwned data threaded from index.tsx so the
   *  MessageThread inline-task-card branch can look up real titles by
   *  issueId. Default `[]` keeps backwards compatibility. */
  activeTasks?: ChatActiveTask[];
  /** Plan 04.1-08 — optimistic InlineTaskCard shown in the thread until the
   *  marker comment lands on the next poll. Now driven by the parent (the
   *  + Create task / Promote dialog opens at the index.tsx level). */
  pendingTaskCard?: { issueId: string; title: string } | null;
  /** Plan 04.1-10 — fired by MessageThread when the chat.messages poll
   *  surfaces a marker comment whose issueId matches the optimistic
   *  pendingTaskCard. index.tsx clears the pending state so the
   *  activeTasks-sourced render owns the card from then on (no double
   *  render race). */
  onPendingResolved?: ((issueId: string) => void) | null;
  /** Plan 04.1-08 — threaded from index.tsx through to the per-bubble
   *  PromoteActions; clicking "→ Promote to task" opens the dual-mode
   *  dialog in PROMOTE mode at the index.tsx level. */
  onPromoteMessage?: ((src: PromoteSourceMessagePayload) => void) | null;
  /** Plan 04.1-08 — passed through to MessageThread so the sticky read-only
   *  banner renders at the top of `.messages` when the topic is archived. */
  archivedBanner?: {
    topicTitle: string;
    messageCount: number;
    tasksSpawned: number;
    lastActiveAt: string | null;
    onUnarchive: () => void;
  } | null;
}): React.ReactElement {
  const send = usePluginAction('chat.send');
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // The optimistic overlay — messages sent this session, keyed by uuid.
  const [optimistic, setOptimistic] = React.useState<OptimisticMessage[]>([]);

  // Plan 05-11 (CHAT-07) — attachment picker hook. Files are STAGED on
  // pick (browser memory only -- no upload); uploadAll(messageUuid) fires
  // after chat.send returns with the same messageUuid the composer
  // generated client-side.
  const attachmentPicker = useAttachmentPicker({
    companyId,
    userId,
    topicIssueId,
  });
  const { openPicker, staged, removeStaged, uploadAll, clear, PickerInput } =
    attachmentPicker;
  void clear; // keep available for a future v1.1 auto-clear; current v1 keeps
  // chips visible after Send so the operator can Retry / Remove failures.
  const anyUploading = staged.some((s) => s.state === 'uploading');

  // Plan 05-08 (D-19) — composer shortcuts popover state.
  const [shortcutsPopoverOpen, setShortcutsPopoverOpen] = React.useState(false);
  const composerWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const closeShortcutsPopover = React.useCallback(() => {
    setShortcutsPopoverOpen(false);
    // Restore focus to the textarea so Esc keeps the operator in the composer.
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  // doSend is shared by the initial send and Retry. Retry passes the SAME
  // uuid + body so chat.send's message_uuid dedup makes it idempotent.
  // Plan 05-11 (CHAT-07) -- doSend returns true on a successful chat.send;
  // handleSend chains uploadAll(messageUuid) on success so the attachment
  // chain fires AFTER the chat_messages row is committed.
  const doSend = React.useCallback(
    async (messageUuid: string, body: string): Promise<boolean> => {
      setBusy(true);
      setOptimistic((prev) => {
        const existing = prev.find((o) => o.messageUuid === messageUuid);
        const entry: OptimisticMessage = {
          messageUuid,
          body,
          createdAt: Date.now(),
          status: 'pending',
          onRetry: () => void doSend(messageUuid, body),
        };
        return existing
          ? prev.map((o) => (o.messageUuid === messageUuid ? entry : o))
          : [...prev, entry];
      });
      let ok = false;
      try {
        const result = await send({
          topicIssueId,
          body,
          messageUuid,
          companyId,
          userId,
        });
        if (result && typeof result === 'object' && 'error' in result) {
          throw new Error(String((result as { error: unknown }).error));
        }
        setOptimistic((prev) =>
          prev.map((o) =>
            o.messageUuid === messageUuid ? { ...o, status: 'sent' } : o,
          ),
        );
        ok = true;
      } catch {
        setOptimistic((prev) =>
          prev.map((o) =>
            o.messageUuid === messageUuid ? { ...o, status: 'failed' } : o,
          ),
        );
        ok = false;
      } finally {
        setBusy(false);
      }
      return ok;
    },
    [send, topicIssueId, companyId, userId],
  );

  const handleSend = React.useCallback(() => {
    // Plan 04.1-08 — disabled state hard-blocks send.
    if (disabled) return;
    const body = draft.trim();
    if (!body || busy) return;
    // Plan 05-11 (CHAT-07) — guard against double-send while uploads are
    // mid-flight. staged + ready chips are fine; an in-flight 'uploading'
    // means the previous Send chain is still running.
    if (anyUploading) return;
    const messageUuid = newMessageUuid();
    setDraft('');
    void (async () => {
      const ok = await doSend(messageUuid, body);
      if (!ok) {
        // chat.send failed -- staged attachments remain in the composer
        // for the operator to retry the whole send.
        return;
      }
      // Plan 05-11 (CHAT-07) -- fire the upload chain AFTER chat.send has
      // persisted the chat_messages row. uploadAll iterates staged entries
      // sequentially; success flips chip to 'ready', failure to 'failed'
      // with a bound retry callback. We clear staged once the chain
      // finishes -- the ready chips are reflected on the persisted message
      // by the next chat.messages poll; failed chips are surfaced via the
      // attachment-picker hook's staged state for individual Retry.
      if (staged.length > 0) {
        await uploadAll(messageUuid);
        // After uploadAll, the picker hook's staged list still contains
        // failed entries (they keep their `state: 'failed'` + onRetry).
        // Successful entries are flipped to 'ready' in the hook's local
        // state and will be re-rendered by the thread poll. We DO NOT
        // clear() on a mixed-failure outcome -- the operator needs the
        // failed chips for Retry.
        // Detect "all succeeded" by checking the hook's CURRENT staged
        // (note: closure capture is stale; we rely on the hook's internal
        // ref to expose latest entries via staged on next render). The
        // simpler invariant for v1: clear() when staged is empty at this
        // point -- the hook drops successful entries to no-op, so a
        // mid-render staged list still indicates failures to keep.
        // For v1 we leave staged in the picker; the operator can Retry or
        // Remove failed chips. Successful chips remain visible until they
        // are reflected on the next poll, at which point the operator can
        // also choose to clear via Remove (no host call needed).
      } else {
        // No attachments -- nothing more to do.
      }
    })();
  }, [draft, busy, doSend, disabled, anyUploading, staged, uploadAll]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;

      // Plan 05-08 (D-19) — popover dismissal paths when already open.
      if (shortcutsPopoverOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeShortcutsPopover();
          return;
        }
        // Any printable key while open: close popover; the keystroke
        // continues into the textarea (no preventDefault).
        if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') {
          setShortcutsPopoverOpen(false);
          // Fall through to Enter handling below.
        }
      }

      // Plan 05-08 (D-19) — TWO parallel `?` triggers (per checker BLOCKER 3):
      //   - PRIMARY: bare `?` in EMPTY textarea opens the popover (SP1).
      //   - PARALLEL DISCOVERABILITY: Shift-? in ANY textarea state opens
      //     the popover (SP3). On most US keyboards `?` requires Shift+/,
      //     so both paths collapse to the same `event.key === '?'` check;
      //     the SP2 literal-? path is reachable by dismissing the popover.
      // Bind to the textarea's onKeyDown — never a window listener (the
      // popover stays composer-scoped per D-19 operator deviation).
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutsPopoverOpen(true);
        return;
      }

      if (e.key !== 'Enter') return;
      if (e.shiftKey) return; // Shift+Enter → newline.
      e.preventDefault();
      handleSend();
    },
    [handleSend, disabled, shortcutsPopoverOpen, closeShortcutsPopover],
  );

  const placeholder = disabled
    ? 'Unarchive to send messages.'
    : `Message ${employeeName}…`;

  return (
    <>
      <MessageThread
        companyId={companyId}
        userId={userId}
        topicIssueId={topicIssueId}
        optimistic={optimistic}
        assigneeAgentId={assigneeAgentId}
        employeeName={employeeName}
        employeeRole={employeeRole ?? null}
        diagnostics={diagnostics}
        activeTasks={activeTasks}
        pendingTaskCard={pendingTaskCard}
        onPendingResolved={onPendingResolved}
        onPromoteMessage={onPromoteMessage}
        archivedBanner={archivedBanner}
      />
      <div
        ref={composerWrapperRef}
        className={`composer${disabled ? ' composer--disabled' : ''}`}
        data-clarity-region="composer"
        data-clarity-disabled={disabled ? 'true' : 'false'}
      >
        <div className="composer-meta">
          <span className="topic-now">
            Topic · <b>{topicTitle}</b>
          </span>
          <span>messages persist as comments on the topic issue</span>
        </div>
        {/* Plan 05-08 (D-19) — composer shortcuts popover. Opens on either
            the bare-? (empty composer) trigger OR the Shift-? trigger; both
            paths route through the textarea's onKeyDown handler above. */}
        <ComposerShortcutsPopover
          open={shortcutsPopoverOpen}
          onClose={closeShortcutsPopover}
          anchorRef={composerWrapperRef}
        />
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message composer"
            readOnly={disabled}
            disabled={disabled}
            // GAP 1 — Composer is keyed `composer-${topic.issueId}` in
            // index.tsx, so it remounts on every topic open — autoFocus drops
            // the cursor in the textarea.
            autoFocus={!disabled}
          />
          {/* Plan 05-11 (CHAT-07) — staged attachment chips render between
              the textarea and the send-row. Each chip carries a Remove
              affordance pre-send; failed chips (post-send) get Retry
              bound from the picker hook. */}
          {staged.length > 0 ? (
            <div className="composer-attachments" data-clarity-region="composer-attachments">
              {staged.map((a) => (
                <AttachmentChip
                  key={a.tempId}
                  filename={a.filename}
                  mimeType={a.mimeType}
                  byteSize={a.byteSize}
                  state={a.state}
                  onRemove={() => removeStaged(a.tempId)}
                  onRetry={
                    a.state === 'failed' && a.lastChatMessageId
                      ? attachmentPicker.retryFor(
                          a.tempId,
                          a.lastChatMessageId,
                        )
                      : undefined
                  }
                />
              ))}
            </div>
          ) : null}
          <div className="composer-foot">
            <div className="composer-tools">
              <button
                type="button"
                className="tool-btn"
                disabled={disabled}
                title="Attach a file"
                onClick={openPicker}
                data-clarity-action="open-attachment-picker"
              >
                📎 Attach
              </button>
              {/* Plan 05-11 (CHAT-07) — hidden file input mounted here so the
                  programmatic click() from openPicker triggers the native
                  file dialog. accept=".xlsx,.pdf,.md,.png" filters the
                  picker; the worker re-validates every upload. */}
              <PickerInput />
            </div>
            <div className="send-row">
              <span className="composer-hint">
                <kbd>↵</kbd> to send · <kbd>⇧</kbd>+<kbd>↵</kbd> for newline
              </span>
              <button
                type="button"
                className="btn"
                onClick={handleSend}
                disabled={
                  busy ||
                  disabled ||
                  draft.trim().length === 0 ||
                  anyUploading
                }
              >
                SEND
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
