// test/ui/chat-archive-panel-hooks.test.mjs
//
// Bug (2026-05-29, live BEAAA): clicking the "+N archived" pill to open the
// ArchivePanel crashed the WHOLE chat surface to "Clarity Pack failed to render"
// (the host PluginSlotErrorBoundary). Root cause: a rules-of-hooks violation —
// `React.useMemo(filtered)` sat BELOW the `if (!open) return null` early return.
// When the panel was closed, 5 hooks ran (useMemo skipped by the early return);
// when it opened, 6 hooks ran → React threw "Rendered more hooks than during the
// previous render" on the open transition → the boundary blanked the surface.
// Never caught because the UI tests are source-grep only (no real-DOM render).
//
// Fix: every hook MUST run on every render, before any conditional return.
// This source-grep gate pins that ordering in archive-panel.tsx.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'archive-panel.tsx');
const src = readFileSync(PANEL, 'utf8');

test('archive-panel: React.useMemo runs BEFORE the `if (!open) return null` early return', () => {
  const earlyReturn = src.indexOf('if (!open) return null');
  const useMemo = src.indexOf('React.useMemo(');
  assert.ok(earlyReturn > 0, 'expected the `if (!open) return null` early return');
  assert.ok(useMemo > 0, 'expected a React.useMemo in archive-panel.tsx');
  assert.ok(
    useMemo < earlyReturn,
    'React.useMemo MUST appear BEFORE `if (!open) return null` — a hook after the ' +
      'early return jumps the hook count when the panel opens and crashes the chat surface',
  );
});

test('archive-panel: NO React hook (useX) appears after the early return', () => {
  const idx = src.indexOf('if (!open) return null');
  assert.ok(idx > 0, 'expected the early return');
  const after = src.slice(idx);
  const offending = after.match(/React\.use[A-Z]\w+/g);
  assert.equal(
    offending,
    null,
    `no React hook may be called after the early return (rules of hooks); found: ${offending}`,
  );
});
