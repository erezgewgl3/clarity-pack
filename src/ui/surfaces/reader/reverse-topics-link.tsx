// src/ui/surfaces/reader/reverse-topics-link.tsx
//
// Plan 04.2-01 Task 6 — the Reader-header reverse-topics list (RCB-06).
//
// The inverse of the topic-strip's About-issue chip: when an issue has N chat
// topics started FROM it (issue.reader's `topicsForIssue` field, populated by
// listChatTopicsByOriginIssue against the migration-0009 origin_issue_id
// column), the Reader header surfaces an inline `<N> conversations about this
// issue ↗` affordance. Clicking it opens a small popover listing each topic
// (title + last-activity); a row click deep-links into the chat surface
// (/<prefix>/chat?topic=<topicIssueId>) — which the Task 5 URL-param handler
// then honours by switching to that topic.
//
// Renders NOTHING when topicsForIssue is empty — a button-less Reader for an
// issue with no Reader-originated chat topics (RCB-07 coexistence: pre-0009
// issues always land here).
//
// SECURITY (T-04.2-01-03): topic titles render as untrusted React text only —
// never dangerouslySetInnerHTML. Navigation goes through the host nav hook,
// not a raw <a href> (SCAF-09).
//
// Plan 04.2-02 Task 2 (GAP-RCB-03-DEEPLINK) — a row click emits the deep
// link through the SHARED `buildTopicDeepLink` contract helper.
// Plan 04.2-03 Task 2 (GAP-RCB-03-CARRIER) — carrier swapped to URL_HASH.
// The deep link is built by `buildTopicDeepLink` (`/<prefix>/chat#h=<base64-
// JSON>`) and navigate() is called with ONE argument — `deepLink.to`. NO
// `state:` option. Same shape as the Continue button; the live Countermoves
// probe 2026-05-23 proved URL fragments survive end-to-end on this host
// while both `?query` and `{ state }` strip. The chat surface reads the
// fragment back via parseChatDeepLink({ hash }).

import * as React from 'react';
import { useHostNavigation } from '../../primitives/use-host-navigation.ts';
import { buildTopicDeepLink } from '../../surfaces/chat/deep-link.mjs';

/** One reverse-topic row — mirrors the worker's ChatTopicByOriginEntry. */
export type ReverseTopic = {
  topicIssueId: string;
  topicId: string;
  title: string;
  lastActivityAt: string;
  /** Plan 04.2-07 D-02 — owner of this chat topic. When the popover is
   *  auto-opened in continue-in-chat mode with filterToAssignee set, rows
   *  not matching are filtered out. Optional so cached pre-04.2-07 payloads
   *  still type-check (the filter then degrades to "show all"). */
  employeeAgentId?: string;
};

export type ReverseTopicsLinkProps = {
  /** The company URL prefix — e.g. "COU". Plugin pages route at /<prefix>/chat. */
  companyPrefix: string;
  /** The chat topics started from this issue (issue.reader topicsForIssue). */
  topicsForIssue: ReverseTopic[];
  /** Plan 04.2-07 D-01/D-02 — distinguishes the auto-opened picker case
   *  (from the Continue-in-chat button) from the manual header-click case.
   *  Default: 'manual' (today's behaviour). */
  entryPoint?: 'continue-in-chat' | 'manual';
  /** Plan 04.2-07 D-02 — when set, the popover filters rows by
   *  `t.employeeAgentId === filterToAssignee`. When null / undefined the
   *  popover shows all topics (today's behaviour). */
  filterToAssignee?: string | null;
  /** Plan 04.2-07 D-02 — controlled-mode flag the parent Reader index uses
   *  to request auto-open when the Continue button resolves to the
   *  ambiguous route. The local toggle still owns close. */
  autoOpen?: boolean;
};

/** Format an ISO timestamp as a compact `YYYY-MM-DD HH:MM` for the popover. */
function formatActivity(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function ReverseTopicsLink({
  companyPrefix,
  topicsForIssue,
  entryPoint = 'manual',
  filterToAssignee = null,
  autoOpen = false,
}: ReverseTopicsLinkProps): React.ReactElement | null {
  const nav = useHostNavigation();
  const [open, setOpen] = React.useState(false);

  // Plan 04.2-07 D-02 — controlled auto-open from the Continue-in-chat
  // button. When the parent flips autoOpen true (in response to the button
  // click), the popover opens; the local toggle still owns close.
  // entryPoint is consumed via the className data attribute so the test +
  // future styling can differentiate manual vs continue-in-chat opens.
  React.useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  // Empty list — render nothing. The Reader header simply has no reverse link.
  if (!topicsForIssue || topicsForIssue.length === 0) return null;

  // Plan 04.2-07 D-02 — filter rows by same-assignee when the popover is
  // auto-opened in continue-in-chat mode with filterToAssignee set. When
  // null / undefined / empty, fall back to the full topicsForIssue list
  // (today's behaviour). Topics whose employeeAgentId is missing (pre-04.2-07
  // payloads) are excluded from the filtered view by construction.
  const visibleTopics =
    typeof filterToAssignee === 'string' && filterToAssignee.length > 0
      ? topicsForIssue.filter((t) => t.employeeAgentId === filterToAssignee)
      : topicsForIssue;

  const n = topicsForIssue.length;
  // "1 conversation" vs "N conversations" — but the locked label copy is
  // "conversations about this issue" (plural form pinned by the test).
  const label = `${n} conversation${n === 1 ? '' : 's'} about this issue ↗`;

  return (
    <span
      className="clarity-reverse-topics"
      data-clarity-region="reverse-topics-link"
      data-clarity-entry-point={entryPoint}
    >
      <button
        type="button"
        className="clarity-reverse-topics-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-clarity-action="reverse-topics-toggle"
      >
        {label}
      </button>
      {open ? (
        <div
          className="clarity-reverse-topics-popover"
          role="menu"
          data-clarity-region="reverse-topics-popover"
        >
          {visibleTopics.map((t) => (
            <button
              key={t.topicIssueId}
              type="button"
              className="clarity-reverse-topics-row"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                // Deep-link into the chat surface via the SHARED contract —
                // the chat surface's parseChatDeepLink switches to this
                // topic on arrival. Plan 04.2-03 URL_HASH carrier: the
                // encoded payload rides in the URL fragment baked into
                // `deepLink.to`; navigate() takes ONE argument. URL
                // fragments survive the host's resolveHref and the host
                // wrapper around useNavigate (probe 2026-05-23).
                //
                // Plan 05-05 Task 3 (D-10) — pass t.employeeAgentId as the
                // third arg so the chat-surface dispatch (Plan 04.2-04) can
                // setEmployee(matched) BEFORE setTopic. Closes
                // GAP-PICKER-ROW-DISPATCH from the rc.7 drill: picker row
                // click landed on the empty `Select an employee` state
                // because the deep link carried no employee field.
                // t.employeeAgentId is optional on the ReverseTopic row
                // (added by Plan 04.2-07); when missing, buildTopicDeepLink
                // degrades to the 2-arg back-compat path.
                const deepLink = buildTopicDeepLink(
                  companyPrefix,
                  t.topicIssueId,
                  t.employeeAgentId,
                );
                if (deepLink) {
                  nav.navigate(deepLink.to);
                }
              }}
            >
              <span className="clarity-reverse-topics-row-title">{t.title}</span>
              <span className="clarity-reverse-topics-row-meta">
                {formatActivity(t.lastActivityAt)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
