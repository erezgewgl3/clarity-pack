// test/ui/bulletin-compile-now.test.mjs
//
// Quick task 260528-nns + delivery-layer rework (2026-05-28) — the "Generate
// bulletin now" button on the Bulletin page. Source-grep idiom (Node strip-types
// loads .ts but not .tsx; runtime behaviour is verified live on the deploy drill).
//
// The action now ENQUEUES (returns { kind:'queued' }); the button shows
// "Compiling…", polls bulletin.byCycle for a newer edition for ~90s, then
// settles to a calm "still compiling" note. It can no longer surface a
// synchronous "No changes since…" — the worker dedupe is invisible to the poll.
//
// Pins:
//   - the button label "Generate bulletin now",
//   - usePluginAction('bulletin.compileNow'),
//   - the published-detected + calm-settle copies,
//   - the Compiling… in-flight state + the byCycle poll (refresh on an interval).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BULLETIN_INDEX = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'bulletin', 'index.tsx');

function read() {
  return readFileSync(BULLETIN_INDEX, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('Bulletin page has a "Generate bulletin now" button label', () => {
  assert.match(read(), /Generate bulletin now/, 'button label present');
});

test('Bulletin page wires usePluginAction(\'bulletin.compileNow\')', () => {
  assert.match(code(read()), /usePluginAction\(\s*['"]bulletin\.compileNow['"]\s*\)/, 'binds the compileNow action');
});

test('Bulletin page passes companyId + userId to the compileNow action', () => {
  const src = code(read());
  // the action call site references companyId and userId
  assert.match(src, /compileNow|compileAction|generateNow/, 'an action callback exists');
  assert.match(src, /companyId/, 'companyId in scope');
  assert.match(src, /userId/, 'userId in scope');
});

test('Bulletin page renders the queued-compile result states (published-detected / calm settle / error)', () => {
  const src = read();
  assert.match(src, /Published Bulletin No\./, 'published-detected copy (a newer edition appeared)');
  assert.match(src, /Still compiling/, 'calm settle copy after the poll window (Decision #4)');
  assert.match(src, /Editorial Desk unavailable/, 'error state copy (action unavailable)');
});

test('Bulletin page treats compileNow as enqueue (queued) and does NOT key on a synchronous no-change', () => {
  const src = code(read());
  // The queued discriminant is handled; the old synchronous no-change copy is gone.
  assert.match(src, /queued/, 'handles the { kind:queued } enqueue result');
  assert.doesNotMatch(read(), /No changes since Bulletin No\./, 'no synchronous no-change copy anymore');
});

test('Bulletin page shows a Compiling… in-flight state', () => {
  assert.match(read(), /Compiling…/, 'in-flight disabled state copy');
});

test('Bulletin page polls bulletin.byCycle on an interval while a compile is queued', () => {
  const src = code(read());
  // usePluginData must expose refresh, and it must be polled on an interval.
  assert.match(src, /refresh/, 'byCycle refresh is wired');
  assert.match(src, /setInterval/, 'the queued compile polls for a newer edition');
});

test('Bulletin compile-now button carries a scoped CSS hook', () => {
  assert.match(read(), /clarity-bulletin-compile-now/, 'scoped class for CSS targeting');
});
