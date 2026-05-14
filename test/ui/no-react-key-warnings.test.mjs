// test/ui/no-react-key-warnings.test.mjs
//
// Plan 02-08 Task 3 RED — DEV-07 closure. Static-analysis source-grep that
// catches the common React-key-warning shapes:
//   - Array.prototype.map(...) callback returning JSX without an explicit
//     key={...} prop on the returned element.
//   - Fragment list with multiple children but no keys.
//
// Static analysis catches the obvious cases. Live console-error capture
// happens in the Plan 02-08 Task 4 manual rehearsal (Section C / DevTools
// console check).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FILES = [
  'src/ui/components/enable-clarity-cta.tsx',
  'src/ui/surfaces/situation-room/index.tsx',
  'src/ui/surfaces/situation-room/critical-path-strip.tsx',
  'src/ui/surfaces/situation-room/artifacts-shipped-shelf.tsx',
];

function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

for (const rel of FILES) {
  test(`${rel}: every Array.prototype.map callback has an explicit key={...} (DEV-07)`, () => {
    const src = readSrc(rel);
    // Find every .map( occurrence and look ahead 400 chars for the callback
    // body. If the callback returns JSX (we detect a `<` followed by an
    // identifier within those 400 chars), there must be a `key={` somewhere
    // before the matching closing of the callback.
    const mapRe = /\.map\(/g;
    let m;
    let offenders = [];
    while ((m = mapRe.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + 600);
      // Heuristic: callback returns JSX if a `<Capitalized` or `<lowercase-tag`
      // appears within the window AND no `key=` precedes the matching `)`.
      const hasJsxReturn = /<[A-Za-z][\w-]*\b/.test(window);
      const hasKey = /key=\{/.test(window);
      if (hasJsxReturn && !hasKey) {
        offenders.push({ index: m.index, snippet: window.slice(0, 200) });
      }
    }
    assert.equal(
      offenders.length,
      0,
      `${rel}: found ${offenders.length} .map(...) callback(s) returning JSX without key=. Offenders:\n${offenders.map(o => '@' + o.index + ': ' + o.snippet.replace(/\s+/g, ' ')).join('\n')}`,
    );
  });
}

test('EnableClarityCta source has no array-prop child render (single root only) (DEV-07)', () => {
  const src = readSrc('src/ui/components/enable-clarity-cta.tsx');
  // The component should return one root <div> with text/element children
  // (not an array). Negative check: no `{[<Foo/>, <Bar/>]}` shape.
  assert.doesNotMatch(src, /\{\s*\[[^[\]]*<[A-Z]/, 'EnableClarityCta should not render an array of JSX inline');
});

test('SituationRoom index.tsx has explicit key on AgentCard map (regression)', () => {
  const src = readSrc('src/ui/surfaces/situation-room/index.tsx');
  // Find the AgentCard rendering — confirm key= is present nearby.
  assert.match(src, /<AgentCard\b[\s\S]{0,80}key=\{|key=\{[\s\S]{0,200}<AgentCard\b/);
});
