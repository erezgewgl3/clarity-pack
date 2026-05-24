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

/** The chat.openForIssue route payload (Task 2 — chat-open-for-issue.ts). */
export type ChatOpenForIssueResult = {
  kind: 'chatOpenForIssue';
  route: 'existing-topic' | 'new-topic-needed' | 'topic-itself';
  topicIssueId?: string;
  sourceCommentId?: string;
  assigneeAgentId?: string;
  /** Plan 04.2-06 D9 — server-resolved display name for the assignee.
   *  Null when the lookup degraded; the UI then falls back to a friendly
   *  generic label, never to the raw UUID. */
  assigneeName?: string | null;
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

  const deepLink = buildChatNav(result, companyPrefix, issueId);
  if (!deepLink) return null;

  // existing-topic — the tooltip names the source topic; new-topic-needed —
  // the tooltip mirrors the label.
  const tooltip =
    result.route === 'existing-topic' && result.topicIssueId
      ? `Open source topic ${result.topicIssueId} →`
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
