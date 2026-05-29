// src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx
//
// Plan 07-03 Task 2 (Phase 7 ITEM 4) — the ORG-LEVEL blocked-backlog banner.
//
// D-I4-01 (placement): a TOP-OF-ROOM banner ("N blocked · M need you") that
// EXPANDS to a full panel with the backlog list. The agent grid below is
// unchanged — this banner is the org-truth surface that makes the Situation
// Room honest about what is actually blocked.
//
// D-I4-02 (row content): each row = issue TITLE + the single flattened human
// action (the terminal label from the worker builder) + owner display NAME
// (NEVER a UUID — NO_UUID_LEAK) + age.
//
// D-I4-03 (click): TWO affordances per row — (a) open the issue
// (/<prefix>/issues/<identifier>), (b) "open chat with <owner>" reusing the
// ROOM-09 buildChatDeepLink employee-only carrier (URL_HASH `#h=` payload that
// survives the live host).
//
// D-I4-04 (scope/order): the worker builder already ranked HUMAN_ACTION_ON-
// first + capped at 15 + computed total/overflow; this UI just renders the
// result and shows the "top X of N" footer when overflow.
//
// SECURITY (T-07-03-XSS): all visible text renders as React text nodes (React
// escapes them). This banner never uses React's raw-HTML escape hatch (the
// inner-HTML prop). The owner UUID (ownerAgentId) is carried only as the
// chat-deep-link target — never rendered as visible text.

import * as React from 'react';
import { useHostLocation, useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';

import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { formatAge } from '../../primitives/state-pill-format.ts';
import { buildChatDeepLink } from '../chat/deep-link.mjs';

/** The flattener's locked sentinel for an unowned HUMAN_ACTION_ON terminal
 *  (src/shared/blocker-chain.ts:178). An unowned row gets no live chat link. */
const UNOWNED_SENTINEL = '__unowned__';

/** Mirror of the worker builder's OrgBlockedRow (src/worker/handlers/
 *  org-blocked-backlog.ts). Kept structural here so the UI bundle does not
 *  import worker types. */
export type OrgBlockedRow = {
  issueId: string;
  identifier: string;
  title: string;
  humanAction: string;
  terminalKind: string;
  ownerName: string | null;
  ownerAgentId: string | null;
  age_ms: number | null;
};

export type OrgBlockedBacklog = {
  rows: OrgBlockedRow[];
  total: number;
  blocked_count: number;
  need_you_count: number;
  overflow: boolean;
};

export function OrgBlockedBacklogBanner({
  backlog,
  companyId: _companyId,
}: {
  backlog: OrgBlockedBacklog | null | undefined;
  companyId: string;
}): React.ReactElement | null {
  const { pathname } = useHostLocation();
  const { navigate } = useHostNavigation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';

  const blockedCount = backlog?.blocked_count ?? 0;
  const needYouCount = backlog?.need_you_count ?? 0;

  // D-I4 — auto-expand when there is at least one human-action-on-you item so
  // the operator sees the backlog immediately; otherwise start collapsed.
  const [expanded, setExpanded] = React.useState(needYouCount > 0);

  // Nothing to surface — render nothing (no empty banner noise).
  if (!backlog || blockedCount === 0) {
    return null;
  }

  const openIssue = (identifier: string): void => {
    if (!identifier) return;
    navigate(`/${companyPrefix}/issues/${identifier}`);
  };

  const openChatWithOwner = (ownerAgentId: string | null): void => {
    if (!ownerAgentId || ownerAgentId === UNOWNED_SENTINEL) return;
    const deepLink = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: ownerAgentId,
    });
    if (deepLink) navigate(deepLink.to);
  };

  return (
    <section className="clarity-blocked-banner" data-clarity-region="org-blocked-backlog">
      <button
        type="button"
        className="clarity-blocked-banner-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="clarity-blocked-banner-headline">
          <span className="clarity-blocked-banner-count">{blockedCount} blocked</span>
          <span className="clarity-blocked-banner-sep"> · </span>
          <span className="clarity-blocked-banner-needyou">{needYouCount} need you</span>
        </span>
        <span className="clarity-blocked-banner-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded ? (
        <div className="clarity-blocked-panel">
          <ul className="clarity-blocked-list">
            {backlog.rows.map((row) => {
              const hasLiveOwner =
                !!row.ownerAgentId && row.ownerAgentId !== UNOWNED_SENTINEL;
              const ownerLabel = row.ownerName ?? 'Unassigned';
              return (
                <li key={row.issueId} className="clarity-blocked-row" data-terminal-kind={row.terminalKind}>
                  <div className="clarity-blocked-row-main">
                    <span className="clarity-blocked-row-title">{row.title}</span>
                    <span className="clarity-blocked-row-action">{row.humanAction}</span>
                  </div>
                  <div className="clarity-blocked-row-meta">
                    <span className="clarity-blocked-row-owner">{ownerLabel}</span>
                    {row.age_ms != null ? (
                      <span className="clarity-blocked-row-age">blocked {formatAge(row.age_ms)}</span>
                    ) : null}
                  </div>
                  <div className="clarity-blocked-row-actions">
                    <button
                      type="button"
                      className="clarity-blocked-row-btn"
                      onClick={() => openIssue(row.identifier)}
                    >
                      Open issue
                    </button>
                    <button
                      type="button"
                      className="clarity-blocked-row-btn clarity-blocked-row-btn-chat"
                      onClick={() => openChatWithOwner(row.ownerAgentId)}
                      disabled={!hasLiveOwner}
                      title={hasLiveOwner ? undefined : 'No owner to chat with — assign first'}
                    >
                      {`Open chat with ${hasLiveOwner ? ownerLabel : 'owner'}`}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {backlog.overflow ? (
            <p className="clarity-blocked-overflow">
              {`Showing top ${backlog.rows.length} of ${backlog.total} blocked`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
