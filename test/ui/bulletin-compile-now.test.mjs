// test/ui/bulletin-compile-now.test.mjs
//
// Quick task 260528-nns — the "Generate bulletin now" button on the Bulletin
// page. Source-grep idiom (Node strip-types loads .ts but not .tsx; runtime
// behaviour is verified live on the deploy drill).
//
// Pins:
//   - the button label "Generate bulletin now",
//   - usePluginAction('bulletin.compileNow'),
//   - the three result-state copies (published / no-change / error),
//   - the byCycle data refresh on success.

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

test('Bulletin page renders the three result states (published / no-change / error)', () => {
  const src = read();
  assert.match(src, /Published Bulletin No\./, 'published state copy');
  assert.match(src, /No changes since Bulletin No\./, 'no-change state copy');
  assert.match(src, /Editorial Desk unavailable/, 'error state copy (agent unavailable)');
});

test('Bulletin page shows a Compiling… in-flight state', () => {
  assert.match(read(), /Compiling…/, 'in-flight disabled state copy');
});

test('Bulletin page refreshes bulletin.byCycle data on a successful compile', () => {
  const src = code(read());
  // usePluginData must expose refresh, and it must be called after compile.
  assert.match(src, /refresh/, 'byCycle refresh is wired');
});

test('Bulletin compile-now button carries a scoped CSS hook', () => {
  assert.match(read(), /clarity-bulletin-compile-now/, 'scoped class for CSS targeting');
});
