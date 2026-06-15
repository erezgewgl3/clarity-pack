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
// Plan 02-09 Task 2 — DEV-15-STRUCTURAL: viewer identity now comes from
// useResolvedUserId() (Better-Auth-backed) instead of context.userId / a
// `userId ?? ''` fallback. Detail-tab slots returned null userId until
// authApi.getSession() resolved, which made opt-in-guard fail-closed for
// issue.reader (the wrapped handler returned OPT_IN_REQUIRED, the inner
// data shape was the error object, and every downstream component crashed
// reading data.refCards / data.acItems / etc).
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
import { usePluginData, useHostLocation } from '@paperclipai/plugin-sdk/ui/hooks';
import type { PluginDetailTabProps } from '@paperclipai/plugin-sdk/ui';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { ClaritySurfaceHeader } from '../../primitives/clarity-surface-header.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
// Plan 04.2-01 — the URL-prefix parser is re-imported separately so the
// reader-view-null-context.test.mjs single-import grep for useResolvedCompanyId
// stays exact (it pins `import { useResolvedCompanyId } from ...`).
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { useOptIn } from '../../primitives/use-opt-in.ts';
import { EnableClarityCta } from '../../components/enable-clarity-cta.tsx';

import { TldrStrip } from './tldr-strip.tsx';
// Plan 18-03 Task 3 (LEG-03) — the deterministic done-regex + the confirm-gated
// honest-divergence affordance. The Reader already has data.tldr.body in hand
// (no new DB read); the needsYou verdict is lifted up from LiveBlockerPanel's
// existing fetch via its onVerdict callback.
import { looksDone } from '../../../shared/looks-done.ts';
import { LooksDoneAffordance } from '../situation-room/looks-done-affordance.tsx';
// Plan 04.2-01 (RCB-01) — the Reader-header Continue-in-chat primitive.
import { ContinueInChatButton } from './continue-in-chat-button.tsx';
// Plan 04.2-01 (RCB-06) — the Reader-header reverse-topics list.
import { ReverseTopicsLink, type ReverseTopic } from './reverse-topics-link.tsx';
import { Breadcrumb, type Ancestry } from './breadcrumb.tsx';
import { ProseWithRefChips } from './prose-with-ref-chips.tsx';
import { AnchoredToCards } from './ref-card.tsx';
import { DeliverablePreview } from './deliverable-preview.tsx';
import { AcChecklist, type AcItem, type AcAutoStatusMap } from './ac-checklist.tsx';
import { ActivityTimeline, type ActivityEvent } from './activity-timeline.tsx';
import { LiveBlockerPanel } from './live-blocker-panel.tsx';
import { PauseBanner } from './pause-banner.tsx';
// Plan 05-05 (D-06 + D-07) — generic paused-agent banner shared with chat.
// Renders at the TOP of the Reader surface (above the header-actions row);
// the editor-only PauseBanner above stays mounted at the FOOTER and is
// unchanged (its literal is locked by reader-view.test.mjs).
import { AgentPauseBanner } from '../../primitives/agent-pause-banner.tsx';
// Overnight 2026-05-28 — per-section error containment. One bad section
// degrades to "Section unavailable" instead of throwing into the host's
// PluginSlotErrorBoundary and wiping the entire Reader tab. BEAAA-828 +
// repro on BEAAA-142/141/125/138/682/79 showed the host boundary catching
// a Clarity-side throw and rendering "Clarity Pack: failed to render" with
// EVERY section blanked. Per-section boundaries close that wide blast radius.
import { SectionErrorBoundary } from '../../primitives/error-boundary.tsx';
// Scroll-stability fix (2026-05-29) — pure selector that keeps the last-good
// payload mounted across a background TL;DR poll so scroll isn't reset. See
// reader-render-state.ts for the full root-cause writeup.
import { resolveReaderData } from './reader-render-state.ts';
import type { RefCardData, TLDR } from '../../../shared/types.ts';

// View-driven rework — while a TL;DR is compiling, poll issue.reader this often,
// for up to this long, then stop (the agent's result lands within seconds-to-a-minute).
const TLDR_POLL_INTERVAL_MS = 6_000;
const TLDR_POLL_WINDOW_MS = 90_000;

export type ReaderViewData = {
  tldr: TLDR | null;
  /** View-driven rework — 'compiling' tells the Reader to poll for the fresh TL;DR;
   *  'paused' shows a resume-the-agent note; 'unavailable' shows the honest empty
   *  state. Optional for back-compat with a cached pre-rework payload. */
  tldrStatus?: 'cached' | 'compiling' | 'paused' | 'unavailable';
  /** True when the TL;DR summarized a truncated (very long) task — surfaced as a note. */
  tldrTruncated?: boolean;
  refCards: RefCardData[];
  ancestry: Ancestry | null;
  acItems: AcItem[];
  activity: ActivityEvent[];
  // documentKey = the REAL host key (deliverable-preview dispatches documents.get
  // on it; the title 404s). Optional for back-compat with older cached payloads.
  deliverable: { filename: string; last_write_at: string | null; documentKey?: string } | null;
  issueBody: string | null;
  /** Plan 04.2-01 (RCB-06) — chat topics started FROM this issue. Optional so
   *  a pre-04.2-01 cached issue.reader payload still satisfies the type;
   *  the ReverseTopicsLink treats absent/empty identically (renders nothing). */
  topicsForIssue?: ReverseTopic[];
};

export function ReaderView({ context }: PluginDetailTabProps): React.ReactElement {
  // Per SDK PluginDetailTabProps, context.entityId is statically non-null
  // for detail-tab slots — host guarantees it. context.userId previously
  // mirrored useHostContext().userId here (which is null in detail-tab slots
  // during the host's authApi.getSession() loading window) — Plan 02-09
  // replaces that read with useResolvedUserId() inside the inner component.
  // companyId likewise comes from the resolver hook because for detail-tab
  // slots the host's PluginSlotMount may pass `issue.companyId` which is
  // undefined while the issue query is in flight (02-03c-HOST-CONTEXT.md §1).
  const entityId = context.entityId;

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
  return <ReaderViewOptedIn entityId={entityId} />;
}

function ReaderViewOptedIn({
  entityId,
}: {
  entityId: string;
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
    />
  );
}

// Inner component — renders ONLY when companyId is a real UUID. This split
// keeps usePluginData's params shape stable across renders (issueId +
// companyId always non-empty), so the bridge cache key stays consistent.
function ReaderViewWithCompany({
  entityId,
  companyId,
}: {
  entityId: string;
  companyId: string;
}): React.ReactElement {
  // Plan 02-09 Task 2 — DEV-15-STRUCTURAL closure: viewer identity sourced
  // from the resolver hook. In detail-tab slots useHostContext().userId is
  // null until authApi.getSession() resolves (02-03c-HOST-CONTEXT.md §1);
  // useResolvedUserId() short-circuits when the host bridge has a real id
  // and otherwise fetches /api/auth/get-session (Better Auth) directly via
  // same-origin trusted-JS access. While the resolver is in flight, we
  // render the loading placeholder rather than firing issue.reader with an
  // empty userId (the pre-02-09 pattern that fail-closed opt-in-guard).
  const { userId, loading: userIdLoading, error: userIdError } = useResolvedUserId();

  if (userIdLoading) {
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-loading">Resolving viewer identity…</p>
      </ClaritySurfaceRoot>
    );
  }

  if (userIdError === 'no-user-context' || !userId) {
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-error" data-clarity-error="no-user-context">
          Reader view unavailable — could not identify the active user.
          Reload the page to retry; if it persists, sign out and back in.
        </p>
      </ClaritySurfaceRoot>
    );
  }

  return (
    <ReaderViewReady entityId={entityId} companyId={companyId} userId={userId} />
  );
}

// Final inner component — renders ONLY when companyId + userId are both
// real strings. usePluginData's params shape stays stable across renders.
function ReaderViewReady({
  entityId,
  companyId,
  userId,
}: {
  entityId: string;
  companyId: string;
  userId: string;
}): React.ReactElement {
  // Plan 04.2-01 (RCB-01) — the company URL prefix for the Continue-in-chat
  // deep link (/<prefix>/chat). Detail-tab slots never receive companyPrefix
  // in the host context (02-03c-HOST-CONTEXT.md §1), so it is parsed from the
  // pathname — the same source useResolvedCompanyId derives its prefix from.
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';

  // Plan 04.2-07 (D-02 popover lift) — parent-owned picker state. When the
  // Continue button resolves to the 'existing-topics-ambiguous' route, it
  // calls onRequestPickerOpen with the assignee id; this state flips the
  // ReverseTopicsLink popover into auto-open mode pre-filtered to same-
  // assignee candidates. Cleared either by clicking a popover row (handled
  // inside reverse-topics-link.tsx) or by re-clicking the Continue button.
  const [pickerRequest, setPickerRequest] = React.useState<{
    filterToAssignee: string | null;
  } | null>(null);

  // Plan 18-03 Task 3 (LEG-03) — the leaf blocker verdict lifted up from
  // LiveBlockerPanel's EXISTING flatten-blocker-chain fetch (no second Reader DB
  // read). Combined with looksDone(data.tldr.body) below to gate the confirm-
  // gated "Looks done — close it?" affordance: shown ONLY when the TL;DR reads
  // done AND the engine still says a person must act (needsYou). Null until the
  // panel reports → degrade-safe (no verdict yet → no affordance).
  const [blockerVerdict, setBlockerVerdict] = React.useState<{
    needsYou: boolean;
    leafIssueId: string | null;
    leafIssueUuid: string | null;
  } | null>(null);

  // Quick fix 260524-s2y (rc.6) — SDK 2026.512.0 has no manifest-side
  // `actions[].invalidates` field (verified: PaperclipPluginManifestV1 has
  // no `actions:` key; SDK type tree contains zero `invalidat*` occurrences).
  // `PluginDataResult.refresh` returned by `usePluginData` is the UI-side
  // primitive that delivers the equivalent post-mutation refetch. Both
  // `issue.reader` AND `reader.ac.autostatus` are refreshed on a successful
  // manual AC toggle because the auto-status caption derives from the same
  // row state — refreshing only `issue.reader` would leave the auto-status
  // caption stale until a manual nav-away.
  const { data: rawData, refresh } = usePluginData<ReaderViewData | { error: string }>('issue.reader', {
    issueId: entityId,
    companyId,
    userId,
  });
  // Plan 05-03 (DIST-03) — AC auto-status from comment-markers. Parallel
  // round-trip alongside issue.reader; the host bridge dedupes its own
  // cache key. While loading OR on a structured error response, we pass
  // null to <AcChecklist> so it falls back to the manual-only path (Phase 2
  // behaviour) — the indicator simply doesn't render until data arrives.
  const { data: acAutoData, refresh: refreshAcAuto } = usePluginData<
    { kind: 'acAutoStatus'; detections: AcAutoStatusMap } | { error: string }
  >('reader.ac.autostatus', {
    issueId: entityId,
    companyId,
    userId,
  });
  const acAutoStatus: AcAutoStatusMap | null =
    acAutoData && !('error' in acAutoData) && acAutoData.kind === 'acAutoStatus'
      ? acAutoData.detections
      : null;

  // Scroll-stability fix (2026-05-29) — usePluginData NULLS `data` + sets
  // loading=true for the in-flight window of EVERY refresh() (SDK
  // PluginDataResult contract). The TL;DR compile poll below calls refresh()
  // every few seconds, so without this the whole populated Reader unmounted to
  // the loading placeholder each tick — collapsing the page and snapping the
  // operator's scroll back to the top. Cache the last good payload (keyed to
  // THIS issue so a navigation never shows stale content) and keep rendering it
  // across a background refresh. See reader-render-state.ts for the full writeup.
  const cacheKey = `${companyId}:${entityId}`;
  const lastGoodRef = React.useRef<{ key: string; data: ReaderViewData } | null>(null);
  if (rawData && !('error' in rawData)) {
    lastGoodRef.current = { key: cacheKey, data: rawData as ReaderViewData };
  }
  const cachedLastGood =
    lastGoodRef.current && lastGoodRef.current.key === cacheKey ? lastGoodRef.current.data : null;
  const data = resolveReaderData<ReaderViewData>(rawData, cachedLastGood);

  // View-driven rework (2026-05-28) — while the TL;DR is compiling (the Reader
  // open kicked off the agent compile in issue.reader's valid scope), poll
  // issue.reader so the fresh TL;DR appears without a manual reload. Cache hits
  // report 'cached' and never enter this loop, so there is no recompile churn.
  // The cadence is driven by the EFFECTIVE payload's status so a background
  // refresh window (rawData momentarily null) doesn't thrash the interval.
  const tldrStatus = data?.tldrStatus;
  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;
  React.useEffect(() => {
    if (tldrStatus !== 'compiling') return undefined;
    const deadline = Date.now() + TLDR_POLL_WINDOW_MS;
    const id = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(id);
        return;
      }
      void refreshRef.current();
    }, TLDR_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tldrStatus]);

  if (!data) {
    // INITIAL load only (no fresh payload AND no cached one yet), or an
    // opt-in-guard short-circuit with no prior good payload. A BACKGROUND
    // refresh never lands here — resolveReaderData keeps the last-good payload
    // mounted, so the TL;DR poll no longer collapses the page or resets scroll.
    // Plan 04.2-01 — ContinueInChatButton is NOT rendered here: it mounts
    // only in the populated render below, so it never fires chat.openForIssue
    // before issue data + companyId + userId have all resolved (Task 4
    // Test 2 pins the absent-while-loading contract).
    return (
      <ClaritySurfaceRoot name="reader">
        <p className="clarity-reader-loading">Loading Reader view…</p>
      </ClaritySurfaceRoot>
    );
  }
  // Overnight 2026-05-28 — per-section error containment. EVERY Reader
  // sub-component is wrapped in a SectionErrorBoundary so a render-time
  // throw inside one section (e.g. the BEAAA-828 pathology where
  // ancestry.milestone.title is the entire 1k+ char issue body, or a
  // RefChip choking on a structurally-degraded resolve-refs payload) is
  // caught locally and degrades to an inline "Section unavailable"
  // caption — the other sections continue to render. Before this wrap, a
  // throw in any section propagated to the HOST's PluginSlotErrorBoundary
  // and rendered "Clarity Pack: failed to render", blanking the whole
  // tab. The wide blast radius — repro'd on BEAAA-828/142/141/125/138/682/79
  // — is closed here. `resetKey={entityId}` so a navigation to another
  // issue clears any prior error state on the next tick.
  return (
    <ClaritySurfaceRoot name="reader">
      <SectionErrorBoundary name="surface-header" resetKey={entityId}>
        <ClaritySurfaceHeader
          companyId={companyId}
          userId={userId}
          surface="reader"
        />
      </SectionErrorBoundary>
      <SectionErrorBoundary name="agent-pause-banner" resetKey={entityId}>
        <AgentPauseBanner companyId={companyId} agentId={null} />
      </SectionErrorBoundary>
      <div className="clarity-reader-header-actions" data-clarity-region="reader-header-actions">
        <SectionErrorBoundary name="continue-in-chat" resetKey={entityId}>
          <ContinueInChatButton
            issueId={entityId}
            companyId={companyId}
            userId={userId}
            companyPrefix={companyPrefix}
            issue={{ identifier: entityId, title: null }}
            onRequestPickerOpen={setPickerRequest}
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="reverse-topics" resetKey={entityId}>
          <ReverseTopicsLink
            companyPrefix={companyPrefix}
            topicsForIssue={data.topicsForIssue ?? []}
            entryPoint={pickerRequest ? 'continue-in-chat' : 'manual'}
            filterToAssignee={pickerRequest?.filterToAssignee ?? null}
            autoOpen={pickerRequest !== null}
          />
        </SectionErrorBoundary>
      </div>
      <SectionErrorBoundary name="breadcrumb" resetKey={entityId}>
        <Breadcrumb ancestry={data.ancestry} />
      </SectionErrorBoundary>
      {/* Quick 260531-b8w (003-B, sketch 003/index.html variant-b lines 237-274)
          — TL;DR-first, no-rail single column. The TL;DR briefing leads
          (already first after breadcrumb); the relocated LiveBlockerPanel
          follows it as a full-width inline "on-you" banner; Acceptance +
          Deliverable cards come next; the raw body + activity collapse behind a
          "Show full task" disclosure. The plugin's own right rail (the old
          .clarity-reader-body grid + .clarity-reader-rail aside) is GONE — host
          Properties owns the right side. */}
      <SectionErrorBoundary name="tldr" resetKey={entityId}>
        <TldrStrip tldr={data.tldr} status={data.tldrStatus} truncated={data.tldrTruncated} />
      </SectionErrorBoundary>
      {/* Plan 18-03 Task 3 (LEG-03) — the confirm-gated honest-divergence
          affordance, beside the TL;DR. Shown ONLY when the TL;DR body reads done
          (looksDone) AND the engine still says a person must act
          (blockerVerdict.needsYou) AND a leaf id is available to close. Degrade-
          safe: missing TL;DR body OR no verdict yet OR agreeing inputs → absent
          (no false prompt). No new Reader DB read — data.tldr.body is in hand and
          the verdict is lifted from the panel's existing fetch. leafIssueUuid is
          dispatch-only (NO_UUID_LEAK); leafIssueId is the only displayed key. */}
      {looksDone(data.tldr?.body) &&
      blockerVerdict?.needsYou === true &&
      blockerVerdict.leafIssueId ? (
        <SectionErrorBoundary name="looks-done" resetKey={entityId}>
          <div className="clarity-reader-looks-done" data-clarity-region="reader-looks-done">
            <LooksDoneAffordance
              leafIssueId={blockerVerdict.leafIssueId}
              leafIssueUuid={blockerVerdict.leafIssueUuid ?? undefined}
              companyId={companyId}
              userId={userId}
              onClosed={() => { void refresh(); }}
            />
          </div>
        </SectionErrorBoundary>
      ) : null}
      {/* 003-C on-you banner (sketch 003 lines 81-88 + usage line 308). The
          relocated LiveBlockerPanel renders full-width in the column directly
          under the briefing. LiveBlockerPanel already returns null when there
          is no live blocker, so the "only when it has a live blocker" rule is
          satisfied by construction — the wrapper just gives the panel block-
          level full-width placement when it IS present. */}
      <div className="clarity-reader-onyou">
        <SectionErrorBoundary name="live-blocker" resetKey={entityId}>
          <LiveBlockerPanel issueId={entityId} onVerdict={setBlockerVerdict} />
        </SectionErrorBoundary>
      </div>
      <div className="clarity-reader-column">
        <SectionErrorBoundary name="anchored-to" resetKey={entityId}>
          <AnchoredToCards cards={data.refCards} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="ac-checklist" resetKey={entityId}>
          <AcChecklist issueId={entityId} items={data.acItems} userId={userId} autoStatus={acAutoStatus} onMutated={() => { void refresh(); void refreshAcAuto(); }} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="deliverable" resetKey={entityId}>
          <DeliverablePreview
            deliverable={data.deliverable}
            companyId={companyId}
            userId={userId}
            issueId={entityId}
          />
        </SectionErrorBoundary>
        {/* 003-B disclosure (sketch 003 lines 264-274) — the raw task body is no
            longer always-visible; it collapses behind "Show full task" along
            with the activity timeline. Both keep their own SectionErrorBoundary
            wraps. The literal "Show full task" is pinned by must_haves.contains. */}
        <details className="clarity-reader-disclosure">
          <summary>Show full task</summary>
          <SectionErrorBoundary name="prose" resetKey={entityId}>
            <ProseWithRefChips body={data.issueBody} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="activity" resetKey={entityId}>
            <ActivityTimeline events={data.activity} />
          </SectionErrorBoundary>
        </details>
      </div>
      <SectionErrorBoundary name="pause-banner" resetKey={entityId}>
        <PauseBanner />
      </SectionErrorBoundary>
    </ClaritySurfaceRoot>
  );
}
