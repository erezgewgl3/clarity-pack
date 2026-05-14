// src/ui/surfaces/reader/index.tsx
//
// Plan 02-03c Task 2.5 (drill gap-fix) — primary 02-03b/02-03c drill defect
// root cause: ReaderView's prop signature was `{ entityId }: { entityId: string }`,
// but the host invokes slot components with `{ slot, context }` per
// `PluginSlotComponentProps` in ~/paperclip/ui/src/plugins/slots.tsx. entityId
// at the top level was ALWAYS undefined → issue.reader's `if (!issueId) return
// emptyResult()` silently returned empty for every render → cascading empty
// states. The previous "useHostContext().companyId returns null" diagnosis
// (02-03b) was correct but secondary; this prop-shape bug was the primary
// failure surfaced by flatten-blocker-chain's stricter fail-loud guard.
//
// Now reads from PluginDetailTabProps shape — context.entityId is statically
// non-null per SDK 2026.512.0 types.d.ts:197-203.
//
// Plan 02-03c Task 2 — retrofit to use the resolver hook so the detail-tab
// loading window (issue query in flight → useHostContext().companyId is null
// per 02-03c-HOST-CONTEXT.md Section 1) renders an explicit "Resolving
// company context…" placeholder instead of silently passing empty-string
// companyId to the worker.
//
// Plan 02-03b Task 2 — adds the companyId param to usePluginData. The
// worker handler at src/worker/handlers/issue-reader.ts now requires
// companyId in params (the SDK's ctx.issues.get / listComments /
// documents.list all take it as a positional arg).
//
// Plan 02-03 Task 2 (original) — ReaderView top-level layout matching
// sketches/paperclip-fix-task-detail.html. Renders the seven mockup elements
// + PauseBanner footer, wrapped in <ClaritySurfaceRoot name="reader"> for
// CSS scoping (SCAF-06). All reader data flows through the single
// usePluginData('issue.reader') call — PRIM-01 single round-trip on refs is
// enforced by the worker handler. The LiveBlockerPanel uses its own
// usePluginData('flatten-blocker-chain') call (independent cadence).

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginDetailTabProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

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
  deliverable: { filename: string; last_write_at: string | null } | null;
  issueBody: string | null;
};

export function ReaderView({ context }: PluginDetailTabProps): React.ReactElement {
  // Per SDK PluginDetailTabProps, context.entityId is statically non-null
  // for detail-tab slots — host guarantees it. context.userId mirrors
  // useHostContext().userId (same bridge value, just from the prop instead of
  // the hook). companyId comes from the resolver hook because for detail-tab
  // slots the host's PluginSlotMount may pass `issue.companyId` which is
  // undefined while the issue query is in flight (02-03c-HOST-CONTEXT.md §1).
  const entityId = context.entityId;
  const userId = context.userId;

  // Plan 02-04 Task 1 — OPTIN-02 gate. useOptIn() must be called BEFORE the
  // companyId resolver so opted-out users see the CTA even when companyId
  // resolution is still in flight (avoids confusing "Resolving company
  // context…" for users who shouldn't see anything Clarity-rendered).
  const { optedIn, loading: optInLoading } = useOptIn();

  if (optInLoading) {
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-loading">Loading Clarity Pack…</p>
      </ClaritySurfaceRoot>
    );
  }
  if (!optedIn) {
    return (
      <ClaritySurfaceRoot name="reader">
        <EnableClarityCta surfaceName="Reader" />
      </ClaritySurfaceRoot>
    );
  }

  // Plan 02-03c — companyId resolver hook gates the data fetch.
  // Hooks-rules safety: useResolvedCompanyId is called unconditionally below.
  return <ReaderViewOptedIn entityId={entityId} userId={userId} />;
}

function ReaderViewOptedIn({
  entityId,
  userId,
}: {
  entityId: string;
  userId: string | null;
}): React.ReactElement {
  const { companyId, loading: companyLoading, error: companyError } = useResolvedCompanyId();

  // Resolver in flight — render the explicit placeholder so users can see we
  // know we don't have context yet (vs blank surface or a cryptic error).
  if (companyLoading) {
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-loading">Resolving company context…</p>
      </ClaritySurfaceRoot>
    );
  }

  // Resolver settled with no company — surface an explicit error rather than
  // silently passing empty-string companyId to the worker (the 02-03b defect).
  // The "no-company-context" literal matches the resolver hook's error code.
  if (companyError === 'no-company-context' || !companyId) {
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-error" data-clarity-error="no-company-context">
          Reader view unavailable — could not identify the active company.
          Reload the page from a company URL (e.g. /COU/issues/COU-4) to retry.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  // Hooks-rules-compliant call: usePluginData runs unconditionally below.
  // Reaching this point means we have a non-null companyId UUID.
  return (
    <ReaderViewWithCompany
      entityId={entityId}
      companyId={companyId}
      userId={userId}
    />
  );
}

// Inner component — renders ONLY when companyId is a real UUID. This split
// keeps usePluginData's params shape stable across renders (issueId +
// companyId always non-empty), so the bridge cache key stays consistent.
function ReaderViewWithCompany({
  entityId,
  companyId,
  userId,
}: {
  entityId: string;
  companyId: string;
  userId: string | null;
}): React.ReactElement {
  // DEV-15-STRUCTURAL (drill 2026-05-14): opt-in-guard wraps `issue.reader`
  // and refuses callers whose params don't carry the viewer identity. Without
  // userId here, the guard returned {error:'OPT_IN_REQUIRED'} for opted-in
  // users, the UI received the error shape instead of ReaderViewData, every
  // downstream component crashed reading `.refCards`, `.acItems`, etc.
  // Thread the viewer identity explicitly. The guard accepts userId or the
  // legacy viewerUserId; we prefer the canonical name here.
  const { data, loading } = usePluginData<ReaderViewData | { error: string }>('issue.reader', {
    issueId: entityId,
    companyId,
    userId: userId ?? '',
  });
  if (loading || !data || 'error' in data) {
    // Loading state OR opt-in-guard short-circuited (no userId yet, or the
    // viewer is genuinely opted-out — in which case the surface gate above
    // this component already routes to the CTA, so we should never get here
    // with an OPT_IN_REQUIRED in practice).
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
          <AcChecklist issueId={entityId} items={data.acItems} userId={userId} />
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
