// src/ui/surfaces/reader/continue-in-chat-button.tsx
//
// Plan 04.2-01 Task 3 — the Reader-header Continue-in-chat primitive (RCB-01).
//
// A PRIMARY (gold) button whose entire behaviour is determined by the issue's
// lineage. On mount it invokes the chat.openForIssue data handler (Task 2,
// RCB-02) which returns exactly one deterministic route; this component just
// renders the right affordance and, on click, deep-links the chat surface to
// the precise destination. No navigation guessing — the "zero rabbit-holes"
// core value (CLAUDE.md) in the Reader -> Chat direction.
//
// Route -> affordance:
//   existing-topic           -> enabled PRIMARY button. Click deep-links the
//                               chat surface to the source topic + comment.
//   new-topic-needed (no err) -> enabled PRIMARY button. Click deep-links the
//                               chat surface to a pre-seeded New Topic dialog.
//   topic-itself             -> render null (the issue IS a chat surface).
//   NO_ASSIGNEE (error)      -> DISABLED button + the locked guidance tooltip.
//   loading / pre-resolution -> render null (no layout flicker — Task 4
//                               Test 2 pins the absent-while-loading state).
//
// EMPLOYEE NAME — Plan 04.2-06 D9: `chat.openForIssue` now returns an
// `assigneeName` field resolved server-side via `ctx.agents.get(...)`. The
// button consumes `assigneeName` when present and falls back to a friendly
// generic label ("this employee") when the lookup degraded — NEVER to the
// raw UUID. Pre-04.2-06 (Plan 04.2-01) this fell back to assigneeAgentId,
// which leaked the agent's UUID into the visible button text — D9 closed
// that leak.
//
// NAVIGATION — DEVIATION (Plan Task 3 <behavior>): the plan says "click
// handler uses useNavigate" (react-router-dom). The repo convention is
// useHostNavigation().linkProps (SCAF-09 — breadcrumb.tsx; the
// reader-view.test.mjs breadcrumb test forbids raw <a href> and pins the host
// hook). This component follows the established convention: it renders a real
// <button> and routes via the host navigation hook's navigate() so
// modifier-click etc. stay native where applicable.
//
// Plan 04.2-02 Task 2 (GAP-RCB-03-DEEPLINK) — the emit side of the
// shared Reader->Chat deep-link contract.
// Plan 04.2-03 Task 2 (GAP-RCB-03-CARRIER) — carrier swapped to URL_HASH.
// The deep link is built by the SHARED `buildChatDeepLink` helper
// (src/ui/surfaces/chat/deep-link.mjs); the encoded payload now rides
// entirely in the URL fragment (`deepLink.to` carries `#h=<base64-JSON>`).
// navigate() is called with ONE argument — `deepLink.to`. NO `state:`
// option. The live Countermoves probe 2026-05-23 proved the host strips
// BOTH the `?query` tail (resolveHref) AND the `{ state }` argument (host
// wrapper around useNavigate; history.state.usr === null), but RFC 3986
// URL fragments survive end-to-end because they never reach the server
// and the host's path-routing cannot touch them. chat/index.tsx reads
// the fragment back via the shared `parseChatDeepLink({ hash })`.
//
// SECURITY (T-04.2-03-01): seedTitle / seedBody travel as plain structured
// string fields inside the base64-JSON-encoded fragment payload; downstream
// they populate controlled React-text input values only — never
// dangerouslySetInnerHTML. No raw fetch.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { useHostNavigation } from '../../primitives/use-host-navigation.ts';
import { buildChatDeepLink } from '../../surfaces/chat/deep-link.mjs';

/** Plan 04.2-07 — one same-assignee candidate for the existing-topics-ambiguous
 *  route. CHT-NN topicId is operator-visible (D-08 hygiene); topicIssueId is
 *  the internal chat-topic UUID, never rendered as text. */
export type ChatOpenForIssueCandidate = {
  topicIssueId: string;
  topicId: string;
  title: string;
  lastActivityAt: string;
  lastMessagePreview?: string;
  archived: boolean;
  /** Plan 04.2-07 D-02 — passed through so reverse-topics-link.tsx can filter
   *  the popover rows by same-assignee when the picker auto-opens. */
  employeeAgentId?: string;
};

/** The chat.openForIssue route payload (Task 2 — chat-open-for-issue.ts). */
export type ChatOpenForIssueResult = {
  kind: 'chatOpenForIssue';
  /** Plan 04.2-07 — added 'existing-topics-ambiguous' for N>=2 same-assignee
   *  reverse-link matches (D-01 step 2 + D-02 popover reuse). */
  route:
    | 'existing-topic'
    | 'existing-topics-ambiguous'
    | 'new-topic-needed'
    | 'topic-itself';
  topicIssueId?: string;
  sourceCommentId?: string;
  assigneeAgentId?: string;
  /** Plan 04.2-06 D9 — server-resolved display name for the assignee.
   *  Null when the lookup degraded; the UI then falls back to a friendly
   *  generic label, never to the raw UUID. */
  assigneeName?: string | null;
  /** Plan 04.2-07 (D-01 step 2 + D-08) — only present on the
   *  'existing-topics-ambiguous' route. CHT-NN topicId per candidate so the
   *  popover renders without UUID leakage. */
  candidates?: ChatOpenForIssueCandidate[];
  /** Plan 04.2-07 (D-01 step 2 + D-08) — BEAAA-NNN identifier for the source
   *  issue, used in the D-06 ambiguous-route tooltip text. */
  sourceIssueIdentifier?: string;
  seedTitle?: string;
  seedBody?: string;
  error?: string;
};

/** The minimal slice of the loaded Reader issue this button needs. */
export type ContinueInChatIssue = {
  identifier?: string | null;
  title?: string | null;
};

export type ContinueInChatButtonProps = {
  issueId: string;
  companyId: string;
  userId: string;
  /** The company URL prefix — e.g. "COU". Plugin pages route at /<prefix>/chat
   *  (memory clarity-pack-plugin-page-routes — NOT /plugins/clarity-pack/...). */
  companyPrefix: string;
  /** The loaded Reader issue data (identifier + title for the seed payload). */
  issue: ContinueInChatIssue;
  /** Plan 04.2-07 (D-02 popover lift) — when the resolved route is
   *  'existing-topics-ambiguous', the button calls this prop instead of
   *  navigating, asking the parent Reader index to auto-open the RCB-06
   *  popover pre-filtered to same-assignee candidates. The chat surface
   *  never sees the ambiguous route (D-07 deep-link contract). */
  onRequestPickerOpen?: (req: { filterToAssignee: string | null }) => void;
};

/** What navigate() needs: the fragment-bearing path. Plan 04.2-03 URL_HASH
 *  carrier — the encoded payload is in `to`'s `#h=...` fragment; `state` is
 *  intentionally `undefined` (the 0.9.1 state carrier is stripped by the
 *  host wrapper on this Paperclip instance). null = not navigable. */
type ChatDeepLinkNav = {
  to: string;
  state: undefined;
};

/**
 * Build the Reader->Chat deep link for the resolved route. Delegates to the
 * SHARED `buildChatDeepLink` contract helper so the emit shape and the
 * chat-side read shape (parseChatDeepLink) cannot drift apart — the exact
 * test-gap that let GAP-RCB-03 ship. Returns null when the route is not
 * navigable (topic-itself / NO_ASSIGNEE error / unresolved).
 */
function buildChatNav(
  data: ChatOpenForIssueResult,
  companyPrefix: string,
  issueId: string,
): ChatDeepLinkNav | null {
  if (data.route === 'existing-topic' && data.topicIssueId) {
    return buildChatDeepLink({
      route: 'existing-topic',
      companyPrefix,
      topicIssueId: data.topicIssueId,
      sourceCommentId: data.sourceCommentId,
      assigneeAgentId: data.assigneeAgentId,
    }) as ChatDeepLinkNav | null;
  }
  if (data.route === 'new-topic-needed' && !data.error) {
    return buildChatDeepLink({
      route: 'new-topic-needed',
      companyPrefix,
      assigneeAgentId: data.assigneeAgentId,
      seedTitle: data.seedTitle ?? '',
      seedBody: data.seedBody ?? '',
      originIssueId: issueId,
    }) as ChatDeepLinkNav | null;
  }
  return null;
}

export function ContinueInChatButton({
  issueId,
  companyId,
  userId,
  companyPrefix,
  issue,
  onRequestPickerOpen,
}: ContinueInChatButtonProps): React.ReactElement | null {
  const nav = useHostNavigation();
  const { data, loading } = usePluginData<ChatOpenForIssueResult | { error: string }>(
    'chat.openForIssue',
    { companyId, userId, issueId },
  );

  // Loading / pre-resolution — render nothing (no layout flicker). Task 4
  // Test 2 pins this.
  if (loading || !data) return null;

  // The opt-in guard short-circuit ({ error: 'OPT_IN_REQUIRED' }) or any
  // structured handler error WITHOUT a route — render nothing rather than a
  // broken button. NO_ASSIGNEE is the ONE error that still carries a route.
  if (!('kind' in data) || data.kind !== 'chatOpenForIssue') return null;
  const result = data as ChatOpenForIssueResult;

  // topic-itself — the issue IS already a chat surface; render nothing.
  if (result.route === 'topic-itself') return null;

  // Plan 04.2-06 D9 — assigneeName is the resolved display name from
  // chat.openForIssue (which calls ctx.agents.get under the hood). When the
  // name lookup degraded server-side OR the field is unset (pre-04.2-06
  // payloads), fall back to a friendly generic label — NEVER to the
  // assigneeAgentId UUID. Leaking a UUID into the visible button text was the
  // 2026-05-24 drill defect D9.
  const employeeLabel =
    (typeof result.assigneeName === 'string' && result.assigneeName) || 'this employee';

  // NO_ASSIGNEE — a disabled button + the locked guidance tooltip. The route
  // is still 'new-topic-needed' so the Reader header can position it.
  if (result.error === 'NO_ASSIGNEE') {
    return (
      <button
        type="button"
        className="btn primary clarity-continue-in-chat"
        disabled
        title="Assign this issue to an employee before opening chat."
        data-clarity-action="continue-in-chat"
        data-clarity-route="no-assignee"
      >
        Continue in chat →
      </button>
    );
  }

  // Plan 04.2-07 (D-01 step 2 + D-02 + D-06 + D-08) — existing-topics-ambiguous
  // dispatch arm. The chat surface never sees this route (D-07 lock); the
  // button asks the parent Reader index to auto-open the RCB-06 popover
  // pre-filtered to same-assignee candidates. NO `nav.navigate` here.
  if (result.route === 'existing-topics-ambiguous') {
    const candidateCount = result.candidates?.length ?? 0;
    const sourceLabel = result.sourceIssueIdentifier ?? 'this issue';
    const ambiguousTooltip =
      `Pick from ${candidateCount} conversations about ${sourceLabel} →`;
    return (
      <button
        type="button"
        className="btn primary clarity-continue-in-chat"
        title={ambiguousTooltip}
        data-clarity-action="continue-in-chat"
        data-clarity-route="existing-topics-ambiguous"
        onClick={() => {
          onRequestPickerOpen?.({
            filterToAssignee: result.assigneeAgentId ?? null,
          });
        }}
      >
        Continue in chat with {employeeLabel} →
      </button>
    );
  }

  const deepLink = buildChatNav(result, companyPrefix, issueId);
  if (!deepLink) return null;

  // Plan 04.2-07 D-06 — three-way tooltip differentiation:
  //   - chat-task lineage 'existing-topic' (has sourceCommentId) → name the
  //     source topic id (rc.6 behaviour preserved).
  //   - reverse-lookup 'existing-topic' (no sourceCommentId) → "Resume
  //     conversation about <BEAAA-NNN> →" using sourceIssueIdentifier.
  //   - new-topic-needed (default) → mirrors the button label.
  // BUTTON LABEL stays "Continue in chat with <employeeLabel> →" unchanged
  // across every arm (D-06 lock).
  const tooltip =
    result.route === 'existing-topic' && result.topicIssueId && result.sourceCommentId
      ? `Open source topic ${result.topicIssueId} →`
      : result.route === 'existing-topic'
        ? `Resume conversation about ${result.sourceIssueIdentifier ?? 'this issue'} →`
        : `Continue in chat with ${employeeLabel} →`;

  return (
    <button
      type="button"
      className="btn primary clarity-continue-in-chat"
      title={tooltip}
      data-clarity-action="continue-in-chat"
      data-clarity-route={result.route}
      onClick={() => {
        // Plan 04.2-03 GAP-RCB-03-CARRIER fix — navigate() carries the
        // deep link entirely in the URL fragment baked into `deepLink.to`
        // (`/<prefix>/chat#h=<base64-JSON>`). NO `state:` argument: the
        // 0.9.1 state carrier was proven stripped by the host wrapper
        // around useNavigate on the live Countermoves Paperclip instance
        // (history.state.usr === null after click). URL fragments per
        // RFC 3986 are client-side-only and never reach the server, so
        // the host's path-routing / resolveHref step cannot touch them.
        // chat/index.tsx's parseChatDeepLink reads the fragment back.
        nav.navigate(deepLink.to);
      }}
    >
      Continue in chat with {employeeLabel} →
    </button>
  );
}
