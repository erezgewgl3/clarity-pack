// src/ui/surfaces/situation-room/critical-path-strip.tsx
//
// Plan 02-04 Task 2 — ROOM-02 top strip of up to 3 critical-path chains.
// Each chain renders with a one-line plain-English narration when the
// Editor-Agent has compiled one (snapshot.narrative field, populated by a
// future iteration). For v1 we fall back to a kind-derived sentence.

import * as React from 'react';

import type { BlockerChainResult, Terminal } from '../../../shared/types.ts';

function defaultNarration(terminal: Terminal): string {
  switch (terminal.kind) {
    case 'HUMAN_ACTION_ON':
      return `Awaiting action: ${terminal.label}.`;
    case 'SELF_RESOLVING':
      return `Self-resolving: ${terminal.label}.`;
    case 'EXTERNAL':
      return `External: ${terminal.label}.`;
    case 'CYCLE':
      return `Cycle detected: ${terminal.label}.`;
    default: {
      // TS narrows to `never` after the four discriminants are exhausted; we
      // keep the default as a runtime safety net by widening the type back to
      // the union to access `label`.
      const t = terminal as Terminal;
      return t.kind;
    }
  }
}

export function CriticalPathStrip({
  chains,
  narrative,
}: {
  chains: BlockerChainResult[];
  narrative?: string | null;
}): React.ReactElement | null {
  if (!chains || chains.length === 0) return null;
  return (
    <section className="clarity-critical-path" data-clarity-region="critical-path">
      <h2 className="clarity-critical-path-heading">Critical Path</h2>
      <ol className="clarity-critical-path-list">
        {chains.slice(0, 3).map((chain, i) => (
          <li key={i} className="clarity-critical-path-item" data-terminal-kind={chain.terminal.kind}>
            <span className="clarity-critical-path-index">{i + 1}.</span>
            <span className="clarity-critical-path-text">{defaultNarration(chain.terminal)}</span>
          </li>
        ))}
      </ol>
      {narrative ? (
        <p className="clarity-critical-path-narrative">{narrative}</p>
      ) : null}
    </section>
  );
}
