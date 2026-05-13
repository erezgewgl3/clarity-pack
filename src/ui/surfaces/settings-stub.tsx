// src/ui/surfaces/settings-stub.tsx
//
// Plan 02-02 Task 3 — Settings page placeholder. Plan 02-04 Task 1 fills this
// with the per-user opt-in toggle (OPTIN-01) + default-landing radio
// (OPTIN-05) + Enable-Clarity CTA (OPTIN-04).

import * as React from 'react';

import { ClaritySurfaceRoot } from '../primitives/clarity-surface-root.tsx';

export function SettingsPage(): React.ReactElement {
  return (
    <ClaritySurfaceRoot name="settings">
      <div style={{ padding: '1rem', opacity: 0.7 }}>
        <p>Settings — Plan 02-04 will fill this with the per-user Clarity opt-in toggle + default-landing radio + Enable-Clarity CTA.</p>
      </div>
    </ClaritySurfaceRoot>
  );
}
