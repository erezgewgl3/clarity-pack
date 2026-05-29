// src/ui/surfaces/chat/archive-panel.tsx
//
// Plan 04.1-08 — NEW component. Dropdown panel anchored to the +N archived
// pill at the right end of the topic strip. REPLACES the Plan 04.1-06
// inline-reveal pattern (which scrolled the archived rows into the strip
// itself). Sketch contract: paperclip-fix-chat-true-task.html ll. 755-805.
//
// Behavior:
//   - Each row is a semantic <button> with click-to-open (NOT the same as
//     unarchive — opening loads the topic in READ-ONLY state with the
//     ArchivedBanner up top).
//   - Hover surfaces an `Unarchive` button at the row's right edge; its
//     onClick uses event.stopPropagation() so the row's own onClick never
//     fires (would otherwise navigate then un-archive).
//   - Real-time search filters by title (case-insensitive substring; no
//     debounce — list is small).
//   - Empty state: when archivedTopics is empty, render only the header +
//     the "No archived topics" line. No search, no footer.
//   - Footer: "Showing N of M" + "View all archived →" — Plan 05-08 D-15
//     replaces the Plan 04.1-08 console-warn no-op stub with a real
//     navigation to /<companyPrefix>/archive via useHostNavigation. The
//     parent threads companyPrefix as a prop.
//   - Escape key closes; click outside the panel closes.
//
// SECURITY (T-04-18): all rendered fields (title, employeeName, dates) come
// from chat.archivedTopics worker data — bare React text rendering only, no
// dangerouslySetInnerHTML. No raw fetch.

import * as React from 'react';
import { useHostNavigation } from '../../primitives/use-host-navigation.ts';

/** A single archived topic as chat.archivedTopics returns it. */
export type ArchivedTopic = {
  topicIssueId: string;
  topicId: string; // CHT-NN
  title: string;
  employeeName: string;
  messageCount: number;
  lastActiveAt: string; // ISO
  archivedAt: string; // ISO
};

/** Best-effort "{n}d ago" / "{n}w ago" / "{n}mo ago" relative time. */
function relativeTime(iso: string): string {
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

/** Short YYYY-MM-DD from an ISO string; empty if unparseable. */
function shortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function ArchivePanel({
  open,
  archivedTopics,
  onClose,
  onOpenTopic,
  onUnarchive,
  companyPrefix,
}: {
  open: boolean;
  archivedTopics: ArchivedTopic[];
  onClose: () => void;
  onOpenTopic: (topicIssueId: string) => void;
  onUnarchive: (topicIssueId: string) => void;
  /** Plan 05-08 D-15 — drives the View-all link's navigation target. */
  companyPrefix?: string;
}): React.ReactElement | null {
  const [searchQuery, setSearchQuery] = React.useState('');
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const nav = useHostNavigation();

  // Reset search when the panel reopens — a stale query feels wrong.
  React.useEffect(() => {
    if (open) setSearchQuery('');
  }, [open]);

  // Escape closes; outside-click closes.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent): void => {
      const node = panelRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer the click-outside listener so the click that OPENED the panel
    // does not immediately close it. setTimeout(0) is sufficient.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  // Rules of hooks: useMemo MUST run on EVERY render, BEFORE any conditional
  // return. (2026-05-29 crash fix — this useMemo previously sat BELOW the early
  // `!open` return-null guard, so the hook count jumped 5→6 when the panel opened
  // and React threw "Rendered more hooks than during the previous render"; the
  // host PluginSlotErrorBoundary surfaced it as "Clarity Pack failed to render"
  // and the whole chat blanked when the +N archived pill was clicked.)
  const totalCount = archivedTopics.length;
  const filtered = React.useMemo(() => {
    if (!searchQuery.trim()) return archivedTopics;
    const q = searchQuery.toLowerCase();
    return archivedTopics.filter((t) => (t.title ?? '').toLowerCase().includes(q));
  }, [archivedTopics, searchQuery]);

  // Early return AFTER all hooks have run — safe.
  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="chat-archive-panel"
      role="dialog"
      aria-label="Archived topics"
      data-clarity-region="archive-panel"
    >
      <div className="chat-archive-panel__head">
        <h4>Archived topics</h4>
        <button
          type="button"
          className="chat-archive-panel__close"
          onClick={onClose}
          aria-label="Close archive panel"
        >
          ✕
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="chat-archive-panel__empty">
          No archived topics. Topics you archive will appear here.
        </div>
      ) : (
        <>
          <div className="chat-archive-panel__search">
            <input
              type="text"
              placeholder="Search archived topics by title…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search archived topics"
              autoFocus
            />
          </div>

          <div className="chat-archive-panel__list">
            {filtered.map((t) => (
              <button
                type="button"
                key={t.topicIssueId}
                className="chat-archive-panel__row"
                onClick={() => onOpenTopic(t.topicIssueId)}
                aria-label={`Open archived topic ${t.title} in read-only mode`}
                data-clarity-archive-topic-issue-id={t.topicIssueId}
              >
                <div className="chat-archive-panel__row-content">
                  <div className="chat-archive-panel__row-title">{t.title}</div>
                  <div className="chat-archive-panel__row-sub">
                    <span>{t.employeeName}</span>
                    <span className="sep">·</span>
                    <span>{t.messageCount} messages</span>
                    <span className="sep">·</span>
                    <span>last active {relativeTime(t.lastActiveAt)}</span>
                    <span className="sep">·</span>
                    <span>archived {shortDate(t.archivedAt)}</span>
                  </div>
                  <div className="chat-archive-panel__row-hint">
                    ↵ Click to open · read-only
                  </div>
                </div>
                {/* event.stopPropagation so the row's own onClick (open in
                    read-only) never fires when the operator wants to UN-archive
                    directly from the panel hover. */}
                <button
                  type="button"
                  className="chat-archive-panel__unarchive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnarchive(t.topicIssueId);
                  }}
                  aria-label={`Unarchive ${t.title}`}
                >
                  Unarchive
                </button>
              </button>
            ))}
          </div>

          <div className="chat-archive-panel__foot">
            <span>
              Showing {filtered.length} of {totalCount}
            </span>
            {/* Plan 05-08 (D-15) — View-all link navigates to the new full
                archive page at /<companyPrefix>/archive. Replaces the Plan
                04.1-08 console-warn no-op stub. SCAF-09 + no-raw-anchor —
                use useHostNavigation(), never raw <a href>. */}
            <button
              type="button"
              onClick={() => {
                if (companyPrefix) {
                  onClose();
                  nav.navigate(`/${companyPrefix}/archive`);
                }
              }}
              disabled={!companyPrefix}
              data-clarity-archive-view-all="full"
            >
              View all archived →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
