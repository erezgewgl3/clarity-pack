// src/ui/surfaces/reader/ref-card.tsx
//
// Plan 02-03 Task 2 — READER-04 "Anchored to (resolved)" section. Renders one
// card per upstream BEAAA ref: title (large) + owner + StatePill + excerpt.
// excerpt is the SUBSTANTIVE quote (>= ~40 chars when permissions allow) —
// PRIM-02 says null excerpt means viewer lacks permission, in which case we
// render an explicit "Quote unavailable (permission-gated)" line.

import * as React from 'react';

import type { RefCardData } from '../../../shared/types.ts';
import { StatePill, type StatePillState } from '../../primitives/state-pill.tsx';

function statusToPill(status: RefCardData['status']): StatePillState {
  switch (status) {
    case 'in_progress':
      return 'Working';
    case 'blocked':
      return 'Stuck';
    case 'done':
      return 'Standby';
    case 'todo':
      return 'Standby';
    default:
      return 'Standby';
  }
}

export function AnchoredToCards({ cards }: { cards: RefCardData[] }): React.ReactElement {
  return (
    <section className="clarity-anchored-to" data-clarity-region="anchored-to">
      <h3>Anchored to (resolved)</h3>
      {cards.length === 0 ? (
        <p className="clarity-anchored-empty">No upstream references in this task.</p>
      ) : (
        <ul className="clarity-anchored-list">
          {cards.map((c) => (
            <RefCard key={c.id} card={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function RefCard({ card }: { card: RefCardData }): React.ReactElement {
  return (
    <li className="clarity-ref-card" data-ref-id={card.id}>
      <header className="clarity-ref-card-header">
        <span className="clarity-ref-card-id">{card.id}</span>
        <strong className="clarity-ref-card-title">{card.title}</strong>
        <StatePill state={statusToPill(card.status)} age={0} />
      </header>
      <p className="clarity-ref-card-owner">Owner: {card.ownerUserId ?? 'unassigned'}</p>
      {card.excerpt === null ? (
        <blockquote className="clarity-ref-card-quote clarity-ref-card-quote--gated">
          Quote unavailable (permission-gated)
        </blockquote>
      ) : (
        <blockquote className="clarity-ref-card-quote">{card.excerpt}</blockquote>
      )}
    </li>
  );
}
