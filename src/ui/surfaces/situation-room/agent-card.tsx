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
import { formatAge, humaniseState } from '../../primitives/state-pill-format.ts';
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

/**
 * Plan 02-08 Task 2 (DEV-12) — when now_doing is null, derive a fallback line
 * from state + age so the card body never renders empty. Phase 3's
 * Editor-Agent prose pass will eventually fill this with richer text; until
 * then, "Standby — idle 2m" / "Working for 5m" is better than nothing.
 */
function nowDoingFallback(employee: AgentEmployee): string {
  if (employee.now_doing) return employee.now_doing;
  const state = normaliseState(employee.state);
  const age = formatAge(employee.age_ms);
  if (state === 'Standby') {
    return `Standby — idle ${age}`;
  }
  return `${humaniseState(state)} for ${age}`;
}

export function AgentCard({ employee }: { employee: AgentEmployee }): React.ReactElement {
  const state = normaliseState(employee.state);
  const terminal = employee.blocker_chain?.terminal;
  const nowDoingText = nowDoingFallback(employee);
  return (
    <div className="clarity-agent-card" data-clarity-region="agent-card">
      <header className="clarity-agent-card-header">
        <span className="clarity-agent-role">{employee.role}</span>
        <StatePill state={state} age={employee.age_ms} />
      </header>
      <p className="clarity-now-doing">{nowDoingText}</p>
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
