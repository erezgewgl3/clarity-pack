// test/ui/ref-chip-hidden-as-ref.test.mjs
//
// Plan 250530 v1.1.5 — RefChip degrades to PLAIN TEXT (no chip border, no
// status badge, no clickable anchor, no hover-peek) when resolve-refs flags
// the card with hiddenAsRef:true. This is the structural sink for the
// BEAAA-1000 problem: even with v1.1.4 chip styling, a reference to BEAAA-
// 1168 (host title literally "Compile TL;DR — <uuid>") would still render as
// a messy chip because the agent-set TITLE is messy. Hiding the chip entirely
// for clarity-pack operation issues is the right move — the operator never
// needs to navigate to internal bookkeeping.
//
// Source-grep idiom (Node 24's strip-types loads .ts but NOT .tsx) — mirrors
// ref-chip-title.test.mjs and ref-chip-peek.test.mjs.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'ref-chip.tsx');

function read() {
  return readFileSync(FILE, 'utf8');
}
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('ref-chip.tsx exists', () => {
  assert.ok(existsSync(FILE));
});

test('v1.1.5 — the chip checks card.hiddenAsRef and short-circuits BEFORE the chip-rendering paths', () => {
  const src = code(read());
  // The check must appear AFTER the loading/!card degrade (so a missing card
  // still loads) but BEFORE the normal chip render (so the hidden branch wins).
  assert.match(
    src,
    /hiddenAsRef/,
    'ref-chip.tsx references card.hiddenAsRef — the hidden-render branch must exist',
  );
  const idxLoading = src.indexOf('clarity-ref-chip--loading');
  const idxHidden = src.indexOf('hiddenAsRef');
  const idxAnchor = src.indexOf('nav.linkProps');
  assert.ok(idxLoading > 0 && idxHidden > 0 && idxAnchor > 0, 'all three render paths exist');
  assert.ok(
    idxLoading < idxHidden && idxHidden < idxAnchor,
    'hidden-render branch sits AFTER the loading degrade and BEFORE the anchor render',
  );
});

test('v1.1.5 — the hidden render is a PLAIN span (no anchor, no chip class, no peek)', () => {
  const src = code(read());
  // Locate the hidden branch — a small fragment around the card.hiddenAsRef
  // condition — and assert it returns a plain span with the bare id only.
  const m = src.match(/if\s*\(card\.hiddenAsRef\)\s*\{[\s\S]{0,400}?\}/);
  assert.ok(m, 'a `if (card.hiddenAsRef) { ... }` branch exists');
  const branch = m[0];
  // No nav.linkProps and no anchor (<a) inside the hidden branch — operator
  // should never navigate to internal bookkeeping.
  assert.doesNotMatch(branch, /<a\s/, 'no <a> anchor in the hidden branch');
  assert.doesNotMatch(branch, /nav\.linkProps/, 'no nav.linkProps in the hidden branch');
  // No chip-frame class (we hide ALL chip styling — border, badge, etc.).
  assert.doesNotMatch(branch, /clarity-ref-chip[\s"'`]/, 'no clarity-ref-chip frame class');
  // No hover-peek mount in the hidden branch.
  assert.doesNotMatch(branch, /peek/i, 'no peek popover in the hidden branch');
  // It DOES render the id text.
  assert.match(branch, /card\.id|refId/, 'the hidden branch renders the bare id');
});

test('v1.1.5 — the loading degrade still renders the bare refId (back-compat preserved)', () => {
  const src = code(read());
  assert.match(src, /clarity-ref-chip--loading/, 'loading degrade preserved');
  assert.match(src, /\{refId\}/, 'loading degrade still renders the bare refId');
});

test('v1.1.5 — the normal resolved chip render path is UNCHANGED for non-hidden cards', () => {
  const src = code(read());
  // The clarity-ref-chip-id + status badge + anchor still present.
  assert.match(src, /clarity-ref-chip-id/, 'id span class survives');
  assert.match(src, /clarity-ref-chip-status/, 'status badge class survives');
  assert.match(src, /nav\.linkProps/, 'anchor contract survives');
});

test('v1.1.5 SAFETY — no dangerouslySetInnerHTML anywhere in ref-chip.tsx', () => {
  const src = code(read());
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
});

test('v1.1.5 SAFETY — the hidden branch does NOT mount an anchor with the id as href (no implicit click target)', () => {
  // Even though we know the id, we deliberately do NOT make the plain-text
  // span clickable. Internal compile-tracking issues are NOT useful operator
  // navigation targets.
  const src = read();
  const m = src.match(/if\s*\(card\.hiddenAsRef\)\s*\{[\s\S]{0,400}?\}/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /href\s*=/, 'no href= attribute in the hidden branch');
});
