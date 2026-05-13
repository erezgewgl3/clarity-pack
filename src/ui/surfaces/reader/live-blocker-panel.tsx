// src/ui/surfaces/reader/live-blocker-panel.tsx
//
// Plan 02-03 Task 2 — READER-08 right-rail Live blocker panel. Renders
// EXACTLY ONE typed terminal kind — never the full pathIds chain. The four
// terminal kinds (from 02-02 blocker-chain primitive) are:
//   - HUMAN_ACTION_ON  → "⚑ ON YOU" callout + a single one-click button label
//   - SELF_RESOLVING   → "Self-resolving by {eta}" label, no button
//   - EXTERNAL         → "Awaiting external" label, no button
//   - CYCLE            → "Cycle: A → B → A" label, no button (operator must intervene)

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import type { BlockerChainResult, Terminal } from '../../../shared/types.ts';
import { StatePill } from '../../primitives/state-pill.tsx';

function primaryActionLabel(t: Terminal): string {
  if (t.kind === 'HUMAN_ACTION_ON') return `Resolve: ${t.label}`;
  return '';
}

export function LiveBlockerPanel({ issueId }: { issueId: string }): React.ReactElement | null {
  const { data } = usePluginData<BlockerChainResult>('flatten-blocker-chain', {
    startId: issueId,
    viewerUserId: '',
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
