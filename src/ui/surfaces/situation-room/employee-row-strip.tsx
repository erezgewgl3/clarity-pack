// src/ui/surfaces/situation-room/employee-row-strip.tsx
//
// Plan 09-02 Task 2 (R1 / R2 / R6 / D-03) — the grouped people view.
//
// Renders EXACTLY three sections, ALWAYS (D-03): Needs you / Working / Idle.
// Rows are partitioned by the WORKER `group` field (R2 — NO client-side re-sort
// or re-derivation; the worker already sorted blocked→stale→idle→reviewing→
// running and assigned each row's group). An empty group still renders its
// header + count + a muted "— none —" line (D-03: a zero in any bucket is
// itself a signal).
//
// At the END of the Needs-you section the <BlockedBacklogExpander> folds in the
// residual org-backlog + the critical-path narrative as one drill-down (R6).
//
// This replaces the Phase 8 flat strip. It does NOT re-sort, re-group, or
// filter — it only partitions by row.group preserving worker order.

import * as React from 'react';

import { EmployeeRow, type SituationEmployeeRow, type EmployeeGroup } from './employee-row.tsx';
import { BlockedBacklogExpander } from './blocked-backlog-expander.tsx';
import type { OrgBlockedBacklog } from './org-blocked-backlog-banner-types.ts';

type EmployeeRowStripProps = {
  employees: SituationEmployeeRow[];
  companyPrefix: string;
  companyId: string;
  userId: string;
  navigate: (to: string) => void;
  /** Force-refetch the snapshot after assign/stand-down/resume so the row
   *  visibly re-groups (the mockup's live behavior). */
  onAssignSuccess: () => void;
  /** Org-backlog + critical-path, folded into the Needs-you expander (R6). */
  orgBacklog: OrgBlockedBacklog | null | undefined;
  criticalPathNarrative?: string | null;
};

const GROUP_META: Record<
  EmployeeGroup,
  { title: string; meta: string; emptyNote: string }
> = {
  needs_you: {
    title: 'Needs you',
    meta: 'blocked & ownerless work — act here',
    emptyNote: 'Nothing stuck — the board is clear.',
  },
  working: {
    title: 'Working',
    meta: 'in motion — for your awareness',
    emptyNote: 'No agents currently working.',
  },
  idle: {
    title: 'Idle',
    meta: 'unused capacity — assign or stand down',
    emptyNote: 'No idle agents.',
  },
};

const GROUP_ORDER: EmployeeGroup[] = ['needs_you', 'working', 'idle'];

export function EmployeeRowStrip({
  employees,
  companyPrefix,
  companyId,
  userId,
  navigate,
  onAssignSuccess,
  orgBacklog,
  criticalPathNarrative,
}: EmployeeRowStripProps): React.ReactElement {
  // Partition by worker group, preserving worker order within each group
  // (R2 — no .sort()).
  const byGroup: Record<EmployeeGroup, SituationEmployeeRow[]> = {
    needs_you: [],
    working: [],
    idle: [],
  };
  for (const row of employees) {
    // Defensive: a row whose group is missing/unknown degrades into idle so it
    // is never dropped from the board (it would otherwise vanish).
    const g: EmployeeGroup =
      row.group === 'needs_you' || row.group === 'working' || row.group === 'idle'
        ? row.group
        : 'idle';
    byGroup[g].push(row);
  }

  return (
    <section data-testid="clarity-employee-strip" className="clarity-employee-strip">
      {GROUP_ORDER.map((group) => {
        const rows = byGroup[group];
        const meta = GROUP_META[group];
        return (
          <div
            key={group}
            className={`clarity-group-section clarity-group-${group}`}
            data-group={group}
          >
            <header className="clarity-group-header">
              <h2 className="clarity-group-title">{meta.title}</h2>
              <span className="clarity-group-count">{`${rows.length}`}</span>
              <span className="clarity-group-rule" aria-hidden="true" />
              <span className="clarity-group-meta">{meta.meta}</span>
            </header>

            {rows.length === 0 ? (
              <p className="clarity-group-empty">{`— none — ${meta.emptyNote}`}</p>
            ) : (
              <div className="clarity-group-rows">
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

            {/* R6 — the merged backlog/critical-path expander lives at the END
             *  of the Needs-you section only. */}
            {group === 'needs_you' ? (
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
