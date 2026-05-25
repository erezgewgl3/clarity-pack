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
// Plan 05-08 (D-18) — per-topic persistence in localStorage. The toggle
// accepts an OPTIONAL `topicId` prop. When present:
//   - On mount / topicId change: read `clarity:diagnostics:<topicId>` and
//     emit onToggle ONCE if the persisted value differs from the current
//     `armed` prop. This drives the parent's React state to match storage.
//   - On click: write `clarity:diagnostics:<topicId>` after invoking
//     onToggle so the next reload restores the new state.
//   - When topicId is null/undefined: behave as rc.7 session-only state
//     (graceful degrade — no localStorage I/O).
//
// localStorage failure (privacy mode → setItem throws) is swallowed in
// try/catch; the in-memory React state still drives this-session UI.
// Topic-A's state is fully independent of Topic-B's (different keys).

import * as React from 'react';

/** Build the localStorage key for a given topic id. */
function storageKey(topicId: string | null | undefined): string | null {
  return topicId ? `clarity:diagnostics:${topicId}` : null;
}

export function DiagnosticsToggle({
  armed,
  onToggle,
  topicId = null,
}: {
  armed: boolean;
  onToggle: (next?: boolean) => void;
  /** Plan 05-08 (D-18) — per-topic persistence key.
   *  When null/undefined, the toggle behaves as session-only (rc.7). */
  topicId?: string | null;
}): React.ReactElement {
  // Plan 05-08 (D-18) — read localStorage on mount / when the topic
  // changes. Emits onToggle if the persisted value differs from the
  // current `armed` prop so the parent's React state syncs to storage.
  // The hydrated flag prevents a write-back loop on the first render.
  const lastEmittedTopicRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const key = storageKey(topicId);
    if (!key) {
      lastEmittedTopicRef.current = null;
      return;
    }
    if (lastEmittedTopicRef.current === topicId) return;
    lastEmittedTopicRef.current = topicId ?? null;
    try {
      if (typeof window === 'undefined') return;
      const stored = window.localStorage.getItem(key);
      if (stored === null) return; // never set — keep current armed
      const persistedArmed = stored === '1';
      if (persistedArmed !== armed) {
        onToggle(persistedArmed);
      }
    } catch {
      // Privacy mode / quota: graceful degrade, session-only state.
    }
    // We intentionally do not include `armed` in deps — only re-run when
    // topicId changes. Including `armed` would re-fire after every toggle
    // and re-overwrite from storage in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  const handleClick = React.useCallback(() => {
    const nextArmed = !armed;
    onToggle(nextArmed);
    const key = storageKey(topicId);
    if (!key) return;
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(key, nextArmed ? '1' : '0');
    } catch {
      // Privacy mode / quota: graceful degrade. The in-memory React state
      // already reflects the new value; only persistence is lost.
    }
  }, [armed, onToggle, topicId]);

  return (
    <button
      type="button"
      className={armed ? 'btn diagnostics-toggle' : 'btn ghost diagnostics-toggle'}
      data-armed={armed ? 'true' : 'false'}
      data-clarity-diagnostics-topic={topicId ?? ''}
      aria-pressed={armed}
      title={
        armed
          ? 'Hide system / runtime comments'
          : 'Show filtered system / runtime comments inline'
      }
      onClick={handleClick}
    >
      ⏿ Diagnostics{armed ? ' ON' : ''}
    </button>
  );
}
