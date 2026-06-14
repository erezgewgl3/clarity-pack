// src/ui/surfaces/situation-room/employee-row.tsx
//
// Plan 09-02 Task 1 (R4 — the operator's headline rule: NO DEAD BUTTONS).
//
// A single per-agent row in the Situation Room. The row renders ONLY actions
// that actually perform — every button either fires a real worker action /
// navigation, or is ABSENT. No `disabled` action affordances, no empty-onClick
// no-ops (that was the Phase 8 sin this plan exists to fix).
//
// PER-STATE ACTION CLUSTERS (R4), keyed on the worker `group` field:
//   - needs_you, UNOWNED (blockerChain.actionAffordance === 'assign' — Plan 11-04
//     reads the engine verdict, NOT an ownerName string-match):
//       [Assign owner ▾] (owner-picker-popover → situation.assignOwner) + [Open <leaf> ↗]
//   - needs_you, OWNED (any other affordance — chat/wake the owner):
//       [Open chat: <owner>] (buildChatDeepLink employee-only) + [Wake] (issues.requestWakeup) + [Open ↗]
//   - working (running / reviewing):
//       focus line + "moving · no action needed" — NO buttons.
//   - idle, state idle:
//       [Assign work ▾] → buildChatDeepLink employee-only (brief the agent in chat).
//   - idle, state stale (not paused):
//       [Assign work ▾] + [Stand down] → confirm dialog → agents.pauseHeartbeat.
//   - paused (D-04, row.isPaused === true): stays in Idle with a "paused" marker
//       + [Resume] → agents.resumeHeartbeat, regardless of idle/stale substate.
//
// CONFIRM POSTURE (R7): Assign owner / Assign work apply immediately; Stand
// down asks first (a consequential pause).
//
// SECURITY (T-09-05 / NO_UUID_LEAK): every visible string is a React text node
// (no dangerouslySetInnerHTML). ownerAgentId / agentId are consumed only as
// buildChatDeepLink args / dispatch args, never rendered as text. The leaf-issue
// segment renders only when leafIssueId is non-null.
//
// This is a NORMAL typed React component, NOT a plugin slot-root — it takes its
// props directly.

import * as React from 'react';
import { usePluginAction } from '@paperclipai/plugin-sdk/ui/hooks';

import type { BlockerChainResult } from '../../../shared/types.ts';
import { isReplyReachable } from '../../../shared/reply-reachable.ts';
import { rescrubPersisted } from '../../../shared/scrub-human-action.ts';
import { formatAge } from '../../primitives/state-pill-format.ts';
import { useToast } from '../../primitives/toast.tsx';
import { ReplyInPlace } from '../_shared/reply-in-place.tsx';
import { buildChatDeepLink } from '../chat/deep-link.mjs';
import { buildReaderHref } from '../../primitives/reader-href.ts';
import { OwnerPickerPopover } from './owner-picker-popover.tsx';
import { LooksDoneAffordance } from './looks-done-affordance.tsx';
import { visualTierOf } from './tier-utils.ts';

/** DOM id stamped on the row root so the needs-you banner's [Assign first] can
 *  scroll to the oldest-unowned row and open its picker (mockup parity / R5). */
function rowDomId(agentId: string): string {
  return `clarity-room-row-${agentId}`;
}

// Mirror of the worker builder's SituationEmployeeRow
// (src/worker/situation/build-employees-rollup.ts — Plan 08-01 + 09-01). Kept
// structural here so the UI bundle does not import worker types.
export type EmployeeState =
  | 'running'
  | 'reviewing'
  | 'blocked'
  | 'idle'
  | 'stale'
  | 'unknown';
export type AgeBucket = 'fresh' | 'aging' | 'stale';

// Plan 09-01 worker field — the display group computed at the worker tier (R2).
export type EmployeeGroup = 'needs_you' | 'working' | 'idle';

export type SituationEmployeeRow = {
  agentId: string;
  name: string;
  role: string;
  state: EmployeeState;
  // Plan 09-01 — worker-assigned display group (R2). UI partitions by this
  // verbatim; it never re-derives group from state.
  group: EmployeeGroup;
  // Plan 09-01 (D-04) — paused marker from the agent's host status. Independent
  // of group: a paused row stays in Idle but shows the marker + Resume.
  isPaused: boolean;
  focusIssueId: string | null;
  focusLine: string | null;
  lastActivityAt: string | null;
  ageBucket: AgeBucket;
  blockerChain: {
    rootIssueId: string;
    // Human display key (BEAAA-NN) — the ONLY rendered identifier.
    leafIssueId: string | null;
    // Plan 09-04 (R3) — the leaf issue UUID (the mutation id). Fed to the
    // OwnerPickerPopover's leafIssueUuid prop; consumed only as a dispatch arg
    // (NO_UUID_LEAK / T-08-UI), never rendered as text.
    leafIssueUuid: string | null;
    humanAction: string;
    ownerName: string;
    // AGENT uuid (focusIssue.assigneeAgentId), NOT a USER uuid (B1).
    ownerAgentId: string | null;
    // Plan 11-04 (D-13/D-14, SC5) — the engine verdict. The row gates its
    // affordances off THESE, never an ownerName string-match. Mirrors the
    // worker rollup's blockerChain row shape (build-employees-rollup.ts).
    /** Plan 11-04 — true only when a *person* must act (AWAITING_HUMAN / UNOWNED). */
    needsYou: boolean;
    /** Plan 11-04 — cockpit segment: 'needs-you' | 'in-motion' | 'watch'. */
    tier: BlockerChainResult['tier'];
    /** Plan 11-04 — the single control the row offers; 'assign' ONLY for UNOWNED. */
    actionAffordance: BlockerChainResult['actionAffordance'];
    // Plan 11-04 (D-15 / NO_UUID_LEAK) — split identity. awaitedPartyLabel is the
    // ONLY rendered awaited-party string (scrubbed of UUIDs); the *Uuid fields are
    // mutation-only dispatch targets, NEVER rendered, mirroring leafIssueUuid.
    /** Plan 11-04 — rendered awaited-party display string; scrubbed, no raw UUID. */
    awaitedPartyLabel: string;
    /** Plan 11-04 — awaited agent UUID for the nudge/reply mutation; NEVER rendered. */
    targetAgentUuid: string | null;
    /** Plan 11-04 — leaf issue UUID for the open/assign mutation; NEVER rendered. */
    targetIssueUuid: string | null;
    // Plan 14-04 Task 1 (BLOCKER 5 / BLOCKER 2+4) — byte-parallel mirror of the
    // worker rollup's two new fields. isReplyReachable (14-02) + <ReplyInPlace>
    // (14-03) read THESE directly, never re-deriving from data.terminal.kind.
    /** Plan 14-04 — the leaf Terminal kind string the reachable predicate reads. */
    terminalKind: BlockerChainResult['terminal']['kind'];
    /** Plan 14-04 — the Shape-B durable-flip signal (true iff the leaf was
     *  status='blocked' at build time); passed to <ReplyInPlace>, NEVER rendered. */
    needsDurabilityFlip: boolean;
    /** Plan 11-04 (D-09) — set only on an honest UNCLASSIFIED degrade. */
    degradeReason?: string;
  } | null;
  /** Plan 18-03 Task 3 (LEG-03 / D-05/D-06/D-07) — the honest-divergence flag,
   *  set by the worker rollup (Task 2) ONLY when this row is needs-you AND its
   *  cached TL;DR reads as done. Drives the confirm-gated "Looks done — close it?"
   *  affordance. Optional + defaults absent (absent = false); degrade-safe. */
  looksDone?: boolean;
  // Plan 13-03 (D-13/D-14) — the Editor-Agent named-action card for this leaf,
  // attached by the situation.snapshot handler ONLY when fresh (13-02); null/
  // absent when stale or not yet generated → the row degrades to the
  // deterministic blockerChain line (D-12). Structurally mirrored here as the
  // DISPLAY fields ONLY (the UI bundle does NOT import worker/shared types).
  //
  // NO_UUID_LEAK by construction (D-10/D-14): the worker ActionCard's
  // sourceIssueUuid is INTENTIONALLY OMITTED from this mirror — it has no field
  // on the UI row, so it cannot be threaded into a render. decisionOptions is
  // carried (data) but NOT rendered as chips this phase (chips are Phase 14).
  actionCard?: {
    namedAction: string;
    awaitedParty: string;
    estBucket: 'quick' | 'focused' | 'deep' | (string & {});
    actionKind: 'answer' | 'decide' | 'assign' | 'none' | (string & {});
    decisionOptions: string[] | null;
  } | null;
  doneTodayCount: number;
};

/** Pure helper (D-09) — map the coarse estimate bucket to human display words.
 *  quick → "quick decision", focused → "~30-min review", deep → "deep work".
 *  Anything else (null / garbage bucket) → null so the row OMITS the estimate
 *  segment entirely — never a fabricated number (ACT-02 anti-false-precision). */
function estBucketLabel(bucket: string | null | undefined): string | null {
  switch (bucket) {
    case 'quick':
      return 'quick decision';
    case 'focused':
      return '~30-min review';
    case 'deep':
      return 'deep work';
    default:
      return null;
  }
}

type EmployeeRowProps = {
  row: SituationEmployeeRow;
  companyPrefix: string;
  companyId: string;
  userId: string;
  navigate: (to: string) => void;
  /** Force-refetch the snapshot so a row re-groups after an assign/stand-down/
   *  resume (the mockup's live behavior). */
  onAssignSuccess: () => void;
};

/** Pure helper: ISO timestamp → age in ms (null-safe). null/invalid → null,
 *  which formatAge renders as the "?" sentinel. */
function ageMsFromISO(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

export function EmployeeRow({
  row,
  companyPrefix,
  companyId,
  userId,
  navigate,
  onAssignSuccess,
}: EmployeeRowProps): React.ReactElement {
  const { showToast } = useToast();
  const wakeAction = usePluginAction('issues.requestWakeup');
  const pauseAction = usePluginAction('agents.pauseHeartbeat');
  const resumeAction = usePluginAction('agents.resumeHeartbeat');

  const [confirmingStandDown, setConfirmingStandDown] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const ageMs = ageMsFromISO(row.lastActivityAt);
  const chain = row.blockerChain;
  // Plan 11-04 (SC3/D-13) + Plan 12-03 Task 2 (NY-03 / D-05 / D-09) — the assign
  // cluster is gated STRICTLY on the engine verdict's affordance, never on an
  // ownerName string-match or a terminal.kind list. After 12-01,
  // actionAffordance === 'assign' fires for BOTH genuinely-unowned (UNOWNED) AND
  // stuck-agent (AWAITING_AGENT_STUCK) rows — re-owning the issue is the honest
  // answer for both. An AWAITING_HUMAN / AWAITING_AGENT_WORKING / UNCLASSIFIED
  // row never carries 'assign', so the picker never renders a false "assign
  // owner" for an in-motion or already-owned blocker. This is the SAME single
  // verdict the org-blocked backlog expander and Reader blocker panel read
  // (D-09: the three surfaces agree by construction).
  const showAssign = chain?.actionAffordance === 'assign';
  // Plan 14-03 Task 1 (SC3/SC4/DO-01) — the reply-in-place branch. Mutually
  // exclusive with showAssign: 'reply' (⇔ AWAITING_HUMAN per classifyVerdict) is
  // the ONLY affordance that mounts the shared <ReplyInPlace>; 'assign' (UNOWNED
  // + AWAITING_AGENT_STUCK, Phase 12 D-05) keeps the OwnerPickerPopover. The
  // reachable gate inside the primitive computes off chain.terminalKind (14-04),
  // so a defensive non-reachable reply row still degrades to named action + Open↗.
  const showReply = chain?.actionAffordance === 'reply';

  // Plan 15-03 Task 2 (COCK-02 / D-04 / D-05 / D-06) — the row BODY is gated on
  // the ENGINE visual tier, NOT row.group. This is the SAME locked partition the
  // <TierStrip> computes — both call the ONE shared visualTierOf (tier-utils.ts,
  // WR-02) so the strip's partition and this row's body variant can never
  // diverge. A stuck-agent row (group 'needs_you', tier 'watch') therefore gets
  // the QUIET Watch body, not the loud Needs-you cluster (12-CONTEXT D-04 lock).
  // Needs-you keeps the FULL Phase-13 action card + Phase-14 reply-in-place +
  // Phase-12 assign — unchanged.
  const visualTier = visualTierOf(row);

  // A chainless idle/stale row landing in Watch keeps the Phase-9 stand-down /
  // resume affordances (preserved behind the quiet Watch presentation).
  const isChainlessIdle = chain == null && row.group !== 'working';

  // ---- handlers (every one performs a REAL effect; never a no-op) ----------

  const openIssue = React.useCallback(
    (issueId: string | null) => {
      if (!issueId) return;
      // LEG-01: funnel through buildReaderHref (Tier-2 fallback today; one-line upgrade).
      // Re-points ONLY the issue-open path; openChatWithOwner/assignWork keep
      // buildChatDeepLink (chat target /chat#h=… — landmine #8, untouched).
      navigate(buildReaderHref(companyPrefix, issueId));
    },
    [companyPrefix, navigate],
  );

  const openChatWithOwner = React.useCallback(() => {
    if (!chain?.ownerAgentId) return;
    const link = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: chain.ownerAgentId,
    });
    if (link) navigate(link.to);
  }, [chain, companyPrefix, navigate]);

  const assignWork = React.useCallback(() => {
    // Brief the idle agent in chat (employee-only carrier). The agent's own
    // id is the chat correspondent.
    const link = buildChatDeepLink({
      route: 'employee-only',
      companyPrefix,
      assigneeAgentId: row.agentId,
    });
    if (link) navigate(link.to);
    else showToast({ message: `Could not open chat with ${row.name}` });
  }, [companyPrefix, navigate, row.agentId, row.name, showToast]);

  const wake = React.useCallback(async () => {
    const issueId = chain?.leafIssueId ?? row.focusIssueId;
    if (!issueId || busy) return;
    setBusy(true);
    try {
      await wakeAction({ companyId, issueId, userId });
      showToast({ message: `Wake sent to ${chain?.awaitedPartyLabel ?? row.name}.` });
    } catch {
      showToast({
        message: `Wake requested for ${row.name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [chain, row.focusIssueId, row.name, busy, wakeAction, companyId, userId, showToast]);

  const standDown = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setConfirmingStandDown(false);
    try {
      await pauseAction({ companyId, agentId: row.agentId, userId });
      showToast({ message: `Stood down ${row.name} · agent paused.` });
      onAssignSuccess();
    } catch {
      showToast({
        message: `Stand down requested for ${row.name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, pauseAction, companyId, row.agentId, row.name, userId, showToast, onAssignSuccess]);

  const resume = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resumeAction({ companyId, agentId: row.agentId, userId });
      showToast({ message: `Resumed ${row.name}.` });
      onAssignSuccess();
    } catch {
      showToast({
        message: `Resume requested for ${row.name} (host call pending — verify on the agent page).`,
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, resumeAction, companyId, row.agentId, row.name, userId, showToast, onAssignSuccess]);

  // ---- render --------------------------------------------------------------

  return (
    <div
      id={rowDomId(row.agentId)}
      className={`clarity-employee-row clarity-state-${row.state} clarity-tier-row clarity-tier-row-${visualTier}`}
      data-state={row.state}
      data-tier={visualTier}
    >
      <span className="clarity-employee-state-dot" aria-hidden="true" />
      <span className="clarity-employee-name">{row.name}</span>
      <span className="clarity-employee-role">{row.role}</span>
      <span className="clarity-employee-state-pill">{row.state}</span>
      {row.isPaused ? (
        <span className="clarity-employee-paused-marker">paused</span>
      ) : null}
      <span className="clarity-employee-age">{formatAge(ageMs ?? -1)}</span>

      {row.focusLine && (
        <p className="clarity-employee-focus">
          {/* Plan 18-02 (LEG-02e) — read-time re-scrub over the already-fetched
              focusLine (it is derived from a title that may historically embed an
              id). Pure regex over an in-memory string — zero new DB fetches. */}
          {rescrubPersisted(row.focusLine)}
          {row.focusIssueId && (
            <span className="clarity-employee-focus-ref">{` (${row.focusIssueId})`}</span>
          )}
        </p>
      )}

      {/* needs_you — the blocked row's chain + per-ownership action cluster.
       *  Plan 11-04: the unowned-vs-owned split reads the engine verdict
       *  (showAssign), and the awaited-party line renders the scrubbed
       *  awaitedPartyLabel — never the raw ownerName/UUID. */}
      {visualTier === 'needs-you' && chain && (
        <>
          {/* Plan 13-03 (D-13/D-12) — when a FRESH action card is attached
           *  (the worker only attaches fresh cards by construction, 13-02),
           *  render the Editorial named-action sentence + a "waiting on
           *  <party> · <estimate-words>" secondary line. When the card is
           *  null/absent (stale or not yet generated), fall through to the
           *  EXISTING deterministic chain line below — never blank, never a
           *  fabricated estimate (ACT-02). Every visible string is a React
           *  text node; card.sourceIssueUuid is not on the mirror, so it can
           *  never be rendered (NO_UUID_LEAK by construction, D-10/D-14).
           *  decisionOptions is NOT rendered as chips this phase (Phase 14). */}
          {(() => {
            const card = row.actionCard;
            const estWords = card ? estBucketLabel(card.estBucket) : null;
            return card ? (
              <div className="clarity-employee-chain clarity-employee-chain-action-card">
                {/* Plan 18-02 (LEG-02e) — read-time re-scrub over the already-in-hand
                    Editorial action-card display strings (namedAction / awaitedParty).
                    Worker scrubs on write; this additionally cleans any historical
                    persisted leak. Pure regex over in-memory strings — zero new fetches. */}
                <p className="clarity-employee-named-action">{rescrubPersisted(card.namedAction)}</p>
                <p className="clarity-employee-await">
                  {`waiting on ${rescrubPersisted(card.awaitedParty)}${estWords ? ` · ${estWords}` : ''}`}
                  {chain.leafIssueId && (
                    <span className="clarity-employee-chain-leaf">{` (${chain.leafIssueId})`}</span>
                  )}
                </p>
              </div>
            ) : (
              <div className={`clarity-employee-chain ${showAssign ? '' : 'clarity-employee-chain-owned'}`}>
                <span className="clarity-employee-chain-prefix">{`└ blocked: `}</span>
                <span className="clarity-employee-chain-action">
                  {showAssign
                    ? `${chain.leafIssueId ?? 'this issue'} has no owner`
                    : `waiting on ${rescrubPersisted(chain.awaitedPartyLabel)}`}
                </span>
                {chain.leafIssueId && !showAssign && (
                  <span className="clarity-employee-chain-leaf">{` (${chain.leafIssueId})`}</span>
                )}
              </div>
            );
          })()}
          <div className="clarity-employee-actions">
            {showAssign ? (
              <>
                {chain.leafIssueId && (
                  <OwnerPickerPopover
                    leafIssueId={chain.leafIssueId}
                    leafIssueUuid={chain.leafIssueUuid ?? undefined}
                    companyId={companyId}
                    userId={userId}
                    onAssigned={() => onAssignSuccess()}
                  />
                )}
                {chain.leafIssueId && (
                  <button
                    type="button"
                    className="clarity-btn clarity-employee-open-issue"
                    onClick={() => openIssue(chain.leafIssueId)}
                  >
                    {`Open ${chain.leafIssueId} ↗`}
                  </button>
                )}
              </>
            ) : showReply ? (
              /* Plan 14-03 (SC3/SC4/DO-01) — the ONE shared <ReplyInPlace> on the
               * reply branch (⇔ AWAITING_HUMAN). reachable computed off the REAL
               * threaded chain.terminalKind (14-04), needsDurabilityFlip from the
               * REAL chain.needsDurabilityFlip (NOT a terminal.kind proxy). The
               * *Uuid fields are dispatch props only (NO_UUID_LEAK). */
              <ReplyInPlace
                leafIssueId={chain.leafIssueId}
                leafIssueUuid={chain.leafIssueUuid}
                /* Plan 18-02 (LEG-02e) — read-time re-scrub over the already-in-hand
                 * display strings before they reach the shared primitive. Zero new fetches. */
                awaitedPartyLabel={rescrubPersisted(chain.awaitedPartyLabel)}
                namedAction={rescrubPersisted(row.actionCard?.namedAction ?? `waiting on ${chain.awaitedPartyLabel}`)}
                decisionOptions={row.actionCard?.decisionOptions ?? null}
                needsDurabilityFlip={chain.needsDurabilityFlip}
                reachable={isReplyReachable(chain.terminalKind)}
                companyId={companyId}
                userId={userId}
                companyPrefix={companyPrefix}
                navigate={navigate}
                onActed={onAssignSuccess}
              />
            ) : (
              <>
                {chain.ownerAgentId && (
                  <button
                    type="button"
                    className="clarity-btn clarity-btn-gold clarity-employee-open-chat"
                    onClick={openChatWithOwner}
                  >
                    {`Open chat: ${chain.awaitedPartyLabel}`}
                  </button>
                )}
                <button
                  type="button"
                  className="clarity-btn clarity-employee-wake"
                  onClick={() => void wake()}
                >
                  Wake
                </button>
                {chain.leafIssueId && (
                  <button
                    type="button"
                    className="clarity-btn clarity-employee-open-issue"
                    onClick={() => openIssue(chain.leafIssueId)}
                  >
                    Open ↗
                  </button>
                )}
              </>
            )}
            {/* Plan 18-03 Task 3 (LEG-03) — the honest-divergence affordance. The
             *  worker rollup set row.looksDone ONLY when this needs-you row's
             *  cached TL;DR reads done while the engine still says blocked. Render
             *  the confirm-gated "Looks done — close it?" beside the row's normal
             *  action cluster. Degrade-safe: absent flag OR no leaf to close → no
             *  affordance (no false prompt). leafIssueUuid is dispatch-only
             *  (NO_UUID_LEAK); leafIssueId is the only displayed key. */}
            {row.looksDone === true && chain.leafIssueId && (
              <LooksDoneAffordance
                leafIssueId={chain.leafIssueId}
                leafIssueUuid={chain.leafIssueUuid ?? undefined}
                companyId={companyId}
                userId={userId}
                onClosed={() => onAssignSuccess()}
              />
            )}
          </div>
        </>
      )}

      {/* In-motion (D-06) — calm, lower-contrast reassurance: the legible
       *  focusLine ("what each agent is working on", rendered above) + a quiet
       *  "moving · no action needed" line. NO loud action cluster. The focus
       *  text stays legible (clarity-employee-focus), not the dimmest element. */}
      {visualTier === 'in-motion' && (
        <p className="clarity-employee-moving">moving · no action needed</p>
      )}

      {/* Watch (D-04 / D-06) — quietly stalled awareness. A chainless idle/stale
       *  row keeps the Phase-9 assign-work / stand-down / resume cluster
       *  (preserved affordances). A chain-backed Watch row (stuck / external /
       *  cycle / self-resolving) shows the honest verdict line + its affordance:
       *  stuck -> assign (OwnerPickerPopover), external/cycle/unclassified ->
       *  Open ↗, self-resolving -> none. Quieter than Needs-you, but NOT dead. */}
      {visualTier === 'watch' && chain && !isChainlessIdle && (
        <>
          <div className="clarity-employee-chain clarity-employee-chain-watch">
            <span className="clarity-employee-chain-prefix">{`└ `}</span>
            <span className="clarity-employee-chain-action">
              {showAssign
                ? `${chain.leafIssueId ?? 'this issue'} — agent stuck`
                : `waiting on ${rescrubPersisted(chain.awaitedPartyLabel)}`}
            </span>
            {chain.leafIssueId && !showAssign && (
              <span className="clarity-employee-chain-leaf">{` (${chain.leafIssueId})`}</span>
            )}
          </div>
          {/* Honest affordance only — assign for stuck, Open for external/cycle/
           *  unclassified, nothing for self-resolving (actionAffordance 'none'). */}
          {(showAssign || chain.actionAffordance === 'open') && (
            <div className="clarity-employee-actions">
              {showAssign && chain.leafIssueId && (
                <OwnerPickerPopover
                  leafIssueId={chain.leafIssueId}
                  leafIssueUuid={chain.leafIssueUuid ?? undefined}
                  companyId={companyId}
                  userId={userId}
                  onAssigned={() => onAssignSuccess()}
                />
              )}
              {chain.leafIssueId && (
                <button
                  type="button"
                  className="clarity-btn clarity-employee-open-issue"
                  onClick={() => openIssue(chain.leafIssueId)}
                >
                  Open ↗
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Watch — chainless idle/stale: assign work / stand down / resume (D-04,
       *  Phase-9 affordances preserved behind the quiet Watch presentation). */}
      {visualTier === 'watch' && isChainlessIdle && (
        <div className="clarity-employee-actions">
          {row.isPaused ? (
            <button
              type="button"
              className="clarity-btn clarity-btn-gold clarity-employee-resume"
              onClick={() => void resume()}
            >
              Resume
            </button>
          ) : (
            <>
              <button
                type="button"
                className="clarity-btn clarity-btn-gold clarity-employee-assign-work"
                onClick={assignWork}
              >
                Assign work ▾
              </button>
              {row.state === 'stale' && !confirmingStandDown && (
                <button
                  type="button"
                  className="clarity-btn clarity-btn-danger clarity-employee-stand-down"
                  onClick={() => setConfirmingStandDown(true)}
                >
                  Stand down
                </button>
              )}
              {row.state === 'stale' && confirmingStandDown && (
                <span
                  className="clarity-employee-confirm"
                  role="alertdialog"
                  aria-label={`Stand down ${row.name}?`}
                >
                  <span className="clarity-employee-confirm-text">
                    {`Stand down ${row.name}?`}
                  </span>
                  <button
                    type="button"
                    className="clarity-btn clarity-btn-danger clarity-employee-confirm-yes"
                    onClick={() => void standDown()}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="clarity-btn clarity-employee-confirm-no"
                    onClick={() => setConfirmingStandDown(false)}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
