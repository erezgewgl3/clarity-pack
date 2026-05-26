// src/ui/surfaces/situation-room/critical-path-strip.tsx
//
// Plan 02-04 Task 2 — ROOM-02 top strip of up to 3 critical-path chains.
// Each chain renders with a one-line plain-English narration when the
// Editor-Agent has compiled one (snapshot.narrative field, populated by a
// future iteration). For v1 we fall back to a kind-derived sentence.
//
// Plan 06.1-03 Task 2 — per-row Take-Ownership + Convert-to-task button
// cluster (ROOM-09 UI tier + ROOM-11). The cluster's render rules:
//
//   - HUMAN_ACTION_ON.__unowned__  → [Take ownership] [Convert to task →]
//   - HUMAN_ACTION_ON (resolved)   → [Convert to task →]
//   - SELF_RESOLVING               → [Convert to task →]
//   - EXTERNAL                     → [Convert to task →]
//   - CYCLE                        → [+ Create task to break this cycle]
//                                     (NO Take-Ownership per D-13)
//
// Take-Ownership:
//   - Uses useResolvedUserId for viewerUserId (Plan 02-09); disabled state
//     with literal tooltip `Sign in to claim ownership` when null/error.
//   - Dispatches `usePluginAction('agent.takeOwnership')` with
//     { companyId, agentId, ownerUserId: viewerUserId, userId: viewerUserId }.
//   - On success: toast `Ownership claimed`, fires onTakeOwnershipSuccess
//     callback (force-refetch the snapshot + artifacts queries).
//   - On error: toast `Could not claim ownership — try again`. No state
//     mutation; button returns to enabled state. The action is reversible
//     (re-call to override) so there is no confirmation modal.
//
// Convert-to-task:
//   - Opens the canonical Plan 04.1-09 TrueTaskDialog in COLD mode with
//     EMPTY editable fields (D-12 — load-bearing operator constraint per
//     project memory `feedback_trust-the-clarification-loop`). Blocker
//     context (chain narration + terminal label) renders OUTSIDE the
//     dialog body inside `.clarity-critical-path-blocker-context`.
//
// Locked literal strings from UI-SPEC §Copywriting Contract (verbatim):
//   `Take ownership` / `Convert to task →` / `+ Create task to break this cycle`
//   `Sign in to claim ownership` / `Claiming ownership…`
//   `Ownership claimed` / `Could not claim ownership — try again`
//
// Color reservation (UI-SPEC §Color §Accent reservation list): the gold
// accent (`--clarity-you`) applies ONLY to `.clarity-take-ownership-btn`
// (border + label). The Convert-to-task button uses neutral chrome
// (`--clarity-line` border + `--clarity-fg` text).
//
// SECURITY (T-04-18 / T-06.1-16..20): all visible text renders as React
// text. No dangerouslySetInnerHTML. ownerUserId passed by the UI is
// re-verified server-side (Plan 06.1-01 T-06.1-01). No raw fetch.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import type { BlockerChainResult, Terminal } from '../../../shared/types.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { useToast } from '../../primitives/toast.tsx';
import { TrueTaskDialog } from '../chat/true-task/true-task-dialog.tsx';

/** D-13 — the string sentinel for an unowned HUMAN_ACTION_ON terminal.
 *  Locked in src/shared/blocker-chain.ts:178 (READ-ONLY invariant). */
const UNOWNED_SENTINEL = '__unowned__';

function defaultNarration(terminal: Terminal): string {
  switch (terminal.kind) {
    case 'HUMAN_ACTION_ON':
      return `Awaiting action: ${terminal.label}.`;
    case 'SELF_RESOLVING':
      return `Self-resolving: ${terminal.label}.`;
    case 'EXTERNAL':
      return `External: ${terminal.label}.`;
    case 'CYCLE':
      return `Cycle detected: ${terminal.label}.`;
    default: {
      // TS narrows to `never` after the four discriminants are exhausted; we
      // keep the default as a runtime safety net by widening the type back to
      // the union to access `label`.
      const t = terminal as Terminal;
      return t.kind;
    }
  }
}

/**
 * rc.8 final 2026-05-26 — idle-state filter. Live drill found every idle
 * agent generates a `HUMAN_ACTION_ON: "<Agent> has no owner assigned"`
 * chain — accurate per Paperclip's data model (the agent literally has
 * no operator assignment) but useless as actionable critical path. Three
 * "no owner assigned" rows in a row read as accusatory noise, not
 * "single human action ending a transitively-resolved blocker chain"
 * (PROJECT.md Surface 2 spec). Plan 06.1-01 + 06.1-03 now ship proper
 * Take-Ownership affordances + real blocker-chain resolution. The filter
 * is kept as a safety net for any agent rows that escape the new
 * owner-resolution path; once ROOM-09 is in place it should rarely fire.
 */
const NO_OWNER_ASSIGNED_RE = /\bhas no owner assigned\b/i;

function isActionableChain(chain: BlockerChainResult): boolean {
  const label = chain.terminal?.label ?? '';
  return !NO_OWNER_ASSIGNED_RE.test(label);
}

export function CriticalPathStrip({
  chains,
  narrative,
  viewerUserId = null,
  companyId = '',
  onTakeOwnershipSuccess,
}: {
  chains: BlockerChainResult[];
  narrative?: string | null;
  /** Plan 06.1-03 / D-09 — resolved via useResolvedUserId in the parent.
   *  null → button is disabled with `Sign in to claim ownership` tooltip. */
  viewerUserId?: string | null;
  /** Plan 06.1-03 — required for the agent.takeOwnership handler call. */
  companyId?: string;
  /** Plan 06.1-03 — called after a successful Take-Ownership claim so the
   *  parent can force-refetch snapshot + artifacts queries. */
  onTakeOwnershipSuccess?: () => void;
}): React.ReactElement | null {
  if (!chains || chains.length === 0) return null;
  const actionable = chains.filter(isActionableChain);
  if (actionable.length === 0) return null;
  return (
    <section className="clarity-critical-path" data-clarity-region="critical-path">
      <h2 className="clarity-critical-path-heading">Critical Path</h2>
      <ol className="clarity-critical-path-list">
        {actionable.slice(0, 3).map((chain, i) => (
          <CriticalPathRow
            key={`${chain.terminal.kind}-${i}-${chain.terminal.label}`}
            chain={chain}
            index={i + 1}
            viewerUserId={viewerUserId}
            companyId={companyId}
            onTakeOwnershipSuccess={onTakeOwnershipSuccess}
          />
        ))}
      </ol>
      {narrative ? (
        <p className="clarity-critical-path-narrative">{narrative}</p>
      ) : null}
    </section>
  );
}

/**
 * Single Critical Path row — narration + button cluster. Extracted so each
 * row owns its own dialog-open + in-flight state without re-rendering
 * sibling rows on every interaction.
 */
function CriticalPathRow({
  chain,
  index,
  viewerUserId,
  companyId,
  onTakeOwnershipSuccess,
}: {
  chain: BlockerChainResult;
  index: number;
  viewerUserId: string | null;
  companyId: string;
  onTakeOwnershipSuccess?: () => void;
}): React.ReactElement {
  const terminal = chain.terminal;
  const { showToast } = useToast();
  const takeOwnership = usePluginAction('agent.takeOwnership');

  // Per-row UI state.
  const [claiming, setClaiming] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Terminal classification (D-04 + D-13 + UI-SPEC §Edge Cases).
  const isCycleRow = terminal.kind === 'CYCLE';
  const isUnownedHumanAction =
    terminal.kind === 'HUMAN_ACTION_ON' && terminal.userId === UNOWNED_SENTINEL;
  const showTakeOwnership = isUnownedHumanAction;

  // Convert-to-task button label (locked literal strings — UI-SPEC §Copy).
  const convertToTaskLabel: string = isCycleRow
    ? '+ Create task to break this cycle'
    : 'Convert to task →';

  // Take-Ownership disabled state — viewerUserId null/error means the
  // useResolvedUserId hook either failed (`no-user-context`) or is still
  // loading. Either way: cannot dispatch with a real userId; show the
  // disabled affordance + tooltip.
  const takeOwnershipDisabled = !viewerUserId || claiming;

  // Agent id for the Take-Ownership write. For HUMAN_ACTION_ON terminals
  // (the only kind the button renders for) `terminal.userId` is the agent
  // employee's user id (Plan 06.1-01 worker handler keys `agent.takeOwnership`
  // on this id — same id the situation-snapshot lookup-map and
  // clarity_agent_owners.agent_id columns use).
  const agentIdForOwnership =
    terminal.kind === 'HUMAN_ACTION_ON' ? terminal.userId : '';

  const onClaim = React.useCallback(async () => {
    if (!viewerUserId || claiming) return;
    if (!agentIdForOwnership || agentIdForOwnership === UNOWNED_SENTINEL) return;
    setClaiming(true);
    try {
      const result = (await takeOwnership({
        companyId,
        agentId: agentIdForOwnership,
        ownerUserId: viewerUserId,
        userId: viewerUserId,
      })) as { ok?: boolean; error?: string } | null;
      if (result && result.ok) {
        showToast({ message: 'Ownership claimed' });
        if (onTakeOwnershipSuccess) onTakeOwnershipSuccess();
      } else {
        // Locked literal — UI-SPEC §Copywriting Contract (em-dash separator).
        showToast({ message: 'Could not claim ownership — try again' });
      }
    } catch {
      showToast({ message: 'Could not claim ownership — try again' });
    } finally {
      setClaiming(false);
    }
  }, [
    viewerUserId,
    claiming,
    agentIdForOwnership,
    takeOwnership,
    companyId,
    showToast,
    onTakeOwnershipSuccess,
  ]);

  // Blocker context block — renders OUTSIDE the dialog body (sibling under
  // the same row) but is only mounted while the dialog is open. The
  // operator reads context here; the dialog's editable fields stay empty
  // (D-12 / `feedback_trust-the-clarification-loop`).
  const blockerContextNode = dialogOpen ? (
    <aside
      className="clarity-critical-path-blocker-context"
      data-clarity-region="critical-path-blocker-context"
      role="note"
      aria-label="Blocker context"
    >
      <span className="clarity-critical-path-blocker-context-kind">
        {terminal.kind.replace(/_/g, ' ')}
      </span>
      <span className="clarity-critical-path-blocker-context-label">{terminal.label}</span>
      <span className="clarity-critical-path-blocker-context-narration">
        {defaultNarration(terminal)}
      </span>
    </aside>
  ) : null;

  return (
    <li
      className="clarity-critical-path-item"
      data-terminal-kind={terminal.kind}
    >
      <span className="clarity-critical-path-index">{index}.</span>
      <span className="clarity-critical-path-text">{defaultNarration(terminal)}</span>
      <div className="clarity-row-actions">
        {showTakeOwnership ? (
          <button
            type="button"
            className="clarity-take-ownership-btn"
            disabled={takeOwnershipDisabled}
            aria-busy={claiming || undefined}
            aria-label={
              claiming
                ? `Claiming ownership of ${terminal.label}…`
                : `Take ownership of ${terminal.label}`
            }
            title={viewerUserId ? undefined : 'Sign in to claim ownership'}
            onClick={onClaim}
          >
            Take ownership
          </button>
        ) : null}
        <button
          type="button"
          className="clarity-convert-to-task-btn"
          aria-label={
            isCycleRow
              ? `Create task to break cycle: ${terminal.label}`
              : `Convert to a task — ${defaultNarration(terminal)}`
          }
          onClick={() => setDialogOpen(true)}
        >
          {convertToTaskLabel}
        </button>
      </div>
      {blockerContextNode}
      <TrueTaskDialog
        open={dialogOpen}
        mode="cold"
        onClose={() => setDialogOpen(false)}
        onSuccess={() => {
          setDialogOpen(false);
          if (onTakeOwnershipSuccess) onTakeOwnershipSuccess();
        }}
        sourceMessage={null}
        sourceTopic={null}
        defaultAssigneeAgentId=""
        defaultEmployeeName=""
        companyId={companyId}
        userId={viewerUserId ?? ''}
        employeeAgentId=""
      />
    </li>
  );
}
