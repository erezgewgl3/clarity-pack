// src/ui/surfaces/situation-room/looks-done-affordance.tsx
//
// Plan 18-03 Task 3 (LEG-03 / D-05/D-06/D-07) — the honest-divergence affordance.
//
// When the AI TL;DR reads "done" but the deterministic engine still classifies
// the item blocked (needsYou), surfaces are honest about the contradiction
// instead of hiding it: this affordance shows "Looks done — close it?" and, ONLY
// on an explicit "Close as done" selection, dispatches the close mutation. It is
// CONFIRM-GATED BY CONSTRUCTION — there is no mount/effect auto-close path, so
// the close can never fire without the operator's deliberate click
// (T-18.03-STATE: the unintended-state-change threat is eliminated by
// construction + a test asserting no mutation absent the selection).
//
// SCAFFOLD ANALOG — owner-picker-popover.tsx (a NORMAL typed React component, NOT
// a slot-root; open/closed local state; outside-click + Esc close; usePluginAction
// for the host mutation; the issue UUID carried as a DISPATCH-ONLY prop, never
// rendered). The one INVERTED posture: owner-picker applies IMMEDIATELY (R7);
// this affordance is CONFIRM-GATED — the trigger opens a confirm, and the close
// fires only from the explicit "Close as done" handler.
//
// NO_UUID_LEAK (T-18.03-I): leafIssueUuid is the mutation id, consumed ONLY as a
// dispatch arg — never rendered as text. The human leafIssueId is the only
// displayed identifier.
//
// SECURITY (V5): every visible string is a React text node — no
// dangerouslySetInnerHTML. The host validates the UUID server-side on the close.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

/** The situation.closeAsDone action result (18-03 worker contract). */
type CloseResult =
  | { ok: true; leafIssueId: string }
  | { error: string }
  | null;

export type LooksDoneAffordanceProps = {
  /** The blocker-chain leaf issue the operator may close. HUMAN display key
   *  (BEAAA-NN) — the log/echo identifier, NOT the mutation id. */
  leafIssueId: string;
  /** The leaf issue UUID — the mutation id dispatched to situation.closeAsDone →
   *  ctx.issues.update. DISPATCH-ONLY (NO_UUID_LEAK / T-18.03-I): consumed only as
   *  an action arg, NEVER rendered as text. Falls back to leafIssueId only when a
   *  caller cannot supply the UUID (the human key is then also the dispatch key). */
  leafIssueUuid?: string;
  companyId: string;
  userId: string;
  /** Called after a successful close so the parent can toast + force-refetch (the
   *  row leaves needs-you on the next snapshot). Optional. */
  onClosed?: (result: { ok: true; leafIssueId: string }) => void;
};

export function LooksDoneAffordance({
  leafIssueId,
  leafIssueUuid,
  companyId,
  userId,
  onClosed,
}: LooksDoneAffordanceProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement | null>(null);

  const closeAsDone = usePluginAction('situation.closeAsDone');

  // Outside-click + Esc close (the popover/confirm only — NEVER the mutation).
  // Defer registration so the opening click does not immediately close it
  // (mirrors owner-picker-popover.tsx / shortcuts-popover.tsx).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const node = wrapRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (node && node.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onEsc);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousedown', onDown);
        window.removeEventListener('keydown', onEsc);
      }
    };
  }, [open]);

  // The ONLY path that dispatches the close — fired exclusively from the explicit
  // "Close as done" button's onClick. There is no effect/mount auto-close
  // (T-18.03-STATE: confirm-gated by construction).
  const dispatchClose = React.useCallback(async () => {
    if (closing) return;
    setClosing(true);
    try {
      const result = (await closeAsDone({
        companyId,
        leafIssueId,
        // DISPATCH-ONLY UUID — the mutation id. Falls back to the human key only
        // if a caller omitted the UUID (NO_UUID_LEAK: this is an arg, not a render).
        leafIssueUuid: leafIssueUuid ?? leafIssueId,
        userId,
      })) as CloseResult;
      if (result && 'ok' in result && result.ok) {
        setOpen(false);
        onClosed?.(result);
      }
      // On a structured { error } the confirm stays open; onClosed is not called.
    } catch {
      // Swallow — the confirm stays open; the operator can retry or keep blocked.
    } finally {
      setClosing(false);
    }
  }, [closing, closeAsDone, companyId, leafIssueId, leafIssueUuid, userId, onClosed]);

  return (
    <span className="clarity-looks-done" ref={wrapRef}>
      <button
        type="button"
        className="clarity-btn clarity-looks-done-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Looks done — close it?
      </button>
      {open ? (
        <span
          className="clarity-looks-done-confirm"
          role="alertdialog"
          aria-label="Close this issue as done?"
        >
          <span className="clarity-looks-done-confirm-text">
            The summary reads done, but it is still marked blocked. Close it?
          </span>
          <button
            type="button"
            className="clarity-btn clarity-btn-gold clarity-looks-done-yes"
            disabled={closing}
            onClick={() => void dispatchClose()}
          >
            Close as done
          </button>
          <button
            type="button"
            className="clarity-btn clarity-looks-done-no"
            disabled={closing}
            onClick={() => setOpen(false)}
          >
            Keep blocked
          </button>
        </span>
      ) : null}
    </span>
  );
}
