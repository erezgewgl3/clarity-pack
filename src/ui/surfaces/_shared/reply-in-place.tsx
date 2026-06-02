// src/ui/surfaces/_shared/reply-in-place.tsx
//
// Plan 14-02 Task 2 (DO-01 / DO-02 / DO-04 / DO-05 / SC1-SC5) — the ONE shared
// reply-in-place primitive. ALL THREE blocker surfaces (Situation Room employee
// row, Reader live-blocker panel, org-blocked backlog expander) import THIS
// component (no copies — SC3). Wiring lands in wave 3 (14-03); this wave produces
// the single re-used component so wave 3 cannot triplicate the logic.
//
// It owns the entire reply-in-place mechanic:
//   - the free-text reply input + Send (reachable === true),
//   - the optional quick-decision chips (decisionOptions non-empty — DO-02/SC2),
//   - the Open ↗ escape for out-of-system rows (reachable === false — DO-05/SC4),
//   - the situation.replyAndResume dispatch via usePluginAction (split-identity:
//     leafIssueUuid mutation id + leafIssueId echo + a fresh client messageUuid +
//     needsDurabilityFlip),
//   - await-confirm honesty (D-12 / SC1) — pending → success ONLY on { ok }, an
//     honest error toast on { error } (never a false "resumed"),
//   - NO_UUID_LEAK (SC5) — only leafIssueId / awaitedPartyLabel render; the *Uuid
//     values are read into dispatch-only consts, never inside a {...} render expr.
//
// The `reachable` prop is computed BY the surface via isReplyReachable(terminalKind)
// (AWAITING_HUMAN-only) — this primitive CONSUMES the boolean; it does not import
// the predicate, so the verdict gate lives in one place per surface.
//
// Dispatch + result-guard shape mirror owner-picker-popover.tsx's dispatchAssign:
// the `leafIssueUuid ?? leafIssueId` fallback (UUID-only mounts), the structured
// `'ok' in result` guard, the `sending` concurrency guard. Every visible string is
// a React text node — NO dangerouslySetInnerHTML.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import { useToast } from '../../primitives/toast.tsx';

/** The situation.replyAndResume action result (wave 1 — 14-01 worker contract). */
type ReplyResult =
  | { ok: true; commentId: string; leafIssueId: string; durable: boolean }
  | { error: 'REPLY_FAILED' | 'OPT_IN_REQUIRED' }
  | null;

export type ReplyInPlaceProps = {
  /** HUMAN display key (BEAAA-NN) — rendered in the toast/label + the Open↗ URL;
   *  NEVER the mutation id. Null on a multi-hop chain with no leaf human key
   *  (CR-01 honest degrade — renders no Open↗ rather than a 404). */
  leafIssueId: string | null;
  /** Leaf issue UUID — the createComment/update mutation id. Dispatch arg ONLY,
   *  never rendered (NO_UUID_LEAK). Falls back to leafIssueId for UUID-only mounts. */
  leafIssueUuid: string | null;
  /** Scrubbed display string — who the reply goes to (rendered). */
  awaitedPartyLabel: string;
  /** The Editorial named-action sentence shown as the row label. */
  namedAction: string;
  /** Computed by the surface via isReplyReachable(terminalKind) — AWAITING_HUMAN
   *  only. true → Send/chips; false → named action + Open↗ only (no dead Send). */
  reachable: boolean;
  /** D-04 — true → comment + {status:'in_progress'} durability flip (Shape B);
   *  false → comment-only (Shape A). Carried verbatim to the handler. */
  needsDurabilityFlip: boolean;
  /** D-05 — non-empty array → render quick-decision chips; null/empty → free-text
   *  reply only. Rendered verbatim from the Phase-13 conservative binary. */
  decisionOptions: string[] | null;
  companyId: string;
  userId: string;
  /** For the Open↗ host route: /<companyPrefix>/issues/<leafIssueId>. */
  companyPrefix: string;
  /** Host nav (mirrors employee-row's navigate). */
  navigate: (to: string) => void;
  /** The parent's force-refetch-the-snapshot callback (so the row re-resolves /
   *  leaves Needs-you live after a successful reply). Mirrors onAssignSuccess. */
  onActed: () => void;
};

/** D-06 — map a chip label to a plain operator ANSWER sentence (never a structured
 *  command). The awaited agent reads it as the answer. Planner discretion mapping. */
export function cannedSentence(option: string): string {
  switch (option.trim().toLowerCase()) {
    case 'approve':
      return 'Approved.';
    case 'reject':
      return 'Rejected.';
    case 'yes':
      return 'Yes.';
    case 'no':
      return 'No.';
    default:
      // A pick-one option (e.g. "Option B") posts as a plain sentence answer.
      return `${option.trim()}.`;
  }
}

/** Stable client messageUuid — crypto.randomUUID with a deterministic-shape
 *  fallback (some embedded runtimes lack it). Used as the idempotency key. */
function freshMessageUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual generator
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ReplyInPlace({
  leafIssueId,
  leafIssueUuid,
  awaitedPartyLabel,
  namedAction,
  reachable,
  needsDurabilityFlip,
  decisionOptions,
  companyId,
  userId,
  companyPrefix,
  navigate,
  onActed,
}: ReplyInPlaceProps): React.ReactElement {
  const reply = usePluginAction('situation.replyAndResume');
  const { showToast } = useToast();

  const [body, setBody] = React.useState('');
  const [sending, setSending] = React.useState(false);
  // The messageUuid is generated once per click and REUSED on a Retry of the same
  // click (idempotency — D-15). Cleared after a confirmed { ok } so the next reply
  // gets a fresh key.
  const pendingMessageUuid = React.useRef<string | null>(null);

  // Split-identity (NO_UUID_LEAK) — the UUID is read into a dispatch-only const so
  // the render body below never embeds it inside a {...} expression.
  const mutationIssueUuid = leafIssueUuid ?? leafIssueId;

  const dispatchReply = React.useCallback(
    async (replyBody: string) => {
      if (sending) return;
      const text = replyBody.trim();
      if (!text) return;
      setSending(true);
      // Reuse the in-flight messageUuid on a Retry; otherwise mint a fresh one.
      const messageUuid = pendingMessageUuid.current ?? freshMessageUuid();
      pendingMessageUuid.current = messageUuid;
      try {
        const result = (await reply({
          companyId,
          leafIssueUuid: mutationIssueUuid,
          leafIssueId,
          body: text,
          userId,
          messageUuid,
          needsDurabilityFlip,
        })) as ReplyResult;
        if (result && 'ok' in result && result.ok) {
          // Success ONLY on the structured { ok } — await-confirm honesty (SC1).
          showToast({
            message: `Replied to ${awaitedPartyLabel}${leafIssueId ? ` · ${leafIssueId}` : ''}`,
            duration: 6000,
          });
          setBody('');
          pendingMessageUuid.current = null;
          onActed();
        } else {
          // Honest error — never a false "resumed". Input stays populated; the
          // messageUuid is retained so a Retry dedups against the same key.
          showToast({
            message: `Couldn't reach ${awaitedPartyLabel} — your reply was not sent. Try again.`,
            duration: 6000,
          });
        }
      } catch {
        // Honest error (never optimistic). Keep the input + messageUuid for retry.
        showToast({
          message: `Couldn't reach ${awaitedPartyLabel} — your reply was not sent. Try again.`,
          duration: 6000,
        });
      } finally {
        setSending(false);
      }
    },
    [
      sending,
      reply,
      companyId,
      mutationIssueUuid,
      leafIssueId,
      userId,
      needsDurabilityFlip,
      awaitedPartyLabel,
      showToast,
      onActed,
    ],
  );

  // -------------------------------------------------------------------------
  // reachable === false → named action + Open↗ ONLY (no input/chips/Send — SC4).
  // -------------------------------------------------------------------------
  if (!reachable) {
    const openIssue = (): void => {
      if (!leafIssueId) return;
      // Open↗ uses the HUMAN identifier, never the UUID (paperclip-issue-url-pattern).
      navigate(`/${companyPrefix}/issues/${leafIssueId}`);
    };
    return (
      <div className="clarity-reply-in-place" data-reachable="false">
        <p className="clarity-reply-named-action">{namedAction}</p>
        {leafIssueId ? (
          <button type="button" className="clarity-btn clarity-reply-open" onClick={openIssue}>
            Open ↗
          </button>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // reachable === true → free-text input + Send, plus chips iff decisionOptions
  // is a non-empty array (DO-02/SC2). Chips dispatch the SAME path.
  // -------------------------------------------------------------------------
  const hasChips = Array.isArray(decisionOptions) && decisionOptions.length > 0;

  return (
    <div className="clarity-reply-in-place" data-reachable="true">
      <p className="clarity-reply-named-action">{namedAction}</p>
      {hasChips ? (
        <div className="clarity-reply-chips" role="group" aria-label="Quick decision">
          {decisionOptions!.map((option) => (
            <button
              key={option}
              type="button"
              className="clarity-btn clarity-reply-chip"
              disabled={sending}
              onClick={() => void dispatchReply(cannedSentence(option))}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <div className="clarity-reply-compose">
        <input
          type="text"
          className="clarity-reply-input"
          // Plan 14-03 (Rule 2 a11y fix) — an accessible name for the reply input
          // (the static a11y R2 rule requires id/name/aria-label, not just a
          // placeholder). Scrubbed awaitedPartyLabel only (NO_UUID_LEAK).
          aria-label={`Reply to ${awaitedPartyLabel}`}
          placeholder={`Reply to ${awaitedPartyLabel}…`}
          value={body}
          disabled={sending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void dispatchReply(body);
          }}
        />
        <button
          type="button"
          className="clarity-btn clarity-btn-gold clarity-reply-send"
          disabled={sending || body.trim().length === 0}
          onClick={() => void dispatchReply(body)}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
