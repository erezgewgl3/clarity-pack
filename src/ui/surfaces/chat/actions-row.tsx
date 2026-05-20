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
// Global keyboard shortcut: ⌘+T (Mac) / Ctrl+T (Windows) opens the cold dialog
// — UNLESS the focus is inside an input / textarea / contenteditable, in which
// case the browser default wins. (Note: browsers may also bind Ctrl+T to "new
// tab"; preventDefault catches it inside the chat surface only.)
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
}: {
  /** Open the task dialog in COLD mode (no source message). */
  onCreateTask: () => void;
  /** Delegate to the existing chat.topic.create flow (window.prompt today). */
  onNewTopic: () => void;
  /** True when no employee is selected or a create is already in flight. */
  newTopicDisabled?: boolean;
  diagnosticsOn: boolean;
  onDiagnosticsToggle: () => void;
}): React.ReactElement {
  // Global ⌘+T / Ctrl+T → openTaskDialog cold. Skip when focused inside an
  // input / textarea / contenteditable so the browser keeps the default.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 't' && e.key !== 'T') return;
      if (!(e.metaKey || e.ctrlKey)) return;
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
        title="Create a task (⌘T / Ctrl+T)"
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
      />
      <span className="spacer" aria-hidden="true" />
      <span className="kbd-hint" aria-hidden="true">
        <kbd>⌘</kbd>
        <kbd>T</kbd> new task
      </span>
    </div>
  );
}
