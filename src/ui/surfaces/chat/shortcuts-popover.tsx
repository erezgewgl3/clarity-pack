// src/ui/surfaces/chat/shortcuts-popover.tsx
//
// Plan 05-08 (D-19) — Composer shortcuts popover with TWO parallel triggers
// (per checker BLOCKER 3):
//   - PRIMARY: bare `?` keypress inside an EMPTY composer textarea.
//   - PARALLEL DISCOVERABILITY: `Shift+?` keypress regardless of textarea
//     content (lets a mid-message operator discover shortcuts without
//     clearing the buffer).
//
// Both triggers bind to the composer's textarea `onKeyDown` (composer.tsx),
// NEVER a global window listener — the popover stays composer-scoped and
// does not interrupt other surfaces (per CONTEXT.md D-19 operator
// deviation).
//
// The popover lists the chat composer's shortcuts as static React text
// rows. NO dangerouslySetInnerHTML (T-04-18); no untrusted input flows
// through this surface.
//
// Esc and outside-click both close the popover and restore focus to the
// textarea. Any printable key with the popover open ALSO closes it and
// reaches the textarea so the operator can immediately resume typing
// (composer.tsx owns this — see its handleKeyDown).

import * as React from 'react';

type ShortcutRow = { keys: string; desc: string };

const SHORTCUTS: ShortcutRow[] = [
  { keys: 'T', desc: 'Open Create task dialog' },
  { keys: 'Enter', desc: 'Send message' },
  { keys: 'Shift+Enter', desc: 'Insert newline' },
  { keys: '? (empty composer)', desc: 'Open this popover' },
  { keys: 'Shift+?', desc: 'Open this popover (any state)' },
  { keys: 'Esc', desc: 'Close popover' },
];

export function ComposerShortcutsPopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  /** Anchor for outside-click detection; the textarea lives inside this
   *  ref's DOM tree (the composer wrapper element). */
  anchorRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  // Click-outside: defer registration so the click that opened the popover
  // does not immediately close it (mirrors archive-panel.tsx pattern).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const node = popoverRef.current;
      const anchor = anchorRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      if (node && node.contains(target)) return;
      if (anchor && anchor.contains(target)) return;
      onClose();
    };
    const t = setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.addEventListener('mousedown', onDown);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousedown', onDown);
      }
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className="composer-shortcuts-popover"
      role="dialog"
      aria-label="Composer keyboard shortcuts"
      data-clarity-region="composer-shortcuts"
    >
      <h4 className="composer-shortcuts-popover__heading">Keyboard shortcuts</h4>
      <ul className="composer-shortcuts-popover__list">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="composer-shortcuts-popover__row">
            <kbd className="composer-shortcuts-popover__keys">{s.keys}</kbd>
            <span className="composer-shortcuts-popover__desc">{s.desc}</span>
          </li>
        ))}
      </ul>
      <p className="composer-shortcuts-popover__hint">
        Press Esc or any printable key to close.
      </p>
    </div>
  );
}
