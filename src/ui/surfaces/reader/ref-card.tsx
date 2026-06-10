// src/ui/surfaces/reader/ref-card.tsx
//
// Plan 02-03 Task 2 — READER-04 "Anchored to (resolved)" section. Renders one
// card per upstream BEAAA ref: title (large) + owner + StatePill + excerpt.
// excerpt is the SUBSTANTIVE quote (>= ~40 chars when permissions allow) —
// PRIM-02 says null excerpt means viewer lacks permission, in which case we
// render an explicit "Quote unavailable (permission-gated)" line.
//
// Plan 05-07 Task 2 (D-14) — React-key audit pass for AnchoredToCards.
// Audit verdict: the safe.map() at line 44 is already keyed on `c.id`
// (the BEAAA-NNN identifier — stable, server-provided). The child
// RefCard contains no `.map()` of its own. The 2026-05-25 drill
// attribution to "AnchoredToCards" maps to this file only when the
// Reader is open; on the chat-only console capture path the source
// likely lives elsewhere in the host's React tree. Verified by
// test/ui/chat-react-key-console-capture.test.mjs.

import * as React from 'react';
import { useHostLocation } from '@paperclipai/plugin-sdk/ui/hooks';

import type { RefCardData } from '../../../shared/types.ts';
import { SafeMarkdown } from '../../primitives/safe-markdown.tsx';
// Plan 07-04 Task 3 (D-I31-03) — the prefix the excerpt's SafeMarkdown uses to
// chip-ify in-quote PREFIX-NNN refs (derived once in AnchoredToCards, threaded
// to each RefCard). Instance-agnostic; broad fallback when no prefix.
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';

// 17-04 (D-13) — translate the task-tracker status codes into plain English.
// The old `statusToPill` emitted code-chip vocabulary (`Stuck`/`Standby`) that
// read like plumbing, not "just tell me what's going on". Returns a plain-word
// label (or null to drop the chip entirely for neutral/unknown states) plus a
// stable class suffix for host-CSS colouring. No raw status code reaches the UI.
function statusToWords(
  status: RefCardData['status'],
): { label: string; tone: string } | null {
  switch (status) {
    case 'in_progress':
      return { label: 'in progress', tone: 'progress' };
    case 'blocked':
      return { label: 'needs attention', tone: 'attention' };
    case 'done':
      return { label: 'done', tone: 'done' };
    case 'todo':
      return { label: 'not started', tone: 'neutral' };
    default:
      // Unknown/neutral status → drop the chip rather than show a code word.
      return null;
  }
}

export function AnchoredToCards({ cards }: { cards: RefCardData[] | undefined }): React.ReactElement {
  // Plan 07-04 Task 3 — derive the company prefix once and thread it to each
  // RefCard so the excerpt's SafeMarkdown can chip-ify in-quote refs.
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname);
  // DEV-15 (drill 2026-05-14): defensive null-safety. The issue-reader
  // worker handler returns `refCards: undefined` when resolve-refs fails to
  // fetch a referenced issue (e.g. cross-org BEAAA-* placeholders in a test
  // issue body 404 against the local Paperclip). Without this guard the
  // whole Reader tab crashes at `cards.length` and the host renders a red
  // "Clarity Pack failed to render" boundary.
  const safe = cards ?? [];
  return (
    <section className="clarity-anchored-to" data-clarity-region="anchored-to">
      <h3>Anchored to (resolved)</h3>
      {safe.length === 0 ? (
        <p className="clarity-anchored-empty">No upstream references in this task.</p>
      ) : (
        <ul className="clarity-anchored-list">
          {safe.map((c) => (
            <RefCard key={c.id} card={c} companyPrefix={companyPrefix} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function RefCard({
  card,
  companyPrefix,
}: {
  card: RefCardData;
  companyPrefix?: string | null;
}): React.ReactElement {
  // 17-04 (D-13) — plain-English first, machine codes demoted but recoverable.
  const status = statusToWords(card.status);
  return (
    // data-ref-id keeps BEAAA-NNN recoverable for search/citation even though it
    // no longer leads the header (sketch skill: ID legible but secondary).
    <li className="clarity-ref-card" data-ref-id={card.id}>
      <header className="clarity-ref-card-header">
        {/* Title LEADS (bright sans) — "just tell me what's going on". */}
        <strong className="clarity-ref-card-title">{card.title}</strong>
        {/* ID demoted to a recessed mono secondary tag — still legible. */}
        <span className="clarity-ref-card-id clarity-ref-card-id--demoted">{card.id}</span>
        {/* Status as plain words (no code-chip); dropped entirely when neutral. */}
        {status ? (
          <span
            className={`clarity-ref-card-status clarity-ref-card-status--${status.tone}`}
          >
            {status.label}
          </span>
        ) : null}
      </header>
      <p className="clarity-ref-card-owner">Owner: {card.ownerUserId ?? 'unassigned'}</p>
      {card.excerpt === null ? (
        <blockquote className="clarity-ref-card-quote clarity-ref-card-quote--gated">
          Quote unavailable (permission-gated)
        </blockquote>
      ) : (
        // 07-02 (D-I3-01) — render the upstream issue-body excerpt's markdown as
        // formatted React nodes (was a raw text node showing literal "## BLUF").
        // 07-04 (D-I31-03) — enable ref-awareness so in-quote PREFIX-NNN refs
        // become clickable titled chips (consistent with the prose body + TL;DR).
        // The card header's own id/title (line above) is separate from this
        // quote body, so there is no double-up.
        <blockquote className="clarity-ref-card-quote">
          <SafeMarkdown text={card.excerpt} linkRefs companyPrefix={companyPrefix} />
        </blockquote>
      )}
    </li>
  );
}
