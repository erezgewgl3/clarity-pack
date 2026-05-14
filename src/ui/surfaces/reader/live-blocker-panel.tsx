// src/ui/surfaces/reader/live-blocker-panel.tsx
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

function primaryActionLabel(t: Terminal): string {
  if (t.kind === 'HUMAN_ACTION_ON') return `Resolve: ${t.label}`;
  return '';
}

export function LiveBlockerPanel({ issueId }: { issueId: string }): React.ReactElement | null {
  const { companyId, userId } = useHostContext();
  const { data } = usePluginData<BlockerChainResult>('flatten-blocker-chain', {
    startId: issueId,
    viewerUserId: userId ?? '',
    companyId: companyId ?? '',
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
