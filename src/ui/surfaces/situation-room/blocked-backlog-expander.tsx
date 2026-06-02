// src/ui/surfaces/situation-room/blocked-backlog-expander.tsx
//
// Plan 09-02 Task 1 (R6) — the single "+ N more blocked issues" expander that
// REPLACES both OrgBlockedBacklogBanner and CriticalPathStrip.
//
// The mockup folds the old 29-item org-backlog AND the critical-path narrative
// into one collapsible drill-down at the END of the Needs-you group. R6: no
// standalone org-backlog banner, no standalone critical-path strip — one
// expander, default collapsed.
//
// Each residual (orphan) blocked-issue row gets its OWN [Assign ▾] (reusing
// owner-picker-popover, so even backlog issues are act-in-place, R4) + [Open ↗].
// The critical-path narrative renders as a short panel header inside the same
// expander.
//
// SECURITY (T-09-05): React text nodes only; no dangerouslySetInnerHTML. Owner
// ids never rendered as text (owner display uses the scrubbed ownerName).

import * as React from 'react';
import { useHostLocation, useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';

import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { formatAge } from '../../primitives/state-pill-format.ts';
import { OwnerPickerPopover } from './owner-picker-popover.tsx';
import type { OrgBlockedBacklog } from './org-blocked-backlog-banner-types.ts';

type BlockedBacklogExpanderProps = {
  backlog: OrgBlockedBacklog | null | undefined;
  /** The critical-path narrative the Editor-Agent compiled (folded in, R6). */
  criticalPathNarrative?: string | null;
  companyId: string;
  userId: string;
  /** Bumps the snapshot refetch after an orphan-row assign so the board
   *  re-resolves live (the mockup's re-group behavior). */
  onAssignSuccess: () => void;
};

export function BlockedBacklogExpander({
  backlog,
  criticalPathNarrative,
  companyId,
  userId,
  onAssignSuccess,
}: BlockedBacklogExpanderProps): React.ReactElement | null {
  const { pathname } = useHostLocation();
  const { navigate } = useHostNavigation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';
  const [open, setOpen] = React.useState(false);

  const rows = backlog?.rows ?? [];
  const total = backlog?.total ?? rows.length;

  // Nothing residual to surface AND no narrative — render nothing (no noise).
  if (rows.length === 0 && !criticalPathNarrative) {
    return null;
  }

  const openIssue = (identifier: string): void => {
    if (!identifier) return;
    navigate(`/${companyPrefix}/issues/${identifier}`);
  };

  return (
    <div className={`clarity-orphans ${open ? 'clarity-orphans-open' : ''}`}>
      <button
        type="button"
        className="clarity-orphan-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="clarity-orphan-chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {` + ${total} more blocked issue${total === 1 ? '' : 's'} across the org (no active agent)`}
      </button>

      {open ? (
        <div className="clarity-orphan-list">
          {criticalPathNarrative ? (
            <p className="clarity-orphan-narrative">{criticalPathNarrative}</p>
          ) : null}
          {rows.map((row) => (
            <div key={row.issueId} className="clarity-orphan-row">
              <span className="clarity-orphan-id">{row.identifier}</span>
              <span className="clarity-orphan-title">{row.title}</span>
              <span className="clarity-orphan-action">{row.humanAction}</span>
              {row.age_ms != null ? (
                <span className="clarity-orphan-meta">{`blocked ${formatAge(row.age_ms)}`}</span>
              ) : null}
              <span className="clarity-orphan-actions">
                {/* Plan 12-03 Task 2 (NY-03 / D-09 / T-12-08) — the Assign
                 *  control (which dispatches situation.assignOwner, a REAL
                 *  mutation) renders ONLY when the engine verdict says assignment
                 *  is the answer: actionAffordance === 'assign' ⇔ UNOWNED +
                 *  AWAITING_AGENT_STUCK (after 12-01). This closes the prior
                 *  unconditional mount where every orphan row showed [Assign ▾]
                 *  regardless of kind — an AWAITING_HUMAN / in-motion / external
                 *  row could expose an inappropriate assign mutation. We gate on
                 *  the SAME single verdict the SR row + Reader panel read — NO
                 *  terminal.kind list, NO ownerName string-match. */}
                {row.actionAffordance === 'assign' ? (
                  <OwnerPickerPopover
                    leafIssueId={row.issueId}
                    companyId={companyId}
                    userId={userId}
                    triggerLabel="Assign ▾"
                    onAssigned={() => onAssignSuccess()}
                  />
                ) : null}
                <button
                  type="button"
                  className="clarity-btn clarity-orphan-open"
                  onClick={() => openIssue(row.identifier)}
                >
                  Open ↗
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
