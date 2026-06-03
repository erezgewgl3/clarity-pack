// src/ui/surfaces/situation-room/tier-utils.ts
//
// Plan 15-03 / WR-02 — the ONE source of truth for the locked D-04/D-05 verdict-
// tier partition rule. Previously this logic was duplicated three ways (the
// exported visualTierOf in tier-strip.tsx, the inline visualTier const in
// employee-row.tsx, and a third re-implementation in the tests). A change to one
// copy that missed another produced a split-brain render: a row partitioned into
// tier X by <TierStrip> but rendering its body as tier Y in <EmployeeRow>.
//
// Both UI surfaces now import THIS function so they can never diverge.
//
// THE LOCKED PARTITION (15-CONTEXT D-04/D-05): partition on the ENGINE verdict
// `blockerChain.tier` ('needs-you' | 'in-motion' | 'watch'), NOT the Phase-9
// agent-state EmployeeGroup ('needs_you' | 'working' | 'idle'). They are NOT 1:1:
// a stuck-agent row is group 'needs_you' but tier 'watch' -> it MUST land in
// WATCH, never Needs-you (12-CONTEXT D-04 lock).
//
// SC3: this helper reads blockerChain.tier verbatim — it NEVER re-derives the
// tier from terminalKind / ownerName, and it NEVER re-computes ownership. A
// chainless row falls back to its agent-state group (working -> in-motion, else
// watch); ANY unmatched value defensively lands in watch so no row is ever
// dropped from the board.

/** The three VISUAL tiers — the engine verdict `tier` values (hyphenated). */
export type VisualTier = 'needs-you' | 'in-motion' | 'watch';

/** The minimal structural shape the partition reads. Kept loose so both the
 *  full SituationEmployeeRow (employee-row.tsx) and the strip's row type satisfy
 *  it without a worker-type import. */
export type TierPartitionRow = {
  blockerChain: { tier?: string | null } | null | undefined;
  group: string;
};

/** The LOCKED D-05 partition rule (pure): the engine verdict tier where a chain
 *  exists; a chainless row falls back to its agent-state group (working ->
 *  in-motion, else watch); ANY unmatched value defensively lands in watch so no
 *  row is ever dropped from the board. NEVER re-derives from terminalKind and
 *  NEVER re-computes ownership (SC3). */
export function visualTierOf(row: TierPartitionRow): VisualTier {
  const t = row.blockerChain?.tier;
  if (t === 'needs-you' || t === 'in-motion' || t === 'watch') {
    return t;
  }
  // Chainless fallback (no blocker chain): an actively-working agent is calm
  // In-motion awareness; everything else (idle / stale / paused) is Watch.
  if (row.blockerChain == null) {
    return row.group === 'working' ? 'in-motion' : 'watch';
  }
  // Defensive: a chain present with an unknown tier never vanishes.
  return 'watch';
}
