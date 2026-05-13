// src/ui/surfaces/reader/index.tsx
//
// Plan 02-03 Task 2 — ReaderView top-level layout matching
// sketches/paperclip-fix-task-detail.html. Renders the seven mockup elements
// + PauseBanner footer, wrapped in <ClaritySurfaceRoot name="reader"> for
// CSS scoping (SCAF-06).
//
// All data flows through the single usePluginData('issue.reader', ...) call —
// PRIM-01 single round-trip on refs is enforced by the worker handler. The
// LiveBlockerPanel uses its own usePluginData('flatten-blocker-chain') call
// because the blocker chain is independent of the reader payload (changes at
// a different cadence).

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';

import { TldrStrip } from './tldr-strip.tsx';
import { Breadcrumb, type Ancestry } from './breadcrumb.tsx';
import { ProseWithRefChips } from './prose-with-ref-chips.tsx';
import { AnchoredToCards } from './ref-card.tsx';
import { DeliverablePreview } from './deliverable-preview.tsx';
import { AcChecklist, type AcItem } from './ac-checklist.tsx';
import { ActivityTimeline, type ActivityEvent } from './activity-timeline.tsx';
import { LiveBlockerPanel } from './live-blocker-panel.tsx';
import { PauseBanner } from './pause-banner.tsx';
import type { RefCardData, TLDR } from '../../../shared/types.ts';

export type ReaderViewData = {
  tldr: TLDR | null;
  refCards: RefCardData[];
  ancestry: Ancestry | null;
  acItems: AcItem[];
  activity: ActivityEvent[];
  deliverable: { filename: string; last_write_at: string } | null;
  issueBody: string | null;
};

export function ReaderView({ entityId }: { entityId: string }): React.ReactElement {
  const { data, loading } = usePluginData<ReaderViewData>('issue.reader', {
    issueId: entityId,
  });
  if (loading || !data) {
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-loading">Loading Reader view…</p>
      </ClaritySurfaceRoot>
    );
  }
  return (
    <ClaritySurfaceRoot name="reader">
      <Breadcrumb ancestry={data.ancestry} />
      <TldrStrip tldr={data.tldr} />
      <div className="clarity-reader-body">
        <div className="clarity-reader-main">
          <ProseWithRefChips body={data.issueBody} />
          <AnchoredToCards cards={data.refCards} />
          <DeliverablePreview deliverable={data.deliverable} />
          <AcChecklist issueId={entityId} items={data.acItems} />
          <ActivityTimeline events={data.activity} />
        </div>
        <aside className="clarity-reader-rail">
          <LiveBlockerPanel issueId={entityId} />
        </aside>
      </div>
      <PauseBanner />
    </ClaritySurfaceRoot>
  );
}
