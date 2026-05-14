// src/ui/surfaces/situation-room/agent-card.tsx
//
// Plan 02-04 Task 2 — ROOM-01 one card per Paperclip employee. Renders:
//   - role + StatePill (state + age)
//   - "now doing" line
//   - blocker-chain terminal (one typed terminal kind — PRIM-05)
//   - latest artifact 1-line snippet (placeholder until Phase 5 DIST-04)
//   - 7-day velocity sparkline
//
// Visual fidelity target: sketches/paperclip-fix-situation-room.html agent cards.

import * as React from 'react';

import { StatePill, type StatePillState } from '../../primitives/state-pill.tsx';
import type { BlockerChainResult } from '../../../shared/types.ts';
import { Sparkline } from './sparkline.tsx';

export type AgentEmployee = {
  userId: string;
  role: string;
  state: string;
  age_ms: number;
  now_doing: string | null;
  blocker_chain: BlockerChainResult;
  latest_artifact: unknown | null;
  velocity_7d: number[];
};

const STATE_FALLBACK: StatePillState = 'Standby';

function normaliseState(raw: string): StatePillState {
  switch (raw) {
    case 'Working':
    case 'Stuck':
    case 'AwaitingYou':
    case 'Standby':
    case 'AwaitingPeer':
      return raw;
    default:
      return STATE_FALLBACK;
  }
}

export function AgentCard({ employee }: { employee: AgentEmployee }): React.ReactElement {
  const state = normaliseState(employee.state);
  const terminal = employee.blocker_chain?.terminal;
  return (
    <div className="clarity-agent-card" data-clarity-region="agent-card">
      <header className="clarity-agent-card-header">
        <span className="clarity-agent-role">{employee.role}</span>
        <StatePill state={state} age={employee.age_ms} />
      </header>
      {employee.now_doing ? (
        <p className="clarity-now-doing">{employee.now_doing}</p>
      ) : null}
      {terminal ? (
        <p className="clarity-agent-terminal" data-terminal-kind={terminal.kind}>
          <span className="clarity-agent-terminal-kind">{terminal.kind.replace(/_/g, ' ')}</span>
          <span className="clarity-agent-terminal-label">{terminal.label}</span>
        </p>
      ) : null}
      {employee.latest_artifact ? (
        <p className="clarity-agent-artifact">
          Latest artifact preview — full preview Phase 5 DIST-04.
        </p>
      ) : null}
      <Sparkline values={employee.velocity_7d} />
    </div>
  );
}
