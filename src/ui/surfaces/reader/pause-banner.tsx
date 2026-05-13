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
import { usePluginData } from '@paperclipai/plugin-sdk/ui/hooks';

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
  const { data } = usePluginData<EditorPauseStatus>('editor.pause-status', {});
  const [dismissed, setDismissed] = React.useState(false);
  if (!data?.paused || dismissed) return null;
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
