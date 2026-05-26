// test/ui/diagnostics-toggle-persistence.test.mjs
//
// Plan 05-08 (D-18) — DiagnosticsToggle per-topic localStorage persistence.
//
// Source-grep style: pin the load-bearing contract in
// src/ui/surfaces/chat/diagnostics-toggle.tsx — the storage key shape,
// the topicId prop, the try/catch swallow, the graceful degrade path
// (null/undefined topicId).
//
// DP1: reads localStorage `clarity:diagnostics:<topicId>` on mount.
// DP2: writes the same key on toggle.
// DP3: per-topic key independence (different topic ids → different keys).
// DP4: try/catch around setItem (privacy mode).
// DP5: graceful degrade when topicId is null/undefined.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOGGLE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'chat',
  'diagnostics-toggle.tsx',
);
const SRC = readFileSync(TOGGLE, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('DP-file: diagnostics-toggle.tsx exists', () => {
  assert.ok(existsSync(TOGGLE));
});

test('DP-accept-topicId: toggle accepts topicId prop (Plan 05-08 D-18)', () => {
  assert.match(SRC, /topicId\?:\s*string\s*\|\s*null/);
});

// ---- DP1 — reads `clarity:diagnostics:<topicId>` on mount ----------------

test('DP1: reads clarity:diagnostics:<topicId> from localStorage on mount', () => {
  const c = code(SRC);
  assert.match(c, /clarity:diagnostics:/);
  assert.match(c, /localStorage\.getItem/);
});

// ---- DP2 — writes the same key on toggle ---------------------------------

test('DP2: writes localStorage on toggle (set 1 / 0)', () => {
  const c = code(SRC);
  assert.match(c, /localStorage\.setItem/);
  // Stored value is the literal '1' / '0' (matches topic-strip.tsx pattern).
  assert.match(c, /['"]1['"]/);
  assert.match(c, /['"]0['"]/);
});

// ---- DP3 — per-topic key independence -----------------------------------

test('DP3: key is keyed on topicId — per-topic independence', () => {
  const c = code(SRC);
  // The key is constructed with the topicId embedded.
  assert.match(c, /clarity:diagnostics:\$\{topicId\}/);
});

// ---- DP4 — try/catch swallows localStorage failures ---------------------

test('DP4: try/catch around localStorage read AND write (privacy mode safe)', () => {
  const c = code(SRC);
  // At least two try/catch blocks (one for getItem, one for setItem).
  const tryMatches = c.match(/try\s*\{/g);
  assert.ok(tryMatches && tryMatches.length >= 2, 'expected ≥2 try blocks');
});

// ---- DP5 — graceful degrade when topicId is null/undefined --------------

test('DP5: when topicId is null/undefined, no localStorage I/O occurs', () => {
  const c = code(SRC);
  // storageKey() returns null when topicId is missing; both effect + onClick
  // bail before touching localStorage.
  assert.match(c, /storageKey/);
  assert.match(c, /if\s*\(!key\)/);
});

// ---- DP-data-attr: the rendered button carries data-clarity-diagnostics-topic

test('DP-data-attr: button renders data-clarity-diagnostics-topic for testing', () => {
  assert.match(SRC, /data-clarity-diagnostics-topic/);
});

// ---- DP-actions-row: ChatActionsRow threads topicId + value-aware onToggle

test('DP-actions-row (rc.8 final 2026-05-26): ChatActionsRow keeps diagnosticsTopicId on the type signature; DiagnosticsToggle JSX removed per simplification', () => {
  const AR = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'actions-row.tsx'),
    'utf8',
  );
  // Type signature retained so callers don't need to change. v1.1+ may
  // restore the visible toggle (slash-command / settings page / URL param).
  assert.match(AR, /diagnosticsTopicId/);
  // But the JSX is gone — the previous `topicId={diagnosticsTopicId}` prop
  // pass-through lived inside <DiagnosticsToggle>, which was removed.
  assert.doesNotMatch(
    AR,
    /topicId=\{diagnosticsTopicId\}/,
    'DiagnosticsToggle JSX (and its topicId prop pass-through) must be removed in rc.8 final',
  );
});
