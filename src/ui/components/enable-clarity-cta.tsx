// src/ui/components/enable-clarity-cta.tsx
//
// Plan 02-04 Task 1 — OPTIN-02 inline "Enable Clarity Pack" CTA. Rendered
// inside every Clarity surface whenever useOptIn() reports optedIn=false.
// Clicking the button flips the user's prefs row via useOptIn().toggle.

import * as React from 'react';

import { useOptIn } from '../primitives/use-opt-in.ts';

export function EnableClarityCta({
  surfaceName,
}: {
  surfaceName: string;
}): React.ReactElement {
  const { toggle } = useOptIn();
  return (
    <div className="clarity-cta" data-clarity-region="enable-cta">
      <h2 className="clarity-cta-heading">Clarity Pack is off for you</h2>
      <p className="clarity-cta-body">
        Enable Clarity Pack to see {surfaceName} alongside classic Paperclip.
      </p>
      <button
        type="button"
        className="clarity-cta-button"
        onClick={() => {
          // Fire-and-forget — useOptIn re-renders when get-opt-in's cache invalidates.
          void toggle();
        }}
      >
        Enable Clarity Pack
      </button>
      <p className="clarity-cta-fine">Default landing remains your classic dashboard (OPTIN-05).</p>
    </div>
  );
}
