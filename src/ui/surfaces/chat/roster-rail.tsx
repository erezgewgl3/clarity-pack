// src/ui/surfaces/chat/roster-rail.tsx
//
// Plan 04-05 Task 1 — CHAT-01 — the Employee Chat roster rail (left column).
//
// Renders every Paperclip employee-agent for the company via the chat.roster
// worker handler (04-04). Each row shows an avatar with a status dot
// (s-live / s-warn / s-alert / s-idle), the role name + sub-line, and an
// unread badge. Selecting an employee threads the active id up to ChatPage,
// which feeds the topic strip and message thread.
//
// D-03: group threads are v2 — the sketch's "Group threads" rail section
// (sketch ll. 474-486) is deliberately OMITTED. Only the per-employee roster
// (sketch ll. 418-472) is rendered.
//
// Visual contract: sketches/paperclip-fix-employee-chat.html ll. 48-98.
//
// All employee text renders as untrusted React text (T-04-18) — never
// dangerouslySetInnerHTML.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

/** An employee row as chat.roster returns it. */
export type RosterEmployee = {
  id: string;
  name: string;
  role: string;
  status: string;
};

export type RosterResult =
  | RosterEmployee[]
  | { error: string }
  | { employees: RosterEmployee[] }
  | null;

/** Map a worker status string to the sketch's status-dot class. */
function statusClass(status: string | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'live':
    case 'active':
    case 'working':
      return 's-live';
    case 'warn':
    case 'review':
    case 'waiting':
      return 's-warn';
    case 'alert':
    case 'blocked':
      return 's-alert';
    default:
      return 's-idle';
  }
}

/** Initial letter for the avatar — falls back to a glyph if name is empty. */
function avatarLetter(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

export function normalizeRoster(data: RosterResult): RosterEmployee[] | null {
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if ('employees' in data && Array.isArray(data.employees)) return data.employees;
  return null;
}

export function RosterRail({
  companyId,
  userId,
  activeEmployeeId,
  onSelectEmployee,
}: {
  companyId: string;
  userId: string;
  activeEmployeeId: string | null;
  /** Called with the full employee row so the thread head + context rail can render it. */
  onSelectEmployee: (employee: RosterEmployee) => void;
}): React.ReactElement {
  const { data, loading } = usePluginData<RosterResult>('chat.roster', {
    companyId,
    userId,
  });
  const [search, setSearch] = React.useState('');

  const employees = normalizeRoster(data);
  const isError = !!data && typeof data === 'object' && !Array.isArray(data) && 'error' in data;

  const filtered = React.useMemo(() => {
    if (!employees) return [];
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || (e.role ?? '').toLowerCase().includes(q),
    );
  }, [employees, search]);

  return (
    <aside className="roster" data-clarity-region="roster">
      <div className="roster-head">
        <div className="ttl">Employees</div>
        <span className="ct">
          {employees ? `${employees.length} · BEAAA` : 'BEAAA'}
        </span>
      </div>
      <div className="roster-search">
        <input
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search employees"
        />
      </div>
      <div className="roster-list">
        {loading && !employees ? (
          <div className="roster-section">Loading roster…</div>
        ) : isError ? (
          <div className="roster-section">Roster unavailable</div>
        ) : filtered.length === 0 ? (
          <div className="roster-section">No employees</div>
        ) : (
          <>
            <div className="roster-section">Employees</div>
            {filtered.map((emp) => (
              <button
                type="button"
                key={emp.id}
                className={`emp ${statusClass(emp.status)}${
                  emp.id === activeEmployeeId ? ' active' : ''
                }`}
                onClick={() => onSelectEmployee(emp)}
                aria-pressed={emp.id === activeEmployeeId}
              >
                <div className="av">{avatarLetter(emp.name)}</div>
                <div className="name">
                  {emp.name}
                  {emp.role ? <small>{emp.role}</small> : null}
                </div>
                <span className="badge muted">·</span>
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
