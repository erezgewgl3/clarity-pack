// src/ui/surfaces/reader/live-blocker-panel.tsx
//
// Plan 02-09 Task 2 — DEV-15-STRUCTURAL: viewer identity now comes from
// useResolvedUserId() instead of useHostContext().userId. Detail-tab slots
// returned null userId until authApi.getSession() resolved, which made
// opt-in-guard fail-closed for flatten-blocker-chain.
//
// Plan 02-03c Task 2 — retrofit to use useResolvedCompanyId. The 02-03b
// drill caught this panel rendering the worker handler's fail-loud guard
// text verbatim, because the previous draft sent an empty companyId. After
// this retrofit, the gating wrapper ensures the worker call only happens
// once a real UUID resolves — structurally impossible to send empty
// companyId. (See 02-03c-HOST-CONTEXT.md "Universal pitfall" for the full
// context.)
//
// Plan 02-03b Task 2 — passes companyId + viewerUserId so the worker handler
// (now using ctx.issues.relations.get) has the context it needs to walk the
// blockedBy DAG. The 502 the drill observed came from the previous draft
// hitting a non-existent /blockers HTTP path; this version uses the SDK's
// typed relations client.
//
// Plan 02-03 Task 2 (original) — READER-08 right-rail Live blocker panel.
// Renders EXACTLY ONE typed terminal kind — never the full pathIds chain.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { BlockerChainResult } from '../../../shared/types.ts';
import { StatePill } from '../../primitives/state-pill.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';

// Plan 11-04 (D-13/SC1) — the primary action is gated on the ENGINE VERDICT's
// actionAffordance, NOT on terminal.kind. Every one of the 8 kinds maps to one
// of these five affordances via classifyVerdict() in the worker; the panel just
// renders the affordance honestly. 'none' renders no button.
type ActionAffordance = BlockerChainResult['actionAffordance'];

/** The button label for each affordance, or null when no button should render.
 *  awaitedPartyLabel is the scrubbed display string (NO_UUID_LEAK) — never a UUID.
 *  The scrub itself runs in the WORKER handler (flatten-blocker-chain.ts:
 *  scrubResultLabel → scrubHumanAction), mirroring org-blocked-backlog.ts /
 *  build-employees-rollup.ts — NOT in this panel. The panel only RENDERS the
 *  already-scrubbed string (Plan 11-06 / 11-07, IN-01). */
function primaryActionLabel(
  affordance: ActionAffordance,
  awaitedPartyLabel: string,
): string | null {
  switch (affordance) {
    case 'reply':
      return `Reply: ${awaitedPartyLabel}`;
    case 'nudge':
      return `Nudge ${awaitedPartyLabel}`;
    case 'assign':
      return 'Assign owner ▾';
    case 'open':
      return 'Open ↗';
    case 'none':
      return null;
    default: {
      // Exhaustiveness guard — a 6th affordance becomes a compile error.
      const _exhaustive: never = affordance;
      return _exhaustive;
    }
  }
}

/** The honest one-line blocker headline for each of the 8 kinds. Renders ONLY
 *  the SCRUBBED display strings — data.awaitedPartyLabel (the awaited-party
 *  string the worker handler flatten-blocker-chain.ts already scrubbed of every
 *  raw UUID via scrubResultLabel→scrubHumanAction) and data.degradeReason — and
 *  NEVER the raw terminal.label (which still embeds UUIDs straight off the pure
 *  engine) nor a raw targetAgentUuid/targetIssueUuid (NO_UUID_LEAK / D-15 / CR-01).
 *  For UNCLASSIFIED (D-12) the honest "can't determine — open to investigate" line. */
function blockerLine(data: BlockerChainResult): string {
  const t = data.terminal;
  switch (t.kind) {
    case 'AWAITING_HUMAN':
      return data.awaitedPartyLabel;
    case 'AWAITING_AGENT_WORKING':
      return `${data.awaitedPartyLabel} is working`;
    case 'AWAITING_AGENT_STUCK':
      return `${data.awaitedPartyLabel} is stuck`;
    case 'SELF_RESOLVING':
      // The scrub emits "{name} — assign an owner first" only for UNOWNED; for
      // SELF_RESOLVING awaitedPartyLabel is the scrubbed party/eta line.
      return `${data.awaitedPartyLabel} (resolves on its own)`;
    case 'EXTERNAL':
      return data.awaitedPartyLabel;
    case 'CYCLE':
      return `Circular dependency — ${data.awaitedPartyLabel}`;
    case 'UNOWNED':
      // The scrub already emits "… — assign an owner first"; do NOT append a
      // second "— no owner".
      return data.awaitedPartyLabel;
    case 'UNCLASSIFIED':
      return data.degradeReason
        ? `Can't determine blocker (${data.degradeReason}) — open to investigate`
        : "Can't determine blocker — open to investigate";
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

export function LiveBlockerPanel({ issueId }: { issueId: string }): React.ReactElement | null {
  const { companyId, loading: companyLoading } = useResolvedCompanyId();
  const { userId, loading: userIdLoading } = useResolvedUserId();

  // Right-rail panel is non-essential during the resolver loading window —
  // render nothing rather than a spinner. The Reader's main column is already
  // showing "Resolving company context…" so the user has the global signal.
  if (companyLoading || userIdLoading || !companyId || !userId) return null;

  return (
    <LiveBlockerPanelWithCompany
      issueId={issueId}
      companyId={companyId}
      viewerUserId={userId}
    />
  );
}

// Inner component — renders ONLY when companyId AND viewerUserId are real
// UUIDs. Keeps usePluginData's params shape stable across renders.
function LiveBlockerPanelWithCompany({
  issueId,
  companyId,
  viewerUserId,
}: {
  issueId: string;
  companyId: string;
  viewerUserId: string;
}): React.ReactElement | null {
  const { data } = usePluginData<BlockerChainResult>('flatten-blocker-chain', {
    startId: issueId,
    viewerUserId,
    companyId,
  });
  if (!data) return null;
  const { terminal } = data;
  // Plan 11-04 (D-13/SC1): render straight off the engine verdict. The "ON YOU"
  // banner is the needsYou signal (a person must act); the primary action is
  // gated on actionAffordance, never on terminal.kind. All 8 kinds render an
  // honest non-blank line via blockerLine().
  const actionLabel = primaryActionLabel(data.actionAffordance, data.awaitedPartyLabel);
  return (
    <div
      className="clarity-blocker-panel"
      data-clarity-region="live-blocker"
      data-terminal-kind={terminal.kind}
      data-action-affordance={data.actionAffordance}
    >
      <header className="clarity-blocker-header">
        {data.needsYou ? (
          <>
            <span className="clarity-on-you">⚑ ON YOU</span>
            <StatePill state="AwaitingYou" age={0} />
          </>
        ) : (
          <span className="clarity-blocker-kind">{terminal.kind.replace(/_/g, ' ')}</span>
        )}
      </header>
      <p className="clarity-blocker-label">{blockerLine(data)}</p>
      {actionLabel !== null ? (
        <button className="clarity-blocker-action">{actionLabel}</button>
      ) : null}
    </div>
  );
}
