// src/ui/surfaces/chat/host-stuck-banner.tsx
//
// Plan 04.1-06 Task 1 — Pattern G (UI-SPEC §"Host-stuck notice (D-13)").
//
// Sticky strip rendered inside `.messages` BELOW the existing `.auto-refresh`
// live indicator when chat.messages returns `topicStuck: true` (Plan
// 04.1-04 host-stuck signal — host's recovery owner has the topic and
// the plugin cannot release it). NEVER a toast — D-13's "never silent"
// + persistent visibility are load-bearing.
//
// Auto-dismiss: on the next 15s poll, if `topicStuck` returns false the
// parent (MessageThread) stops rendering this component and the banner
// disappears silently — absence IS the confirmation (UI-SPEC §"Auto-
// dismiss"). NO retry button. NO auto-recover.
//
// role="alert" so it announces on render (UI-SPEC §Accessibility).
//
// The "Open in classic Paperclip" affordance uses useHostNavigation —
// the host's SPA nav helper validates the route + applies the link
// shape, no raw <a href> (T-04-18, ESLint no-raw-fetch-in-ui parallel).

import * as React from 'react';
import { useHostNavigation } from '@paperclipai/plugin-sdk/ui/hooks';

export function HostStuckBanner({
  topicIssueId,
  recoveryOwner,
}: {
  topicIssueId: string;
  /** Named human action (e.g. "CEO") from the chat.messages response;
   *  null when the host's activeRecoveryAction had no recoveryOwnerName. */
  recoveryOwner: string | null;
}): React.ReactElement {
  const nav = useHostNavigation();
  return (
    <div
      className="host-stuck-banner"
      role="alert"
      data-clarity-error="topic-stuck"
    >
      <div className="host-stuck-banner-heading">⚠ TOPIC STUCK HOST-SIDE</div>
      <div className="host-stuck-banner-body">
        Paperclip's recovery owner
        {recoveryOwner ? <> · <b>{recoveryOwner}</b></> : null}{' '}
        has this topic and the plugin cannot release it.
      </div>
      <div className="host-stuck-banner-body">
        Conversation paused here. The topic in classic Paperclip shows the host-side status.
      </div>
      <a
        className="btn ghost host-stuck-banner-action"
        {...nav.linkProps(`/issues/${topicIssueId}`)}
      >
        Open in classic Paperclip
      </a>
    </div>
  );
}
