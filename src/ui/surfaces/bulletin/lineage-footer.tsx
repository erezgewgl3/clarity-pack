// src/ui/surfaces/bulletin/lineage-footer.tsx
//
// Plan 03-03 — BULL-04 lineage footer. Mirrors situation-room/critical-path-strip.tsx
// (chain-renderer pattern).
//
// Renders each LineageThread as an 8-column node grid with arrow connectors
// (CSS ::before) and a terminal node inverted paper-on-ink. A thread with
// truncatedCount > 0 appends a "…and N more steps" tail node — the grouper
// already caps node.length at 8, so the UI never renders > 8 nodes.
//
// Plan 07-05 (Phase 7 ITEM 5):
//   - D-I5-04: the heading reframes the misleading "ONE ARTIFACT, END-TO-END"
//     claim to a count-aware label ("Work in motion — N threads").
//   - D-I5-02: each thread shows a one-line plain-English gloss (or a quiet
//     "Gloss pending…" note when null — NOT an error).
//   - D-I5-03: each thread carries TWO affordances — open the issue
//     (/<prefix>/issues/<identifier>) + "open chat with owner" via the reused
//     ROOM-09 buildChatDeepLink employee-only carrier (mirrors the 07-03 banner).
//
// SECURITY (T-07-05-XSS / NO_UUID_LEAK): all visible text renders as React text
// nodes (React escapes them); this footer never uses React's raw-HTML escape
// hatch. The owner agent id (ownerAgentId) + the issue entityId are carried only
// as link targets — NEVER rendered as visible text.
//
// Visual contract: sketches/paperclip-fix-bulletin.html ll. 444-457.

import * as React from 'react';
import { useHostLocation, useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';

import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { buildChatDeepLink } from '../chat/deep-link.mjs';
import type { LineageThread } from '../../../shared/types.ts';

export type LineageFooterProps = {
  threads: LineageThread[];
};

export function LineageFooter(props: LineageFooterProps): React.ReactElement | null {
  const threads = props.threads ?? [];
  const { pathname } = useHostLocation();
  const { navigate } = useHostNavigation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';

  if (threads.length === 0) return null;

  const openIssue = (identifier: string | null | undefined): void => {
    if (!identifier) return;
    navigate(`/${companyPrefix}/issues/${identifier}`);
  };

  const openChatWithOwner = (ownerAgentId: string | null | undefined): void => {
    if (!ownerAgentId) return;
    const deepLink = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: ownerAgentId,
    });
    if (deepLink) navigate(deepLink.to);
  };

  // D-I5-04 — count-aware label (the old "one artifact" copy falsely claimed one
  // while showing many). Reads honestly whether there is 1 thread or many.
  const heading =
    threads.length === 1
      ? 'Work in motion — 1 thread'
      : `Work in motion — ${threads.length} threads`;

  return (
    <section className="clarity-bulletin-lineage-foot" data-clarity-region="lineage-footer">
      <h2 className="clarity-bulletin-lineage-foot-h2">{heading}</h2>
      {threads.map((thread) => (
        <LineageThreadRow
          key={thread.id}
          thread={thread}
          onOpenIssue={openIssue}
          onOpenChat={openChatWithOwner}
        />
      ))}
    </section>
  );
}

function LineageThreadRow({
  thread,
  onOpenIssue,
  onOpenChat,
}: {
  thread: LineageThread;
  onOpenIssue: (identifier: string | null | undefined) => void;
  onOpenChat: (ownerAgentId: string | null | undefined) => void;
}): React.ReactElement {
  const nodes = thread.nodes ?? [];
  const gloss = typeof thread.gloss === 'string' && thread.gloss.trim().length > 0 ? thread.gloss : null;
  const hasIssue = typeof thread.identifier === 'string' && thread.identifier.length > 0;
  const hasOwner = typeof thread.ownerAgentId === 'string' && thread.ownerAgentId.length > 0;

  return (
    <div className="clarity-bulletin-thread-wrap">
      <div className="clarity-bulletin-thread">
        {nodes.map((node, i) => (
          <div
            key={`${thread.id}-${i}`}
            className={
              node.isTerminal
                ? 'clarity-bulletin-node clarity-bulletin-node-terminal'
                : 'clarity-bulletin-node'
            }
          >
            <div className="clarity-bulletin-node-time">{node.time}</div>
            <div className="clarity-bulletin-node-name">{node.name}</div>
            <div className="clarity-bulletin-node-detail">{node.detail}</div>
          </div>
        ))}
        {thread.truncatedCount > 0 ? (
          <div className="clarity-bulletin-node clarity-bulletin-node-more">
            <div className="clarity-bulletin-node-name">
              …and {thread.truncatedCount} more {thread.truncatedCount === 1 ? 'step' : 'steps'}
            </div>
          </div>
        ) : null}
      </div>

      {/* D-I5-02 — one-line gloss, or a quiet pending note (never an error). */}
      {gloss ? (
        <p className="clarity-bulletin-thread-gloss">{gloss}</p>
      ) : (
        <p className="clarity-bulletin-thread-gloss clarity-bulletin-thread-gloss--pending">
          Gloss pending…
        </p>
      )}

      {/* D-I5-03 — two affordances: open issue + open chat with owner. */}
      <div className="clarity-bulletin-thread-actions">
        <button
          type="button"
          className="clarity-bulletin-thread-action"
          onClick={() => onOpenIssue(thread.identifier)}
          disabled={!hasIssue}
          title={hasIssue ? undefined : 'No linked issue identifier'}
        >
          Open issue
        </button>
        <button
          type="button"
          className="clarity-bulletin-thread-action clarity-bulletin-thread-action-chat"
          onClick={() => onOpenChat(thread.ownerAgentId)}
          disabled={!hasOwner}
          title={hasOwner ? undefined : 'No owner to chat with — assign first'}
        >
          Open chat with owner
        </button>
      </div>
    </div>
  );
}
