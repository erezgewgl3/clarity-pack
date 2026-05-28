// test/ui/reader-tldr-view-driven.test.mjs
//
// View-driven rework (2026-05-28) — the Reader drives the TL;DR compile and
// polls for the result. Source-grep idiom (Node strip-types loads .ts but not
// .tsx; runtime behaviour is verified on the live Playwright drill).
//
// Pins: TldrStrip renders a live "Compiling TL;DR…" state + a truncated note +
// accepts status/truncated props; reader/index passes them through and polls
// issue.reader (setInterval) while the TL;DR is compiling.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STRIP = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader', 'tldr-strip.tsx');
const INDEX = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader', 'index.tsx');
const read = (p) => readFileSync(p, 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('TldrStrip shows a live "Compiling TL;DR…" state driven by status', () => {
  const src = read(STRIP);
  assert.match(src, /Compiling TL;DR…/, 'compiling state copy present');
  assert.match(code(src), /status\s*===\s*['"]compiling['"]/, 'renders compiling on status');
});

test('TldrStrip surfaces a truncated-task note when truncated', () => {
  const src = read(STRIP);
  assert.match(src, /Summarized from a long task/, 'truncated note copy present');
  assert.match(code(src), /truncated\s*\?/, 'note is gated on the truncated prop');
});

test('TldrStrip still shows the honest empty state when no TL;DR + not compiling', () => {
  assert.match(read(STRIP), /No TL;DR yet/, 'empty-state copy retained');
});

test('reader/index passes tldrStatus + tldrTruncated to TldrStrip', () => {
  const src = code(read(INDEX));
  assert.match(src, /status=\{data\.tldrStatus\}/, 'status threaded to TldrStrip');
  assert.match(src, /truncated=\{data\.tldrTruncated\}/, 'truncated threaded to TldrStrip');
});

test('reader/index polls issue.reader while the TL;DR is compiling', () => {
  const src = code(read(INDEX));
  assert.match(src, /tldrStatus\s*!==\s*['"]compiling['"]/, 'polling guarded on compiling status');
  assert.match(src, /setInterval/, 'a poll interval drives the refresh while compiling');
  assert.match(src, /refreshRef\.current\(\)/, 'the poll calls the by-ref refresh');
});
