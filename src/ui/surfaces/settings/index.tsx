// src/ui/surfaces/settings/index.tsx
//
// Plan 02-04 Task 1 — OPTIN-01..05 per-user opt-in settings page.
// Replaces the 02-02 stub at src/ui/surfaces/settings-stub.tsx.
//
// Renders a single checkbox bound to the current user's opted-in state.
// Toggle ON writes a clarity_user_prefs row (via useOptIn().toggle → action
// 'set-opt-in'); toggle OFF nulls opted_in_at. Default landing is ALWAYS
// the Paperclip classic dashboard (OPTIN-05) — this is stated in fine print
// directly under the checkbox so the user knows opting in does not redirect
// them.
//
// The page itself never renders the EnableClarityCta — Settings must remain
// reachable for opted-out users (so they can opt IN).

import * as React from 'react';

import { ClaritySurfaceRoot } from '../../primitives/clarity-surface-root.tsx';
import { useOptIn } from '../../primitives/use-opt-in.ts';

export function SettingsPage(): React.ReactElement {
  const { optedIn, toggle, loading } = useOptIn();
  if (loading) {
    return (
      <ClaritySurfaceRoot name="settings">
        <p className="clarity-settings-loading">Loading…</p>
      </ClaritySurfaceRoot>
    );
  }
  return (
    <ClaritySurfaceRoot name="settings">
      <div className="clarity-settings" data-clarity-region="settings">
        <h1 className="clarity-settings-heading">Clarity Pack</h1>
        <label className="clarity-settings-toggle">
          <input
            type="checkbox"
            checked={optedIn}
            onChange={() => {
              void toggle();
            }}
          />
          <span>Enable Clarity Pack for me</span>
        </label>
        <p className="clarity-settings-fine">
          Default landing is the Paperclip classic dashboard either way (OPTIN-05). Clarity Pack
          surfaces (Reader, Situation Room, Daily Bulletin, Employee Chat) become available as
          opt-in clicks; this toggle never redirects the default landing.
        </p>
      </div>
    </ClaritySurfaceRoot>
  );
}
