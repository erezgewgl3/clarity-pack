// src/ui/surfaces/situation-room/tier-strip.tsx
//
// Plan 15-03 Task 1 (COCK-02 / SC2 / SC3 / D-04 / D-05) — the verdict-tier IA.
//
// SUPERSEDES the Phase-9 employee-row-strip.tsx people-strip (Needs you / Working
// / Idle, partitioned by the agent-STATE `group`). The Situation Room is now
// organized loudest-on-top by the ENGINE verdict tier:
//
//   Needs-you  ->  In-motion  ->  Watch
//
// THE LOCKED PARTITION (D-05) — partition on `blockerChain.tier`
// ('needs-you' | 'in-motion' | 'watch'), the engine verdict, NOT the Phase-9
// EmployeeGroup ('needs_you' | 'working' | 'idle'). They are NOT 1:1 (note the
// hyphen vs underscore): a stuck-agent row is group 'needs_you' but tier 'watch'
// -> it MUST land in WATCH, never Needs-you (12-CONTEXT D-04 lock).
//
//   Needs-you tier = blockerChain.tier === 'needs-you'   (Phase-12 leverage order,
//                    preserved from the worker — NO .sort() here)
//   In-motion tier = blockerChain.tier === 'in-motion'
//                    + chainless rows (blockerChain == null) with group 'working'
//   Watch tier     = blockerChain.tier === 'watch'
//                    + chainless rows (blockerChain == null) NOT working (idle/stale)
//                    + a defensive fall-through for any unmatched row (never dropped)
//                    + the <BlockedBacklogExpander> (org overflow) folded in at the END
//
// The view NEVER re-classifies (SC3): it reads blockerChain.tier verbatim and
// never re-derives the tier from terminalKind / ownerName. Every row renders via
// the REUSED EmployeeRow (the calm In-motion / quiet Watch variants are gated
// INSIDE EmployeeRow off the same engine tier — Task 2).
//
// Partition-then-render-empty (carried from employee-row-strip): every tier
// ALWAYS renders its header + count; an empty tier shows a muted "— none —" line
// (a zero is itself a signal).
//
// SECURITY (T-15-07 / NO_UUID_LEAK): no UUID / companyPrefix is rendered here;
// every visible string is a React text node (no dangerouslySetInnerHTML). The
// reused EmployeeRow owns the per-row NO_UUID_LEAK render path.

import * as React from 'react';

import { EmployeeRow, type SituationEmployeeRow } from './employee-row.tsx';
import { BlockedBacklogExpander } from './blocked-backlog-expander.tsx';
import type { OrgBlockedBacklog } from './org-blocked-backlog-banner-types.ts';

/** The three VISUAL tiers — the engine verdict `tier` values (hyphenated). */
type VisualTier = 'needs-you' | 'in-motion' | 'watch';

type TierStripProps = {
  employees: SituationEmployeeRow[];
  companyPrefix: string;
  companyId: string;
  userId: string;
  navigate: (to: string) => void;
  /** Force-refetch the snapshot after assign/reply/stand-down/resume so a row
   *  visibly re-partitions into its new tier (the mockup's live behavior). */
  onAssignSuccess: () => void;
  /** Org-backlog + critical-path, folded into the WATCH tier (D-05, relocated
   *  from the Phase-9 Needs-you section). */
  orgBacklog: OrgBlockedBacklog | null | undefined;
  criticalPathNarrative?: string | null;
};

/** Loudest-on-top order — ALWAYS rendered in this order (SC2). */
const TIER_ORDER: VisualTier[] = ['needs-you', 'in-motion', 'watch'];

const TIER_META: Record<
  VisualTier,
  { title: string; meta: string; emptyNote: string }
> = {
  'needs-you': {
    title: 'Needs you',
    meta: 'a named action only you can take',
    emptyNote: 'Nothing needs you — the board is clear.',
  },
  'in-motion': {
    title: 'In motion',
    meta: 'agents working — for your awareness',
    emptyNote: 'No agents currently in motion.',
  },
  watch: {
    title: 'Watch',
    meta: 'quietly stalled — awareness, not act-now',
    emptyNote: 'Nothing to watch.',
  },
};

/** The LOCKED D-05 partition rule (pure): the engine verdict tier where a chain
 *  exists; a chainless row falls back to its agent-state group (working ->
 *  in-motion, else watch); ANY unmatched value defensively lands in watch so no
 *  row is ever dropped from the board. NEVER re-derives from terminalKind. */
function visualTierOf(row: SituationEmployeeRow): VisualTier {
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

export function TierStrip({
  employees,
  companyPrefix,
  companyId,
  userId,
  navigate,
  onAssignSuccess,
  orgBacklog,
  criticalPathNarrative,
}: TierStripProps): React.ReactElement {
  // Partition by the engine verdict tier, preserving worker order WITHIN each
  // tier (SC3 — NO .sort() in the view; the worker already leverage-ranked the
  // Needs-you set per Phase 12).
  const byTier: Record<VisualTier, SituationEmployeeRow[]> = {
    'needs-you': [],
    'in-motion': [],
    watch: [],
  };
  for (const row of employees) {
    byTier[visualTierOf(row)].push(row);
  }

  return (
    <section data-testid="clarity-tier-strip" className="clarity-tier-strip">
      {TIER_ORDER.map((tier) => {
        const rows = byTier[tier];
        const meta = TIER_META[tier];
        return (
          <div
            key={tier}
            className={`clarity-tier-section clarity-tier-${tier}`}
            data-tier={tier}
          >
            <header className="clarity-tier-header">
              <h2 className="clarity-tier-title">{meta.title}</h2>
              <span className="clarity-tier-count">{`${rows.length}`}</span>
              <span className="clarity-tier-rule" aria-hidden="true" />
              <span className="clarity-tier-meta">{meta.meta}</span>
            </header>

            {rows.length === 0 ? (
              <p className="clarity-tier-empty">{`— none — ${meta.emptyNote}`}</p>
            ) : (
              <div className="clarity-tier-rows">
                {rows.map((row) => (
                  <EmployeeRow
                    key={row.agentId}
                    row={row}
                    companyPrefix={companyPrefix}
                    companyId={companyId}
                    userId={userId}
                    navigate={navigate}
                    onAssignSuccess={onAssignSuccess}
                  />
                ))}
              </div>
            )}

            {/* D-05 — the org-overflow backlog + critical-path narrative folds in
             *  at the END of the WATCH tier (relocated from the Phase-9 Needs-you
             *  section). Mounted exactly once, in the watch branch only. */}
            {tier === 'watch' ? (
              <BlockedBacklogExpander
                backlog={orgBacklog}
                criticalPathNarrative={criticalPathNarrative}
                companyId={companyId}
                userId={userId}
                onAssignSuccess={onAssignSuccess}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
