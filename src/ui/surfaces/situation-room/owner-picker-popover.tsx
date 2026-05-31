// src/ui/surfaces/situation-room/owner-picker-popover.tsx
//
// Plan 09-02 Task 1 (R3 / R4 / D-01 / D-02) — the [Assign owner ▾] popover.
//
// The hero affordance of the actionable cockpit: a blocked-unowned row (or an
// orphan backlog row) opens this popover, picks an agent (or "Take it myself"),
// and the worker mutates the REAL Paperclip issue via situation.assignOwner.
//
// ROSTER SOURCE (WARNING 2 / D-01 / T-09-11) — options come from
// usePluginData('chat.roster'), NEVER ctx.agents.list. chat.roster already
// excludes the Editor-Agent server-side (CHAT-01 — by agent id), so the infra
// agent can never appear as an assignable owner. Options are rendered in roster
// order verbatim — NO smart / least-busy / relevance sort (D-01: present
// everyone clearly, let the operator choose; honors the no-prefill rule).
//
// "TAKE IT MYSELF" (D-02) — a trailing `.self` item assigns the issue to the
// operator (assigneeUserId via takeItMyself:true). The SINGLE place
// assigneeUserId (vs assigneeAgentId) is used. Honest framing: the row then
// leaves Needs-you and reads "with you — handling manually" (the worker
// re-groups it on the forced refetch).
//
// CONFIRM POSTURE (R7) — assign applies IMMEDIATELY, no intermediate confirm.
//
// SECURITY (T-09-05): every visible string is a React text node — no
// dangerouslySetInnerHTML. Agent ids are consumed only as dispatch args / React
// keys, never rendered as text.
//
// This is a NORMAL typed React component, NOT a plugin slot-root — it takes its
// props directly. Outside-click + Esc close mirror shortcuts-popover.tsx.

import * as React from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

/** Mirror of chat-roster.ts RosterEmployee — kept structural so the UI bundle
 *  does not import worker types. */
type RosterEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
};

type ChatRosterData =
  | { kind: 'roster'; employees: RosterEmployee[] }
  | { error: string }
  | null;

/** The situation.assignOwner action result (09-01 worker contract). */
type AssignResult =
  | { ok: true; leafIssueId: string; assignedTo: string }
  | { error: string }
  | null;

export type OwnerPickerPopoverProps = {
  /** The blocker-chain leaf issue to reassign (09-01 guarantees non-null for
   *  the unowned case the picker is rendered for). */
  leafIssueId: string;
  companyId: string;
  userId: string;
  /** Trigger label. Defaults to the row affordance "Assign owner ▾"; the
   *  orphan backlog rows pass "Assign ▾". */
  triggerLabel?: string;
  /** Called after a successful assign with the action result. The parent fires
   *  the toast + force-refetch (so the row re-groups live). */
  onAssigned: (result: { ok: true; leafIssueId: string; assignedTo: string }) => void;
};

export function OwnerPickerPopover({
  leafIssueId,
  companyId,
  userId,
  triggerLabel = 'Assign owner ▾',
  onAssigned,
}: OwnerPickerPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement | null>(null);

  const assignOwner = usePluginAction('situation.assignOwner');

  // WARNING 2 — roster sourced from chat.roster (Editor-Agent excluded
  // server-side), NOT ctx.agents.list. We only fetch when the popover is open
  // so a board full of blocked rows does not fire N roster reads at mount.
  const { data: rosterData } = usePluginData<ChatRosterData>(
    'chat.roster',
    open ? { companyId, userId } : {},
  );

  const roster: RosterEmployee[] =
    rosterData && typeof rosterData === 'object' && 'kind' in rosterData && rosterData.kind === 'roster'
      ? rosterData.employees
      : [];

  // Outside-click close — defer registration so the opening click does not
  // immediately close (mirrors shortcuts-popover.tsx).
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

  const dispatchAssign = React.useCallback(
    async (params: { assigneeAgentId?: string; takeItMyself?: boolean }) => {
      if (assigning) return;
      setAssigning(true);
      try {
        const result = (await assignOwner({
          companyId,
          leafIssueId,
          userId,
          ...params,
        })) as AssignResult;
        if (result && 'ok' in result && result.ok) {
          setOpen(false);
          onAssigned(result);
        }
        // On a structured { error } the popover stays open; the parent's
        // onAssigned is not called, so no false success toast / refetch.
      } catch {
        // Swallow — the popover stays open; operator can retry or pick another.
      } finally {
        setAssigning(false);
      }
    },
    [assigning, assignOwner, companyId, leafIssueId, userId, onAssigned],
  );

  return (
    <span className="clarity-owner-pick" ref={wrapRef}>
      <button
        type="button"
        className="clarity-btn clarity-btn-gold clarity-owner-pick-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div className="clarity-owner-pick-pop" role="menu" aria-label="Assign owner">
          <div className="clarity-owner-pick-head">Assign owner →</div>
          {roster.map((emp) => (
            <button
              key={emp.id}
              type="button"
              role="menuitem"
              className="clarity-owner-pick-item"
              disabled={assigning}
              onClick={() => void dispatchAssign({ assigneeAgentId: emp.id })}
            >
              <span className="clarity-owner-pick-dot" aria-hidden="true" />
              <span className="clarity-owner-pick-name">{emp.name}</span>
              {emp.role ? (
                <span className="clarity-owner-pick-role">{emp.role}</span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="clarity-owner-pick-item clarity-owner-pick-self"
            disabled={assigning}
            onClick={() => void dispatchAssign({ takeItMyself: true })}
          >
            <span className="clarity-owner-pick-dot" aria-hidden="true" />
            <span className="clarity-owner-pick-name">Take it myself</span>
          </button>
        </div>
      ) : null}
    </span>
  );
}
