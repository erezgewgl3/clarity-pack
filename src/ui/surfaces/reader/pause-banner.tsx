// src/ui/surfaces/reader/pause-banner.tsx
//
// Plan 02-03 Task 2 — D-07 pause banner. Footer on Reader (and reusable for
// Situation Room in 02-04 — same component, same text). Visible when the
// editor.pause-status data handler reports the agent is paused. Dismissible
// per-session: clicking × hides the banner until the next page load while
// paused. Reappears automatically if it was dismissed on the previous mount.
//
// The literal "Editorial Desk paused — last compile failed at" is locked by
// D-07 + reader-view.test.mjs; do not edit it without updating the test.

import * as React from 'react';
import { usePluginData, useHostContext } from '@paperclipai/plugin-sdk/ui/hooks';

export type EditorPauseStatus = {
  paused: boolean;
  lastFailureAt: string | null;
  reason: string | null;
};

function formatHHMM(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PauseBanner(): React.ReactElement | null {
  // DEV-15-STRUCTURAL (drill 2026-05-14): editor.pause-status is wrapped by
  // opt-in-guard. Without userId in params the guard returns
  // {error:'OPT_IN_REQUIRED'} and `data.paused` is undefined — banner stays
  // null which masks legitimate paused states from opted-in users. Thread
  // userId from useHostContext.
  const { userId } = useHostContext();
  const { data } = usePluginData<EditorPauseStatus | { error: string }>(
    'editor.pause-status',
    { userId: userId ?? '' },
  );
  const [dismissed, setDismissed] = React.useState(false);
  if (!data || 'error' in data || !data.paused || dismissed) return null;
  const ts = formatHHMM(data.lastFailureAt);
  return (
    <footer
      className="clarity-pause-banner"
      role="status"
      data-clarity-region="pause-banner"
    >
      Editorial Desk paused — last compile failed at {ts}. Resume in agent panel.
      <button
        type="button"
        className="clarity-pause-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss pause banner"
      >
        ×
      </button>
    </footer>
  );
}
