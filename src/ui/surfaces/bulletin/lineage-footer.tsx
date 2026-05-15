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
// Visual contract: sketches/paperclip-fix-bulletin.html ll. 444-457.

import * as React from 'react';
import type { LineageThread } from '../../../shared/types.ts';

export type LineageFooterProps = {
  threads: LineageThread[];
};

export function LineageFooter(props: LineageFooterProps): React.ReactElement | null {
  const threads = props.threads ?? [];
  if (threads.length === 0) return null;
  return (
    <section className="clarity-bulletin-lineage-foot" data-clarity-region="lineage-footer">
      <h2 className="clarity-bulletin-lineage-foot-h2">One artifact, end-to-end</h2>
      {threads.map((thread) => (
        <LineageThreadRow key={thread.id} thread={thread} />
      ))}
    </section>
  );
}

function LineageThreadRow({ thread }: { thread: LineageThread }): React.ReactElement {
  const nodes = thread.nodes ?? [];
  return (
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
  );
}
