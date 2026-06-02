// src/ui/surfaces/situation-room/needs-you-banner.tsx
//
// Plan 09-02 Task 2 (R5 / R4 / WARNING 1) — the un-frozen needs-you banner.
//
// Three variants, driven by the un-frozen 09-01 needsYou (which now counts
// UNOWNED blockers, not just viewer-owned ones). Plan 11-04 (D-14, SC5): the
// unowned/owned partition reads the engine verdict (actionAffordance === 'assign'
// = genuinely UNOWNED), never the legacy ownerName-sentinel string match:
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
    // Human display key — DISPLAY ONLY.
    leafIssueId: string | null;
    // Plan 09-04 (R3) — the leaf issue UUID (mutation id), kept in sync with the
    // worker shape. The banner's [Assign first ▾] is DOM-driven (it opens the
    // target row's picker), so it never dispatches this itself; the row's
    // OwnerPickerPopover owns the dispatch.
    leafIssueUuid: string | null;
  } | null;
};

type NeedsYouBannerProps = {
  needsYou: NeedsYou;
  employees: SituationEmployeeRow[];
  companyPrefix: string;
  navigate: (to: string) => void;
};

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

  // Partition the blocked rows the banner reasons about. Plan 11-04 (D-14, SC5):
  // "unowned" is the engine verdict's genuinely-unowned affordance
  // (actionAffordance === 'assign'), NOT the legacy ownerName-sentinel string
  // match. Every other needs-you row (AWAITING_HUMAN / agent-stuck / etc.) is
  // "owned" for banner purposes — there is a party to chase, not an owner to
  // assign.
  const unownedBlocked = employees.filter(
    (e) => e.group === 'needs_you' && e.blockerChain?.actionAffordance === 'assign',
  );
  const ownedBlocked = employees.filter(
    (e) =>
      e.group === 'needs_you' &&
      e.blockerChain &&
      e.blockerChain.actionAffordance !== 'assign',
  );
  // WR-03 (12-REVIEW) — the banner's headline number is the SAME per-leaf deduped
  // `count` the worker reports and every downstream decision/test uses, NOT a
  // per-agent row tally. Phase 12-02 changed needsYou.count to "distinct deduped
  // action items (one per leaf)"; a per-agent `unownedBlocked.length +
  // ownedBlocked.length` could diverge (3 agents on one unowned leaf → 3 rows but
  // count 1), so the banner would say "3 stuck" while the system acts on "1".
  // Render `count` so the displayed number and the count model agree.
  const actions = count;

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

  // ---- URGENT + UNOWNED — [Assign first] opens the highest-leverage picker ----
  if (unownedBlocked.length > 0) {
    // WR-01 (12-REVIEW) — resolve the row [Assign first] scrolls to.
    //
    // topAction.agentId is the representative of the HIGHEST-LEVERAGE action item,
    // and that representative can come from the `targeting` partition (an
    // AWAITING_HUMAN row whose affordance is 'reply', not 'assign'). Such a row is
    // NOT in unownedBlocked, so keying [Assign first] off topAction.agentId would
    // silently fall through to the wrong row.
    //
    // unownedBlocked is filtered from `employees`, which the worker already returns
    // in leverage-ranked order WITHIN the needs_you band (Plan 12-02 D-08). So
    // unownedBlocked[0] IS the highest-leverage unowned row. We use topAction's
    // row ONLY when it is genuinely one of the unowned rows (the common case the
    // banner copy promises — "assign owners"); otherwise we honestly scroll to the
    // highest-leverage unowned row rather than mis-resolving to an owned/targeting
    // representative.
    const topActionUnowned =
      needsYou.topAction != null
        ? unownedBlocked.find((e) => e.agentId === needsYou.topAction?.agentId)
        : undefined;
    const target = topActionUnowned ?? unownedBlocked[0];

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
            {`⚠ ${actions} action${actions === 1 ? '' : 's'} needed · ${unownedBlocked.length} unowned → assign owners to clear the board`}
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
  // Plan 11-04 — render the SCRUBBED awaitedPartyLabel (the verdict display
  // string), never the raw ownerName. ownerAgentId stays a mutation-only
  // deep-link arg (NO_UUID_LEAK).
  const ownerName = ownerRow?.blockerChain?.awaitedPartyLabel ?? '';
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
            ? `⚠ ${actions} action${actions === 1 ? '' : 's'} needed, all owned → chase ${ownerName}`
            : `⚠ ${actions} action${actions === 1 ? '' : 's'} needed, all owned`}
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
