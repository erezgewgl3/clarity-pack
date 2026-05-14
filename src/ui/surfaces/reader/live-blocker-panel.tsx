// src/ui/surfaces/reader/live-blocker-panel.tsx
//
// Plan 02-03c Task 2 — retrofit to use useResolvedCompanyId. The 02-03b
// drill caught this panel rendering the worker handler's fail-loud guard
// text verbatim, because the previous draft sent an empty companyId. After
// this retrofit, the gating wrapper ensures the worker call only happens
// once a real UUID resolves — structurally impossible to send empty
// companyId. (See 02-03c-HOST-CONTEXT.md "Universal pitfall" for the full
// context.)
//
// Plan 02-03b Task 2 — passes companyId + viewerUserId from useHostContext so
// the worker handler (now using ctx.issues.relations.get) has the context it
// needs to walk the blockedBy DAG. The 502 the drill observed came from the
// previous draft hitting a non-existent /blockers HTTP path; this version uses
// the SDK's typed relations client.
//
// Plan 02-03 Task 2 (original) — READER-08 right-rail Live blocker panel.
// Renders EXACTLY ONE typed terminal kind — never the full pathIds chain.

import * as React from 'react';
import { usePluginData, useHostContext } from '@paperclipai/plugin-sdk/ui/hooks';

import type { BlockerChainResult, Terminal } from '../../../shared/types.ts';
import { StatePill } from '../../primitives/state-pill.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';

function primaryActionLabel(t: Terminal): string {
  if (t.kind === 'HUMAN_ACTION_ON') return `Resolve: ${t.label}`;
  return '';
}

export function LiveBlockerPanel({ issueId }: { issueId: string }): React.ReactElement | null {
  const { userId } = useHostContext();
  const { companyId, loading: companyLoading } = useResolvedCompanyId();

  // Right-rail panel is non-essential during the resolver loading window —
  // render nothing rather than a spinner. The Reader's main column is already
  // showing "Resolving company context…" so the user has the global signal.
  if (companyLoading || !companyId) return null;

  return (
    <LiveBlockerPanelWithCompany
      issueId={issueId}
      companyId={companyId}
      viewerUserId={userId ?? ''}
    />
  );
}

// Inner component — renders ONLY when companyId is a real UUID. Keeps
// usePluginData's params shape stable across renders.
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
  return (
    <div
      className="clarity-blocker-panel"
      data-clarity-region="live-blocker"
      data-terminal-kind={terminal.kind}
    >
      <header className="clarity-blocker-header">
        {terminal.kind === 'HUMAN_ACTION_ON' ? (
          <>
            <span className="clarity-on-you">⚑ ON YOU</span>
            <StatePill state="AwaitingYou" age={0} />
          </>
        ) : (
          <span className="clarity-blocker-kind">{terminal.kind.replace(/_/g, ' ')}</span>
        )}
      </header>
      <p className="clarity-blocker-label">{terminal.label}</p>
      {terminal.kind === 'HUMAN_ACTION_ON' ? (
        <button className="clarity-blocker-action">{primaryActionLabel(terminal)}</button>
      ) : null}
    </div>
  );
}
