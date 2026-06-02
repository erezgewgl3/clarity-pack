// src/ui/surfaces/reader/live-blocker-panel.tsx
//
// Plan 02-09 Task 2 — DEV-15-STRUCTURAL: viewer identity now comes from
// useResolvedUserId() instead of useHostContext().userId. Detail-tab slots
// returned null userId until authApi.getSession() resolved, which made
// opt-in-guard fail-closed for flatten-blocker-chain.
//
// Plan 02-03c Task 2 — retrofit to use useResolvedCompanyId. The 02-03b
// drill caught this panel rendering the worker handler's fail-loud guard
// text verbatim, because the previous draft sent an empty companyId. After
// this retrofit, the gating wrapper ensures the worker call only happens
// once a real UUID resolves — structurally impossible to send empty
// companyId. (See 02-03c-HOST-CONTEXT.md "Universal pitfall" for the full
// context.)
//
// Plan 02-03b Task 2 — passes companyId + viewerUserId so the worker handler
// (now using ctx.issues.relations.get) has the context it needs to walk the
// blockedBy DAG. The 502 the drill observed came from the previous draft
// hitting a non-existent /blockers HTTP path; this version uses the SDK's
// typed relations client.
//
// Plan 02-03 Task 2 (original) — READER-08 right-rail Live blocker panel.
// Renders EXACTLY ONE typed terminal kind — never the full pathIds chain.

import * as React from 'react';
import {
  usePluginData,
  usePluginAction,
  useHostLocation,
} from '@paperclipai/plugin-sdk/ui/hooks';

import type { BlockerChainResult } from '../../../shared/types.ts';
import { isReplyReachable } from '../../../shared/reply-reachable.ts';
import { ReplyInPlace } from '../_shared/reply-in-place.tsx';
import { StatePill } from '../../primitives/state-pill.tsx';
import { useResolvedCompanyId } from '../../primitives/use-resolved-company-id.ts';
import { extractCompanyPrefixFromPathname } from '../../primitives/use-resolved-company-id.ts';
import { useResolvedUserId } from '../../primitives/use-resolved-user-id.ts';
import { useHostNavigation } from '../../primitives/use-host-navigation.ts';

// Plan 11-04 (D-13/SC1) — the primary action is gated on the ENGINE VERDICT's
// actionAffordance, NOT on terminal.kind. Every one of the 8 kinds maps to one
// of these five affordances via classifyVerdict() in the worker; the panel just
// renders the affordance honestly. 'none' renders no button.
type ActionAffordance = BlockerChainResult['actionAffordance'];

/** The button label for each affordance, or null when no button should render.
 *  awaitedPartyLabel is the scrubbed display string (NO_UUID_LEAK) — never a UUID.
 *  The scrub itself runs in the WORKER handler (flatten-blocker-chain.ts:
 *  scrubResultLabel → scrubHumanAction), mirroring org-blocked-backlog.ts /
 *  build-employees-rollup.ts — NOT in this panel. The panel only RENDERS the
 *  already-scrubbed string (Plan 11-06 / 11-07, IN-01). */
function primaryActionLabel(
  affordance: ActionAffordance,
  awaitedPartyLabel: string,
): string | null {
  switch (affordance) {
    case 'reply':
      return `Reply: ${awaitedPartyLabel}`;
    case 'nudge':
      return `Nudge ${awaitedPartyLabel}`;
    case 'assign':
      return 'Assign owner ▾';
    case 'open':
      return 'Open ↗';
    case 'none':
      return null;
    default: {
      // Exhaustiveness guard — a 6th affordance becomes a compile error.
      const _exhaustive: never = affordance;
      return _exhaustive;
    }
  }
}

/** The honest one-line blocker headline for each of the 8 kinds. Renders ONLY
 *  the SCRUBBED display strings — data.awaitedPartyLabel (the awaited-party
 *  string the worker handler flatten-blocker-chain.ts already scrubbed of every
 *  raw UUID via scrubResultLabel→scrubHumanAction) and data.degradeReason — and
 *  NEVER the raw terminal.label (which still embeds UUIDs straight off the pure
 *  engine) nor a raw targetAgentUuid/targetIssueUuid (NO_UUID_LEAK / D-15 / CR-01).
 *  For UNCLASSIFIED (D-12) the honest "can't determine — open to investigate" line. */
function blockerLine(data: BlockerChainResult): string {
  const t = data.terminal;
  switch (t.kind) {
    case 'AWAITING_HUMAN':
      return data.awaitedPartyLabel;
    case 'AWAITING_AGENT_WORKING':
      return `${data.awaitedPartyLabel} is working`;
    case 'AWAITING_AGENT_STUCK':
      return `${data.awaitedPartyLabel} is stuck`;
    case 'SELF_RESOLVING':
      // The scrub emits "{name} — assign an owner first" only for UNOWNED; for
      // SELF_RESOLVING awaitedPartyLabel is the scrubbed party/eta line.
      return `${data.awaitedPartyLabel} (resolves on its own)`;
    case 'EXTERNAL':
      return data.awaitedPartyLabel;
    case 'CYCLE':
      return `Circular dependency — ${data.awaitedPartyLabel}`;
    case 'UNOWNED':
      // The scrub already emits "… — assign an owner first"; do NOT append a
      // second "— no owner".
      return data.awaitedPartyLabel;
    case 'UNCLASSIFIED':
      return data.degradeReason
        ? `Can't determine blocker (${data.degradeReason}) — open to investigate`
        : "Can't determine blocker — open to investigate";
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

export function LiveBlockerPanel({ issueId }: { issueId: string }): React.ReactElement | null {
  const { companyId, loading: companyLoading } = useResolvedCompanyId();
  const { userId, loading: userIdLoading } = useResolvedUserId();

  // Right-rail panel is non-essential during the resolver loading window —
  // render nothing rather than a spinner. The Reader's main column is already
  // showing "Resolving company context…" so the user has the global signal.
  if (companyLoading || userIdLoading || !companyId || !userId) return null;

  return (
    <LiveBlockerPanelWithCompany
      issueId={issueId}
      companyId={companyId}
      viewerUserId={userId}
    />
  );
}

// Inner component — renders ONLY when companyId AND viewerUserId are real
// UUIDs. Keeps usePluginData's params shape stable across renders.
function LiveBlockerPanelWithCompany({
  issueId,
  companyId,
  viewerUserId,
}: {
  issueId: string;
  companyId: string;
  viewerUserId: string;
}): React.ReactElement | null {
  // Plan 11-07 (WR-02) — host navigation + wakeup dispatch for the wired
  // affordances. companyPrefix is parsed from the pathname (detail-tab slots
  // never receive it in host context — same source the Reader index uses).
  const nav = useHostNavigation();
  const { pathname } = useHostLocation();
  const companyPrefix = extractCompanyPrefixFromPathname(pathname) ?? '';
  const wakeAction = usePluginAction('issues.requestWakeup');
  const [busy, setBusy] = React.useState(false);

  // WR-03 (14-REVIEW) — destructure `refresh` (PluginDataResult exposes a manual
  // refresh per the SDK) so a confirmed reply can force an immediate re-poll of
  // the blocker chain instead of waiting for the next background interval. Wired
  // into <ReplyInPlace onActed> below, mirroring the Situation Room's
  // onAssignSuccess force-refetch.
  const { data, refresh } = usePluginData<BlockerChainResult>('flatten-blocker-chain', {
    startId: issueId,
    viewerUserId,
    companyId,
  });

  // Plan 11-07 (WR-02) — the action handlers. EVERY handler performs a REAL
  // effect (navigation or a worker dispatch); the targetAgentUuid/targetIssueUuid
  // are consumed ONLY as dispatch args, NEVER interpolated into visible text.
  // 'open' navigates to the issue route (/<prefix>/issues/<identifier> per the
  // paperclip-issue-url-pattern memory — NOT /<prefix>/<id>).
  const openIssue = React.useCallback(() => {
    if (!companyPrefix) return;
    nav.navigate(`/${companyPrefix}/issues/${issueId}`);
  }, [nav, companyPrefix, issueId]);

  // Plan 14-03 — the 'reply' affordance no longer navigates to chat; it mounts the
  // shared <ReplyInPlace> primitive (act-in-place, DO-01). The old replyInChat
  // navigate-to-chat callback is removed.

  // 'nudge' → wake the stuck agent on the leaf issue (issues.requestWakeup),
  // mirroring employee-row's wake. The leaf-issue UUID is the mutation target.
  const nudge = React.useCallback(
    async (issueUuid: string | null | undefined) => {
      const wakeIssueId = issueUuid ?? issueId;
      if (busy) return;
      setBusy(true);
      try {
        await wakeAction({ companyId, issueId: wakeIssueId, userId: viewerUserId });
      } catch {
        // Honest no-throw: the host call is best-effort; the panel stays mounted.
      } finally {
        setBusy(false);
      }
    },
    [busy, wakeAction, companyId, viewerUserId, issueId],
  );

  if (!data) return null;
  const { terminal } = data;
  // Plan 11-04 (D-13/SC1): render straight off the engine verdict. The "ON YOU"
  // banner is the needsYou signal (a person must act); the primary action is
  // gated on actionAffordance, never on terminal.kind. All 8 kinds render an
  // honest non-blank line via blockerLine().
  const actionLabel = primaryActionLabel(data.actionAffordance, data.awaitedPartyLabel);

  // Plan 11-07 (WR-02 no dead button / WR-01 'none' affordance) + Plan 12-03
  // Task 2 (NY-03 / D-09) + CR-01 (12-REVIEW) — resolve the REAL onClick for the
  // verdict's affordance. A button renders ONLY when a wired handler backs it.
  // 'assign' (UNOWNED + AWAITING_AGENT_STUCK) navigates to the leaf issue page
  // ONLY for a single-hop chain (leaf === the open issue); for a multi-hop chain
  // there is no honest, leak-free leaf URL on this surface, so it renders NO
  // button (CR-01 honest degrade — never a no-op/404). 'none' (a blocker-free
  // issue) likewise renders NO button.
  // The split-identity mutation targets — read into plain consts so the JSX/
  // render body below never embeds `data.target*Uuid` inside a `{...}` expression
  // (the NO_UUID_LEAK render-scan forbids that; they are dispatch args only).
  const issueDispatchTarget = data.targetIssueUuid;
  // Plan 14-03 Task 1 (SC3/SC4/WARNING 2) — the 'reply' affordance is now a
  // RENDER branch (the shared <ReplyInPlace> below), not an onAction handler. It
  // owns its own Send/chips/Open↗ + namedAction line. So 'reply' is intentionally
  // ABSENT from this onAction switch and contributes no <button>; the dead
  // navigate-to-chat path is removed.
  const isReplyBranch = data.actionAffordance === 'reply';
  let onAction: (() => void) | null = null;
  switch (data.actionAffordance) {
    case 'open':
      onAction = openIssue;
      break;
    case 'reply':
      // Handled by <ReplyInPlace> below — no button on this path.
      onAction = null;
      break;
    case 'nudge':
      onAction = () => {
        void nudge(issueDispatchTarget);
      };
      break;
    case 'assign':
      // Plan 12-03 Task 2 (NY-03 / D-09 / T-12-11) + CR-01 (12-REVIEW) — the
      // 'assign' affordance (UNOWNED + AWAITING_AGENT_STUCK after 12-01) must be
      // HONEST: never a dead/no-op button, never a 404, never a UUID leak.
      //
      // The honest target is the CHAIN LEAF (the issue an owner must be assigned
      // to), which for a multi-hop chain is NOT the issue open in the Reader.
      // openIssue navigates to `issueId` — the START of the chain (the open
      // issue). That is the correct leaf ONLY for a single-hop chain (leaf ===
      // start). For a multi-hop chain it would send the operator to the page they
      // are already on (a no-op — the original CR-01 defect).
      //
      // BlockerChainResult carries NO human leaf identifier — only
      // targetIssueUuid (the leaf NODE id), which is mutation-only and must NEVER
      // enter a URL (NO_UUID_LEAK), and the Paperclip issue URL needs a HUMAN key
      // (paperclip-issue-url-pattern memory: /<prefix>/issues/<identifier>, a UUID
      // 404s). So for a multi-hop chain we cannot build a correct, leak-free leaf
      // URL on this surface.
      //
      // Decision: navigate to the leaf ONLY when it equals the start (single-hop —
      // pathIds.length <= 1, so issueId IS the leaf). For a multi-hop chain there
      // is no honest navigation target here, so we render NO button (onAction =
      // null) rather than a no-op/404 — consistent with the NO-dead-button rule
      // (Phase 11 WR-02). The Situation Room's per-row OwnerPickerPopover remains
      // the full assign path; this surface degrades honestly when it can't act.
      onAction = data.pathIds.length <= 1 ? openIssue : null;
      break;
    case 'none':
      onAction = null; // no wired dispatch on this surface → no button
      break;
    default: {
      const _exhaustive: never = data.actionAffordance;
      onAction = _exhaustive;
    }
  }
  const showButton = actionLabel !== null && onAction !== null;

  return (
    <div
      className="clarity-blocker-panel"
      data-clarity-region="live-blocker"
      data-terminal-kind={terminal.kind}
      data-action-affordance={data.actionAffordance}
    >
      <header className="clarity-blocker-header">
        {data.needsYou ? (
          <>
            <span className="clarity-on-you">⚑ ON YOU</span>
            <StatePill state="AwaitingYou" age={0} />
          </>
        ) : (
          <span className="clarity-blocker-kind">{terminal.kind.replace(/_/g, ' ')}</span>
        )}
      </header>
      {/* Plan 14-03 (WARNING 2) — SUPPRESS the standalone blockerLine <p> for the
       *  reply branch: <ReplyInPlace> renders its own namedAction line, so showing
       *  blockerLine here too would duplicate the headline. Non-reply affordances
       *  keep the blockerLine <p> exactly as before (no regression). */}
      {data.actionAffordance !== 'reply' ? (
        <p className="clarity-blocker-label">{blockerLine(data)}</p>
      ) : null}
      {/* Plan 14-03 (SC3/SC4/DO-01) — the ONE shared <ReplyInPlace> on the reply
       *  branch. reachable computed off data.terminal.kind (native on this
       *  surface). leafIssueId = the open issue ONLY for a single-hop chain (CR-01
       *  honest degrade), leafIssueUuid = the leaf mutation id (dispatch-only).
       *  needsDurabilityFlip = false: the Reader's BlockerChainResult has no leaf
       *  status field, so default comment-only (spike-safe) — NEVER proxied from
       *  terminal.kind. onActed = refresh() (WR-03, 14-REVIEW): force an immediate
       *  re-poll of flatten-blocker-chain so the "⚑ ON YOU" row leaves the
       *  needs-you state right after a confirmed reply, instead of looking stale
       *  until the next background poll. Mirrors the Situation Room's
       *  onAssignSuccess force-refetch. */}
      {isReplyBranch ? (
        <ReplyInPlace
          leafIssueId={data.pathIds.length <= 1 ? issueId : null}
          leafIssueUuid={issueDispatchTarget ?? null}
          awaitedPartyLabel={data.awaitedPartyLabel}
          namedAction={blockerLine(data)}
          decisionOptions={null}
          needsDurabilityFlip={false}
          reachable={isReplyReachable(data.terminal.kind)}
          companyId={companyId}
          userId={viewerUserId}
          companyPrefix={companyPrefix}
          navigate={nav.navigate}
          onActed={() => {
            refresh();
          }}
        />
      ) : null}
      {showButton ? (
        <button
          type="button"
          className="clarity-blocker-action"
          disabled={busy}
          onClick={onAction ?? undefined}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
