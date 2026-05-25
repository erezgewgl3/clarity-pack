// src/ui/surfaces/archive/archive-page.tsx
//
// Plan 05-08 (D-15 + D-16) — Archive full-view page.
//
// Lives at `/<companyPrefix>/archive` (NOT `/clarity-pack/archive` — see
// project memory `clarity-pack-plugin-page-routes`; the host resolves the
// page-slot's `routePath: 'archive'` against the company prefix).
//
// Three-gate composition mirrors bulletin/index.tsx + chat/index.tsx:
//   useOptIn          -> opted-out renders <EnableClarityCta surfaceName="Archive">
//   useResolvedCompanyId -> unresolved renders the error fallback
//   useResolvedUserId    -> unresolved renders the error fallback
// then fetches chat.archivedTopics with no employeeAgentId (company-scoped
// listing, per Plan 05-08 Task 2 extension).
//
// D-15: full-screen list, bulk-select checkboxes, search by title +
// employee filter, bookmarkable.
// D-16: bulk-unarchive fires chat.topic.bulkUnarchive, then toasts
// "N topics unarchived" — NO confirmation modal regardless of N (the action
// is reversible per CTT-07 invariant; reversible actions don't earn
// confirmations).
//
// All text renders as untrusted React text — never dangerouslySetInnerHTML.
// SPA navigation via useHostNavigation().linkProps (Open button). No raw
// <a href>. NO_UUID_LEAK: employee names resolved via chat.roster; no
// rendered row shows a raw UUID.

import * as React from 'react';
import {
  usePluginAction,
  usePluginData,
} from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginPageProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { useToast } from '../../primitives/toast.tsx';
import { useHostNavigation } from '../../primitives/use-host-navigation.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';
import {
  normalizeRoster,
  type RosterEmployee,
  type RosterResult,
} from '../chat/roster-rail.tsx';
import { buildTopicDeepLink } from '../chat/deep-link.mjs';

type ArchivedTopicRow = {
  topicIssueId: string;
  topicId: string;
  title: string;
  employeeAgentId: string;
  messageCount: number;
  lastActiveAt: string;
  archivedAt: string | null;
  pinnedAt: string | null;
};

type ArchivedTopicsResult =
  | { kind: 'archivedTopics'; topics: ArchivedTopicRow[] }
  | { error: string }
  | null;

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const dms = Date.now() - t;
  if (dms < 0) return 'just now';
  const m = Math.floor(dms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export function ArchivePage(_props?: PluginPageProps): React.ReactElement {
  // OPTIN — gate BEFORE resolution.
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="archive">
        <p className="clarity-archive-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="archive">
        <EnableClarityCta surfaceName="Archive" />
      </ClaritySurfaceRoot>
    );
  }
  return <ArchivePageOptedIn />;
}

function ArchivePageOptedIn(): React.ReactElement {
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();
  const { userId, loading: userLoading, error: userError } = useResolvedUserId();

  if (companyLoading || userLoading) {
    return (
      <ClaritySurfaceRoot name="archive">
        <p className="clarity-archive-loading">Resolving context…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (companyError || !companyId) {
    return (
      <ClaritySurfaceRoot name="archive">
        <p className="clarity-archive-error" data-clarity-error="no-company-context">
          Archive unavailable — could not identify the active company.
        </p>
      </ClaritySurfaceRoot>
    );
  }
  if (userError || !userId) {
    return (
      <ClaritySurfaceRoot name="archive">
        <p className="clarity-archive-error" data-clarity-error="no-user-context">
          Archive unavailable — could not identify the current user.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ClaritySurfaceRoot name="archive">
      <ArchivePageBody companyId={companyId} userId={userId} />
    </ClaritySurfaceRoot>
  );
}

function ArchivePageBody({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}): React.ReactElement {
  const { showToast } = useToast();
  const nav = useHostNavigation();
  const bulkUnarchive = usePluginAction('chat.topic.bulkUnarchive');

  const [refreshKey, setRefreshKey] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [employeeFilter, setEmployeeFilter] = React.useState<string>('all');
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [working, setWorking] = React.useState(false);

  const { data: rawArchived, refresh: refreshArchived } =
    usePluginData<ArchivedTopicsResult>('chat.archivedTopics', {
      companyId,
      userId,
      _refreshKey: refreshKey,
      // Note: NO employeeAgentId — company-scoped listing per Plan 05-08
      // Task 2 extension.
    });

  const { data: rosterData } = usePluginData<RosterResult>('chat.roster', {
    companyId,
    userId,
  });

  const roster: RosterEmployee[] = normalizeRoster(rosterData) ?? [];
  const employeeNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const e of roster) m.set(e.id, e.name);
    return m;
  }, [roster]);

  const archivedTopics: ArchivedTopicRow[] = React.useMemo(() => {
    if (
      !rawArchived ||
      typeof rawArchived !== 'object' ||
      !('kind' in rawArchived) ||
      rawArchived.kind !== 'archivedTopics'
    ) {
      return [];
    }
    return rawArchived.topics;
  }, [rawArchived]);

  // Derive the company-prefix for the Open links. The host route is
  // `/<companyPrefix>/archive`; we are mounted at that prefix so the prefix
  // is the first non-empty path segment.
  const companyPrefix = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    const segs = window.location.pathname.split('/').filter(Boolean);
    return segs[0] ?? '';
  }, []);

  const filtered = React.useMemo(() => {
    let rows = archivedTopics;
    if (employeeFilter !== 'all') {
      rows = rows.filter((r) => r.employeeAgentId === employeeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((r) => (r.title ?? '').toLowerCase().includes(q));
    }
    return rows;
  }, [archivedTopics, employeeFilter, searchQuery]);

  const toggleSelected = React.useCallback((topicIssueId: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(topicIssueId)) next.delete(topicIssueId);
      else next.add(topicIssueId);
      return next;
    });
  }, []);

  const toggleSelectAll = React.useCallback(() => {
    setSelected((curr) => {
      if (curr.size === filtered.length) return new Set();
      return new Set(filtered.map((r) => r.topicIssueId));
    });
  }, [filtered]);

  const handleBulkUnarchive = React.useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setWorking(true);
    try {
      const result = await bulkUnarchive({
        companyId,
        userId,
        topicIssueIds: ids,
      });
      const updated =
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: unknown }).ok === true &&
        typeof (result as unknown as { updated: unknown }).updated === 'number'
          ? (result as unknown as { updated: number }).updated
          : ids.length;
      showToast({ message: `${updated} topics unarchived` });
      setSelected(new Set());
      setRefreshKey((k) => k + 1);
      void refreshArchived?.();
    } catch {
      showToast({ message: 'Bulk unarchive failed — try again' });
    } finally {
      setWorking(false);
    }
  }, [selected, bulkUnarchive, companyId, userId, showToast, refreshArchived]);

  const handleOpenTopic = React.useCallback(
    (row: ArchivedTopicRow) => {
      const link = buildTopicDeepLink(
        companyPrefix,
        row.topicIssueId,
        row.employeeAgentId,
      );
      if (link && link.to) {
        nav.navigate(link.to);
      }
    },
    [companyPrefix, nav],
  );

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0;

  return (
    <div data-clarity-region="archive-page">
      <header className="clarity-archive-header">
        <h1>Archive</h1>
        <span className="clarity-archive-count">
          {archivedTopics.length} archived
          {archivedTopics.length !== filtered.length
            ? ` · ${filtered.length} shown`
            : ''}
        </span>
      </header>

      <div className="clarity-archive-toolbar">
        <input
          type="text"
          placeholder="Search archived topics by title…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search archived topics by title"
        />
        <label htmlFor="clarity-archive-employee-filter" className="sr-only">
          Filter by employee
        </label>
        <select
          id="clarity-archive-employee-filter"
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          aria-label="Filter by employee"
        >
          <option value="all">All employees</option>
          {roster.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {archivedTopics.length === 0 ? (
        <div className="clarity-archive-empty">
          No archived topics. Topics you archive will appear here.
        </div>
      ) : filtered.length === 0 ? (
        <div className="clarity-archive-empty">
          No archived topics match your search.
        </div>
      ) : (
        <>
          <div className="clarity-archive-list" data-clarity-region="archive-list">
            <div
              className="clarity-archive-row"
              data-clarity-archive-row="header"
              role="row"
            >
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                aria-label="Select all archived topics"
              />
              <span className="clarity-archive-row__title">Title</span>
              <span />
              <span className="clarity-archive-row__employee">Employee</span>
              <span className="clarity-archive-row__when">Archived</span>
              <span />
            </div>
            {filtered.map((row) => {
              const employeeName =
                employeeNameById.get(row.employeeAgentId) ?? 'unassigned';
              const isSelected = selected.has(row.topicIssueId);
              return (
                <div
                  key={row.topicIssueId}
                  className="clarity-archive-row"
                  data-clarity-archive-row={row.topicIssueId}
                  role="row"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(row.topicIssueId)}
                    aria-label={`Select archived topic ${row.title}`}
                  />
                  <div className="clarity-archive-row__title" title={row.title}>
                    {row.title}
                  </div>
                  <div className="clarity-archive-row__pin" aria-hidden="true">
                    {row.pinnedAt ? '📌' : ''}
                  </div>
                  <div className="clarity-archive-row__employee">
                    {employeeName}
                  </div>
                  <div className="clarity-archive-row__when">
                    {relativeTime(row.archivedAt ?? row.lastActiveAt)}
                  </div>
                  <button
                    type="button"
                    className="clarity-archive-row__open"
                    onClick={() => handleOpenTopic(row)}
                    aria-label={`Open archived topic ${row.title}`}
                  >
                    Open
                  </button>
                </div>
              );
            })}
          </div>

          {someSelected ? (
            <div
              className="clarity-archive-bulk-bar"
              data-clarity-region="archive-bulk-bar"
              role="region"
              aria-label="Bulk actions"
            >
              <span className="clarity-archive-bulk-bar__count">
                Selected ({selected.size})
              </span>
              <button
                type="button"
                onClick={() => void handleBulkUnarchive()}
                disabled={working}
                data-clarity-action="bulk-unarchive"
              >
                {working ? 'Unarchiving…' : 'Unarchive'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
