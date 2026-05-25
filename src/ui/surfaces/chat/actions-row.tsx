// src/ui/surfaces/chat/actions-row.tsx
//
// Plan 04.1-08 — NEW component. The always-visible actions row that sits
// BETWEEN the topic strip and the messages scroller. Three intents at the
// affordance level (Plan 04.1-08 redesign):
//
//   [+ Create task] (primary, gold)    — opens task dialog in COLD mode
//   [+ New topic]   (ghost)            — delegates to existing topic create
//   [⏿ Diagnostics] (ghost; toggles)   — moved here from .head-actions
//
// Layout: [+ Create task] [+ New topic] [⏿ Diagnostics] · spacer · [kbd hint]
//
// Plan 04.1-09 — SHORTCUT REPLACED. The Plan 04.1-08 build bound ⌘+T / Ctrl+T
// to open the cold task dialog. On every real browser the chord hit the
// browser's "New Tab" shortcut FIRST and stole the keystroke before the
// plugin's handler ran (operator drill 2026-05-20 — pressing Ctrl+T opened
// a new browser tab, the task dialog never showed). Replaced with a
// Linear-style single-key `T` shortcut: pressing `T` (with NO modifier)
// opens the dialog ONLY when no input/textarea/contenteditable is focused.
// Any modifier present → bail (so Ctrl+T still opens a new tab as the
// browser default). Tooltip + kbd hint copy updated accordingly.
//
// SECURITY (T-04-18): button labels are static literals; no untrusted input
// renders here. No raw fetch.

import * as React from 'react';

import { DiagnosticsToggle } from './diagnostics-toggle.tsx';

export function ChatActionsRow({
  onCreateTask,
  onNewTopic,
  newTopicDisabled = false,
  diagnosticsOn,
  onDiagnosticsToggle,
  diagnosticsTopicId = null,
}: {
  /** Open the task dialog in COLD mode (no source message). */
  onCreateTask: () => void;
  /** Delegate to the existing chat.topic.create flow (window.prompt today). */
  onNewTopic: () => void;
  /** True when no employee is selected or a create is already in flight. */
  newTopicDisabled?: boolean;
  diagnosticsOn: boolean;
  /** Plan 05-08 (D-18) — accepts an OPTIONAL next-state argument so the
   *  toggle's localStorage-restore path can set the value directly. */
  onDiagnosticsToggle: (next?: boolean) => void;
  /** Plan 05-08 (D-18) — per-topic persistence key. Null when no active topic. */
  diagnosticsTopicId?: string | null;
}): React.ReactElement {
  // Plan 04.1-09 — single-key `T` (no modifier) opens the dialog when no
  // editable is focused. Any modifier (Ctrl/Cmd/Alt/Shift) → bail so browser
  // and OS shortcuts (Ctrl+T new tab, etc.) work normally.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'T' && e.key !== 't') return;
      // Bail on ANY modifier — let browser shortcuts (Ctrl+T new tab, etc.) work
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // Bail when the user is typing in an input/textarea/contenteditable
      const ae = (typeof document !== 'undefined' ? document.activeElement : null) as
        | HTMLElement
        | null;
      if (
        ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      onCreateTask();
    };
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCreateTask]);

  return (
    <div
      className="chat-actions-row"
      data-clarity-region="chat-actions-row"
    >
      <button
        type="button"
        className="btn primary"
        onClick={onCreateTask}
        title="Create a task (T)"
        data-clarity-action="create-task-cold"
      >
        + Create task
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={onNewTopic}
        disabled={newTopicDisabled}
        title="Start a new conversation topic with this employee"
        data-clarity-action="new-topic"
      >
        + New topic
      </button>
      <DiagnosticsToggle
        armed={diagnosticsOn}
        onToggle={onDiagnosticsToggle}
        topicId={diagnosticsTopicId}
      />
      <span className="spacer" aria-hidden="true" />
      <span className="kbd-hint" aria-hidden="true">
        <kbd>T</kbd> new task
      </span>
    </div>
  );
}
