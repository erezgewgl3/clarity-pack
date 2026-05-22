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
// EMPLOYEE NAME — DEVIATION (Plan Task 3 <behavior>): the plan says "resolve
// from the assignee roster the Reader already has, or fall back to
// assigneeAgentId". The Reader surface carries NO employee roster (confirmed
// against src/ui/surfaces/reader/* + the issue.reader handler) and
// chat.openForIssue returns only assigneeAgentId, not a display name. The
// label therefore uses assigneeAgentId directly. A future plan can thread a
// roster through issue.reader if a friendly name is wanted.
//
// NAVIGATION — DEVIATION (Plan Task 3 <behavior>): the plan says "click
// handler uses useNavigate" (react-router-dom). The repo convention is
// useHostNavigation().linkProps (SCAF-09 — breadcrumb.tsx; the
// reader-view.test.mjs breadcrumb test forbids raw <a href> and pins the host
// hook). This component follows the established convention: it renders a real
// <button> and routes via the host navigation hook's navigate() so
// modifier-click etc. stay native where applicable.
//
// SECURITY (T-04.2-01-03): seedTitle / seedBody render only as
// encodeURIComponent-encoded URL params and, downstream, as controlled
// React-text input values — never dangerouslySetInnerHTML. No raw fetch.

import * as React from 'react';
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

import { useHostNavigation } from '../../primitives/use-host-navigation.ts';

/** The chat.openForIssue route payload (Task 2 — chat-open-for-issue.ts). */
export type ChatOpenForIssueResult = {
  kind: 'chatOpenForIssue';
  route: 'existing-topic' | 'new-topic-needed' | 'topic-itself';
  topicIssueId?: string;
  sourceCommentId?: string;
  assigneeAgentId?: string;
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

/**
 * Build the chat deep-link path for the resolved route. Returns null when the
 * route is not navigable (topic-itself / unresolved).
 */
function buildChatHref(
  data: ChatOpenForIssueResult,
  companyPrefix: string,
  issueId: string,
): string | null {
  const base = `/${companyPrefix}/chat`;
  if (data.route === 'existing-topic' && data.topicIssueId) {
    // Explicit `key=encodeURIComponent(value)` parts (uniform with the
    // new-topic branch below) — each param is individually encoded so a
    // topic/comment id with a URL-special char survives the round-trip.
    const parts = [`topic=${encodeURIComponent(data.topicIssueId)}`];
    if (data.sourceCommentId) {
      parts.push(`comment=${encodeURIComponent(data.sourceCommentId)}`);
    }
    if (data.assigneeAgentId) {
      parts.push(`employee=${encodeURIComponent(data.assigneeAgentId)}`);
    }
    return `${base}?${parts.join('&')}`;
  }
  if (data.route === 'new-topic-needed' && !data.error) {
    // encodeURIComponent on the seed strings — the URLSearchParams encoder
    // does this for us, but the Task 3 acceptance grep pins >= 2 explicit
    // encodeURIComponent calls (defence-in-depth + an unambiguous contract).
    const seedTitle = encodeURIComponent(data.seedTitle ?? '');
    const seedBody = encodeURIComponent(data.seedBody ?? '');
    const parts = [`newTopic=1`, `originIssueId=${encodeURIComponent(issueId)}`];
    if (data.assigneeAgentId) parts.push(`employee=${encodeURIComponent(data.assigneeAgentId)}`);
    parts.push(`seedTitle=${seedTitle}`);
    parts.push(`seedBody=${seedBody}`);
    return `${base}?${parts.join('&')}`;
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

  const employeeLabel = result.assigneeAgentId || 'this employee';

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

  const href = buildChatHref(result, companyPrefix, issueId);
  if (!href) return null;

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
        nav.navigate(href);
      }}
    >
      Continue in chat with {employeeLabel} →
    </button>
  );
}
