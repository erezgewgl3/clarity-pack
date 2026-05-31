// src/ui/surfaces/situation-room/needs-you-banner.tsx
//
// Plan 09-02 Task 2 (R5 / R4 / WARNING 1) — the un-frozen needs-you banner.
//
// Three variants, driven by the un-frozen 09-01 needsYou (which now counts
// UNOWNED blockers, not just viewer-owned ones):
//   - URGENT + UNOWNED (≥1 unowned blocker): "⚠ N stuck · M unowned → assign
//     owners" + [Assign first ▾]. The button scrolls the oldest-unowned row
//     into view and OPENS ITS OWNER PICKER (it does NOT build a chat deep-link —
//     there is no owner to chat with; that was the old dead-button seam).
//   - URGENT + ALL-OWNED (stuck>0, 0 unowned): "⚠ N stuck, all owned → chase
//     <owner>" + [Open chat] with the owner (Phase 8 deep-link behavior).
//   - NEUTRAL (count === 0): "✓ 0 need you — N working · M idle".
//
// WARNING 1 / R4: [Assign first] is NEVER rendered disabled when count > 0.
// The old `disabled={!deepLink}` pattern is GONE — when count > 0 the button
// always performs (picker for unowned, chat for owned).
//
// SECURITY (T-09-05): React text nodes only; no dangerouslySetInnerHTML. Agent
// ids are consumed only as lookup keys / deep-link args, never rendered as text.

import * as React from 'react';

import { buildChatDeepLink } from '../chat/deep-link.mjs';
import type { SituationEmployeeRow } from './employee-row.tsx';

export type NeedsYou = {
  count: number;
  topAction: {
    agentId: string;
    humanAction: string;
    leafIssueId: string | null;
  } | null;
};

type NeedsYouBannerProps = {
  needsYou: NeedsYou;
  employees: SituationEmployeeRow[];
  companyPrefix: string;
  navigate: (to: string) => void;
};

/** The locked sentinel an unowned blocker-chain leaf carries as ownerName. */
const UNASSIGNED = 'Unassigned';

/** DOM id stamped on each EmployeeRow so the banner can scroll to + open the
 *  oldest-unowned row's picker (mirrors the mockup's #assign-first handler). */
export function rowDomId(agentId: string): string {
  return `clarity-room-row-${agentId}`;
}

export function NeedsYouBanner({
  needsYou,
  employees,
  companyPrefix,
  navigate,
}: NeedsYouBannerProps): React.ReactElement {
  const count = needsYou.count;

  // Partition the blocked rows the banner reasons about.
  const unownedBlocked = employees.filter(
    (e) => e.group === 'needs_you' && e.blockerChain?.ownerName === UNASSIGNED,
  );
  const ownedBlocked = employees.filter(
    (e) => e.group === 'needs_you' && e.blockerChain && e.blockerChain.ownerName !== UNASSIGNED,
  );
  const stuck = unownedBlocked.length + ownedBlocked.length;

  // ---- NEUTRAL (genuinely 0 need you) -------------------------------------
  if (count === 0) {
    const moving = employees.filter((e) => e.group === 'working').length;
    const idle = employees.filter((e) => e.group === 'idle').length;
    return (
      <header className="clarity-needs-you-banner clarity-needs-you-neutral">
        <span className="clarity-needs-you-text">
          {`✓ 0 need you — ${moving} working · ${idle} idle`}
        </span>
      </header>
    );
  }

  // ---- URGENT + UNOWNED — [Assign first] opens the oldest-unowned picker ----
  if (unownedBlocked.length > 0) {
    // Oldest unowned = the worker already sorted needs_you blocked→…; the
    // topAction (09-01) prefers the oldest unowned row. Fall back to the first
    // unowned row in worker order.
    const target =
      (needsYou.topAction &&
        unownedBlocked.find((e) => e.agentId === needsYou.topAction?.agentId)) ||
      unownedBlocked[0];

    const onAssignFirst = (): void => {
      if (typeof document === 'undefined' || !target) return;
      const node = document.getElementById(rowDomId(target.agentId));
      if (!node) return;
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Open the row's owner picker after the scroll settles (mockup parity).
      window.setTimeout(() => {
        const trigger = node.querySelector<HTMLButtonElement>('.clarity-owner-pick-trigger');
        if (trigger) trigger.click();
      }, 350);
    };

    return (
      <header className="clarity-needs-you-banner clarity-needs-you-urgent">
        <div className="clarity-needs-you-urgent-body">
          <span className="clarity-needs-you-text">
            {`⚠ ${stuck} stuck · ${unownedBlocked.length} unowned → assign owners to clear the board`}
          </span>
          <button
            type="button"
            className="clarity-needs-you-action clarity-needs-you-assign-first"
            onClick={onAssignFirst}
          >
            Assign first ▾
          </button>
        </div>
      </header>
    );
  }

  // ---- URGENT + ALL-OWNED — [Open chat] with the owner (Phase 8 behavior) ---
  const ownerRow =
    (needsYou.topAction &&
      ownedBlocked.find((e) => e.agentId === needsYou.topAction?.agentId)) ||
    ownedBlocked[0];
  const ownerName = ownerRow?.blockerChain?.ownerName ?? '';
  const ownerAgentId = ownerRow?.blockerChain?.ownerAgentId ?? null;
  const deepLink = ownerAgentId
    ? buildChatDeepLink({
        route: 'employee-only',
        companyPrefix,
        assigneeAgentId: ownerAgentId,
      })
    : null;

  const onChaseOwner = (): void => {
    if (deepLink) navigate(deepLink.to);
  };

  return (
    <header className="clarity-needs-you-banner clarity-needs-you-urgent">
      <div className="clarity-needs-you-urgent-body">
        <span className="clarity-needs-you-text">
          {ownerName
            ? `⚠ ${stuck} stuck, all owned → chase ${ownerName}`
            : `⚠ ${stuck} stuck, all owned`}
        </span>
        {deepLink ? (
          <button
            type="button"
            className="clarity-needs-you-action clarity-needs-you-chase"
            onClick={onChaseOwner}
          >
            Open chat
          </button>
        ) : null}
      </div>
    </header>
  );
}
