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
  // GAP 7 (Plan 04-05 round 3) — the live re-drill console flooded with
  // "Each child in a list should have a unique key" warnings attributed to
  // ChatPageBody / RosterRail / Composer / ContextRail / PersistedMessage.
  // Every Array.prototype.map(...) callback in the Employee Chat surface that
  // returns JSX must carry an explicit stable key= so the warnings stay gone.
  'src/ui/surfaces/chat/index.tsx',
  'src/ui/surfaces/chat/roster-rail.tsx',
  'src/ui/surfaces/chat/topic-strip.tsx',
  'src/ui/surfaces/chat/context-rail.tsx',
  'src/ui/surfaces/chat/composer.tsx',
  'src/ui/surfaces/chat/message-thread.tsx',
];

function readSrc(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

for (const rel of FILES) {
  test(`${rel}: every Array.prototype.map callback returning JSX has an explicit key={...} (DEV-07)`, () => {
    const src = readSrc(rel);
    // Find every .map( occurrence whose callback DIRECTLY RETURNS JSX, and
    // require a key={ in that callback body.
    //
    // A JSX-returning map callback starts, immediately after the `=>`, with
    // either `<` (concise JSX) or `(` then `<` (parenthesised JSX) — e.g.
    // `.map((emp) => (<button …`. State-update / projection maps such as
    // `prev.map((o) => (o.x ? {…} : o))` or `xs.map((m) => m.body.trim())`
    // start with `(<ident>` or `(<cond>` — NOT `(<` — so they are correctly
    // excluded. This avoids the false positives the old crude 600-char
    // window scan produced on non-JSX maps.
    const mapRe = /\.map\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
    let m;
    let offenders = [];
    while ((m = mapRe.exec(src)) !== null) {
      // Position just after the `=>` and its whitespace.
      const afterArrow = mapRe.lastIndex;
      let bodyStart = afterArrow;
      let returnsJsx = false;
      if (src[bodyStart] === '{') {
        // Block body — JSX-returning iff a `return (<` (modulo whitespace)
        // appears inside the block.
        const block = src.slice(bodyStart, bodyStart + 800);
        returnsJsx = /return\s*\(\s*<[A-Za-z]/.test(block);
      } else {
        // Concise body — peek past an optional opening paren.
        if (src[bodyStart] === '(') {
          bodyStart += 1;
          while (/\s/.test(src[bodyStart] ?? '')) bodyStart += 1;
        }
        returnsJsx = /^<[A-Za-z]/.test(src.slice(bodyStart, bodyStart + 2));
      }
      if (!returnsJsx) continue;
      const window = src.slice(m.index, m.index + 800);
      if (!/key=\{/.test(window)) {
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
