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

import { isReplyReachable } from '../../../shared/reply-reachable.ts';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { formatAge } from '../../primitives/state-pill-format.ts';
import { ReplyInPlace } from '../_shared/reply-in-place.tsx';
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
                {/* Plan 14-03 Task 2 (SC3/SC4/DO-01) — the ONE shared
                 *  <ReplyInPlace> on the reply orphan rows (⇔ AWAITING_HUMAN). It
                 *  is mutually exclusive with the Assign branch: 'reply' mounts the
                 *  primitive (which owns its own Send/chips + Open↗ on the
                 *  reachable-false path), 'assign' keeps the OwnerPickerPopover.
                 *  The LEAF uuid (row.leafIssueUuid, 14-04) is the mutation id —
                 *  NOT row.issueId (the ROOT); row.identifier is the display key.
                 *  reachable computed off the REAL row.terminalKind (14-04, no
                 *  inline Terminal); needsDurabilityFlip from the REAL
                 *  row.needsDurabilityFlip (no terminalKind proxy). */}
                {row.actionAffordance === 'reply' ? (
                  <ReplyInPlace
                    leafIssueId={row.identifier}
                    leafIssueUuid={row.leafIssueUuid}
                    awaitedPartyLabel={row.awaitedPartyLabel}
                    namedAction={row.humanAction}
                    decisionOptions={row.decisionOptions}
                    needsDurabilityFlip={row.needsDurabilityFlip}
                    reachable={isReplyReachable(row.terminalKind)}
                    companyId={companyId}
                    userId={userId}
                    companyPrefix={companyPrefix}
                    navigate={navigate}
                    onActed={onAssignSuccess}
                  />
                ) : (
                  <>
                    {/* Plan 12-03 Task 2 (NY-03 / D-09 / T-12-08) — the Assign
                     *  control (which dispatches situation.assignOwner, a REAL
                     *  mutation) renders ONLY when the engine verdict says
                     *  assignment is the answer: actionAffordance === 'assign' ⇔
                     *  UNOWNED + AWAITING_AGENT_STUCK (after 12-01). We gate on the
                     *  SAME single verdict the SR row + Reader panel read — NO
                     *  terminal.kind list, NO ownerName string-match. Untouched by
                     *  Phase 14. */}
                    {row.actionAffordance === 'assign' ? (
                      <OwnerPickerPopover
                        // WR-02 (14-REVIEW / NO_UUID_LEAK) — leafIssueId is the
                        // HUMAN display + echo key (NOT a UUID). Previously this
                        // passed row.issueId (the root UUID), which the popover
                        // would have echoed in the toast. row.identifier is the
                        // human key. leafIssueUuid carries the MUTATION id
                        // (dispatch-only): prefer the chain leaf (row.leafIssueUuid,
                        // 14-04) and fall back to the root (row.issueId) for
                        // single-hop chains.
                        leafIssueId={row.identifier}
                        leafIssueUuid={row.leafIssueUuid ?? row.issueId}
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
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
