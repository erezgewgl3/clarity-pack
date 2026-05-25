// test/ui/chat-pinned-chip-flash.test.mjs
//
// Plan 05-06 Task 1 (item b, D-12) — source-grep contract tests pinning the
// Pinned-messages chip click → scroll + 1.5s flash-highlight behavior.
//
// D-12 (CONTEXT.md): Right-rail Pinned-messages chip click scrolls to the
// source comment and applies `.flash-highlight` for 1500ms. The Plan 04.2-04
// `.flash-highlight` keyframe at chat.css 2261-2281 is REUSED — no new
// keyframe is introduced.
//
// SOURCE-GREP idiom.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RAIL = readFileSync(
  path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'context-rail.tsx'),
  'utf8',
);
const CSS = readFileSync(
  path.join(ROOT, 'src', 'ui', 'styles', 'chat.css'),
  'utf8',
);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('context-rail.tsx: references the flash-highlight class name (D-12)', () => {
  const c = code(RAIL);
  assert.match(c, /flash-highlight/, 'context-rail must add the .flash-highlight class on chip click');
});

test('context-rail.tsx: click handler scrolls the source comment into view', () => {
  const c = code(RAIL);
  assert.match(c, /scrollIntoView/, 'chip click must invoke scrollIntoView on the source #msg-<commentId> element');
  assert.match(
    c,
    /getElementById\(\s*[`'"]msg-/,
    'chip click must address the message via the document.getElementById("msg-<commentId>") DOM target',
  );
});

test('context-rail.tsx: scroll → classList.add → setTimeout → classList.remove sequence is present', () => {
  const c = code(RAIL);
  // The 1500ms removal is the load-bearing convergence — the keyframe runs
  // for 1.5s by chat.css contract, so the class is removed after the animation
  // settles. Match flexibly: the four primitives appear within a single
  // handler region (within ~400 chars).
  assert.match(
    c,
    /classList\.add\(\s*['"]flash-highlight['"]\s*\)[\s\S]{0,400}setTimeout\([\s\S]{0,400}classList\.remove\(\s*['"]flash-highlight['"]\s*\)/,
    'handler must add then remove .flash-highlight via setTimeout for the 1.5s lifecycle',
  );
});

test('chat.css: exactly ONE @keyframes clarity-flash is defined (NO duplicate)', () => {
  const matches = CSS.match(/@keyframes\s+clarity-flash\b/g) || [];
  assert.equal(
    matches.length,
    1,
    'chat.css must define @keyframes clarity-flash exactly ONCE — Plan 04.2-04 already owns it (lines 2261-2281)',
  );
});

test('chat.css: the .flash-highlight class is owned by Plan 04.2-04 — count unchanged by this plan', () => {
  // Pre-existing usages of `.flash-highlight` in chat.css at the Plan 04.2-04
  // baseline:
  //   - one mention inside the Plan 04.2-04 comment block at line 2258
  //   - the .msg.flash-highlight .bubble animation rule at line 2271
  //   - the prefers-reduced-motion variant at line 2277
  // The Plan 05-06 chip handler adds the class via JS only (NO new CSS rule),
  // so the chat.css occurrence count must remain at 3. A regression that
  // added a duplicate keyframe block would push this number up.
  const matches = CSS.match(/\.flash-highlight\b/g) || [];
  assert.equal(
    matches.length,
    3,
    'chat.css must contain exactly 3 .flash-highlight occurrences (Plan 04.2-04 baseline: comment + selector + reduced-motion variant). A change means a duplicate rule was added.',
  );
});

test('context-rail.tsx: a Pinned chip click target exists (button or anchor)', () => {
  const c = code(RAIL);
  // The chip mounts as a real <button> so keyboard activation works without
  // a custom handler. Source-grep idiom: a button carrying the pin-chip
  // class OR the pinned-chip class.
  assert.match(
    c,
    /className=['"](?:pin-chip|pinned-chip)['"]|<button[\s\S]{0,200}pin-chip|<button[\s\S]{0,200}pinned-chip/,
    'the chip mounts as a <button className="pin-chip"> (or equivalent) so keyboard activation works',
  );
});

test('context-rail.tsx: the Pinned-messages section heading exists', () => {
  const c = code(RAIL);
  // The chip block sits under its own heading so the rail's information
  // architecture is clear ("Pinned" heading + chip rows).
  assert.match(
    c,
    /<h3>\s*Pinned\b/,
    'the right rail renders a <h3>Pinned</h3> heading for the chip block',
  );
});
