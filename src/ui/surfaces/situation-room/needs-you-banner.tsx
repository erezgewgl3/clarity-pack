// src/ui/surfaces/situation-room/needs-you-banner.tsx
//
// Plan 08-02 Task 2 (Phase 8 people-first cockpit) — ROOM-18.
//
// The ALWAYS-VISIBLE top strip of the Situation Room. Two variants:
//   - URGENT (needsYou.count > 0): "⚠ N thing(s) need(s) you → <action>" plus an
//     action button that opens chat with the chain OWNER.
//   - NEUTRAL (count === 0): "✓ 0 need you — N moving · M idle · K stuck" with the
//     counts derived from the employees prop.
//
// B1 (namespace correctness): the worker emits topAction.agentId = the AGENT id
// of the ROW whose chain targets the viewer — NOT the chain owner's id. To open
// chat with the chain owner we look up that row in `employees` and read its
// blockerChain.ownerAgentId (an AGENT uuid = focusIssue.assigneeAgentId at the
// worker tier). We NEVER thread topAction.agentId directly, and NEVER a USER uuid
// (terminal.userId / viewerUserId) — those are different namespaces.
//
// SECURITY (T-08-UI-01 / T-08-UI-02): React text nodes only (no innerHTML);
// agentId values are consumed only as lookup keys / deep-link args, never as
// visible text. No expand/collapse state — the banner is a static visible strip.

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

export function NeedsYouBanner({
  needsYou,
  employees,
  companyPrefix,
  navigate,
}: NeedsYouBannerProps): React.ReactElement {
  return (
    <header
      className={`clarity-needs-you-banner ${
        needsYou.count > 0
          ? 'clarity-needs-you-urgent'
          : 'clarity-needs-you-neutral'
      }`}
    >
      {needsYou.count > 0 ? (
        <NeedsYouUrgent
          needsYou={needsYou}
          employees={employees}
          companyPrefix={companyPrefix}
          navigate={navigate}
        />
      ) : (
        <NeedsYouNeutral employees={employees} />
      )}
    </header>
  );
}

function NeedsYouUrgent({
  needsYou,
  employees,
  companyPrefix,
  navigate,
}: NeedsYouBannerProps): React.ReactElement {
  const count = needsYou.count;
  const topAction = needsYou.topAction;

  // B1: resolve the chain OWNER's AGENT uuid by looking up the row that matches
  // topAction.agentId, then reading ownerRow.blockerChain.ownerAgentId. This is
  // an AGENT uuid (focusIssue.assigneeAgentId at the worker tier) — never
  // topAction.agentId (the row's own id), never a USER uuid.
  const ownerRow = topAction
    ? employees.find((e) => e.agentId === topAction.agentId)
    : undefined;
  const ownerAgentId = ownerRow?.blockerChain?.ownerAgentId ?? null;
  const deepLink = ownerAgentId
    ? buildChatDeepLink({
        route: 'employee-only',
        companyPrefix,
        assigneeAgentId: ownerAgentId,
      })
    : null;

  const noun = count === 1 ? 'thing' : 'things';
  const verb = count === 1 ? 'needs' : 'need';
  const actionText = topAction ? topAction.humanAction : '';

  return (
    <div className="clarity-needs-you-urgent-body">
      <span className="clarity-needs-you-text">
        {`⚠ ${count} ${noun} ${verb} you → ${actionText}`}
      </span>
      <button
        type="button"
        className="clarity-needs-you-action"
        disabled={!deepLink}
        onClick={() => {
          if (deepLink) navigate(deepLink.to);
        }}
      >
        Open chat
      </button>
    </div>
  );
}

function NeedsYouNeutral({
  employees,
}: {
  employees: SituationEmployeeRow[];
}): React.ReactElement {
  // Operator-friendly grouping for the calm message:
  //   moving = running | reviewing · idle = idle | stale · stuck = blocked
  let moving = 0;
  let idle = 0;
  let stuck = 0;
  for (const e of employees) {
    if (e.state === 'running' || e.state === 'reviewing') moving += 1;
    else if (e.state === 'idle' || e.state === 'stale') idle += 1;
    else if (e.state === 'blocked') stuck += 1;
  }

  return (
    <span className="clarity-needs-you-text">
      {`✓ 0 need you — ${moving} moving · ${idle} idle · ${stuck} stuck`}
    </span>
  );
}
