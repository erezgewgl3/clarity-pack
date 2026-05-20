// src/ui/surfaces/chat/true-task/true-task-toggle.tsx
//
// Plan 04.1-06 Task 1 — Pattern A (UI-SPEC §"Composer mode toggle").
//
// Composer "Send as task" toggle. Controlled component — the parent
// (Composer) owns `armed`; this component renders the visual + the click
// affordance. When ARMED, the composer's Send button label flips to
// "Open task form" and Enter opens the confirm dialog instead of sending
// the message. The gold-accent border + dot encode the locked
// affordance-reservation (UI-SPEC §Color "Accent reserved for").
//
// Visual reuse: `.tool-btn` class idiom from chat.css:964-982 plus the
// new `.true-task-toggle[data-armed="true"]` rule appended in chat.css's
// Phase 4.1 section. NO shadcn imports — UI-SPEC Registry Safety.

import * as React from 'react';

export function TrueTaskToggle({
  armed,
  disabled,
  onToggle,
}: {
  armed: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="true-task-toggle tool-btn"
      data-armed={armed ? 'true' : 'false'}
      aria-pressed={armed}
      aria-label={
        armed
          ? 'Sending as task — turn off to send a normal message'
          : 'Send as task'
      }
      disabled={disabled}
      title={
        armed
          ? 'Click to send a normal chat message instead'
          : 'Turn the next message into a task assigned to this employee'
      }
      onClick={onToggle}
    >
      ↗ {armed ? 'Sending as task' : 'Send as task'}
    </button>
  );
}
