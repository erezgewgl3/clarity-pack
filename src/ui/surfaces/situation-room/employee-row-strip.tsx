// src/ui/surfaces/situation-room/employee-row-strip.tsx
//
// Plan 08-02 Task 1 (Phase 8 people-first cockpit) — ROOM-13.
//
// The ordered list of <EmployeeRow>. The worker (Plan 08-01) already sorted the
// `employees` array blocked→stale→idle→reviewing→running; this strip consumes
// that order VERBATIM — it does NOT re-sort or filter (Test 8 invariant). When
// the array is empty it renders an inline "No employees in scope" placeholder
// instead of an empty list (degraded states name themselves).

import * as React from 'react';

import { EmployeeRow, type SituationEmployeeRow } from './employee-row.tsx';

type EmployeeRowStripProps = {
  employees: SituationEmployeeRow[];
  companyPrefix: string;
  navigate: (to: string) => void;
};

export function EmployeeRowStrip({
  employees,
  companyPrefix,
  navigate,
}: EmployeeRowStripProps): React.ReactElement {
  return (
    <section
      data-testid="clarity-employee-strip"
      className="clarity-employee-strip"
    >
      {employees.length === 0 ? (
        <p className="clarity-employee-strip-empty">No employees in scope.</p>
      ) : (
        // Worker order consumed VERBATIM — no .sort(), no .filter().
        employees.map((row) => (
          <EmployeeRow
            key={row.agentId}
            row={row}
            companyPrefix={companyPrefix}
            navigate={navigate}
          />
        ))
      )}
    </section>
  );
}
