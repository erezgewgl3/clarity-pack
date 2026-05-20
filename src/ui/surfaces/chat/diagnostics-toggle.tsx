// src/ui/surfaces/chat/diagnostics-toggle.tsx
//
// Plan 04.1-06 Task 1 — Pattern F (UI-SPEC §"Runtime-noise diagnostics
// toggle (D-16)").
//
// Header toggle that reveals filtered runtime-noise comments inline in
// the thread. OFF by default — D-16 mandates runtime noise hidden by
// default ("editorial calm; reveal under opt-in"). When ARMED, the
// `chat.messages` handler receives `includeDiagnostics: true` (threaded
// down via index.tsx state → MessageThread props) and returns the
// unfiltered comment list; the thread renders system-classified comments
// as `.runtime-noise-comment` blocks (NOT bubbles).
//
// Persistence: local React state only — does NOT persist across reloads
// (UI-SPEC §"Persistence" — "diagnosability not default-on for power
// users").

import * as React from 'react';

export function DiagnosticsToggle({
  armed,
  onToggle,
}: {
  armed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={armed ? 'btn diagnostics-toggle' : 'btn ghost diagnostics-toggle'}
      data-armed={armed ? 'true' : 'false'}
      aria-pressed={armed}
      title={
        armed
          ? 'Hide system / runtime comments'
          : 'Show filtered system / runtime comments inline'
      }
      onClick={onToggle}
    >
      ⏿ Diagnostics{armed ? ' ON' : ''}
    </button>
  );
}
