// test/ui/ref-chip-title.test.mjs
//
// Plan 07-04 Task 1 (D-I31-01) — RefChip renders `ID — title`. After item 3
// (07-02) shipped, the operator reviewed BEAAA-828 live and reported that
// in-prose refs (BEAAA-704 etc.) "do not show the title" — the chip rendered
// only `ID · status`. This plan changes the TWO resolved render paths (the
// clickable anchor path + the no-prefix span path) to render
// `card.id — card.title` (em-dash), with status as a SMALL badge element
// (clarity-ref-chip-status / data-status) instead of the inline `· status`
// suffix. The bare-ID loading/!card degrade (clarity-ref-chip--loading) and
// the nav.linkProps anchor contract + the hover-peek wrap are UNCHANGED.
//
// Source-grep idiom (Node 24's strip-types loads .ts but NOT .tsx — same
// constraint as ref-chip-peek.test.mjs which this mirrors). Runtime DOM
// behaviour is verified live at the orchestrator's BEAAA-828 drill.
//
// What this test PINS:
//   - The resolved render composes card.id AND card.title together (the title
//     is now shown — D-I31-01).
//   - The OLD `{card.id} · {card.status}` inline-suffix literal is GONE on both
//     resolved paths.
//   - Status renders as a dedicated badge element (clarity-ref-chip-status /
//     data-status={card.status}), not the inline `·` suffix.
//   - The clickable anchor contract survives (nav.linkProps + /issues/).
//   - The bare-ID loading degrade survives (clarity-ref-chip--loading + {refId}).
//   - No dangerouslySetInnerHTML (R3 invariant).

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

test('ref-chip.tsx file exists', () => {
  assert.ok(existsSync(FILE), 'src/ui/primitives/ref-chip.tsx must exist');
});

test('D-I31-01 — the resolved chip renders card.title adjacent to card.id (the title is now shown)', () => {
  const src = code(read());
  // The chip's visible label now composes id + title. Accept either an em-dash
  // template literal (`${card.id} — ${card.title}`) or id and title rendered as
  // adjacent JSX with an em-dash separator. The key invariant: card.title is
  // rendered as part of the chip's visible content (not only in the peek).
  // Find a render of card.title that sits OUTSIDE the peek block (the peek
  // already referenced card.title pre-07-04, so we require a NEW occurrence
  // near a clarity-ref-chip render, not the peek).
  assert.match(
    src,
    /clarity-ref-chip-label[\s\S]{0,400}card\.title|card\.id[\s\S]{0,40}—[\s\S]{0,40}card\.title|card\.title[\s\S]{0,40}—[\s\S]{0,40}card\.id/,
    'a resolved chip render composes card.id and card.title with an em-dash',
  );
});

test('D-I31-01 — the OLD `{card.id} · {card.status}` inline-suffix literal is GONE', () => {
  const src = code(read());
  assert.doesNotMatch(
    src,
    /\{card\.id\}\s*·\s*\{card\.status\}/,
    'the legacy "ID · status" inline-suffix render must be removed on both resolved paths',
  );
});

test('D-I31-01 — status renders as a dedicated badge element (clarity-ref-chip-status / data-status), not the inline · suffix', () => {
  const src = code(read());
  assert.match(
    src,
    /clarity-ref-chip-status/,
    'status renders inside a dedicated clarity-ref-chip-status badge span',
  );
});

test('D-I31-01 — clickable anchor contract survives (nav.linkProps to /<prefix>/issues/<id>)', () => {
  const src = read();
  assert.match(
    src,
    /nav\.linkProps\(`\/\$\{companyPrefix\}\/issues\/\$\{card\.id\}`\)/,
    'click target unchanged (nav.linkProps — never raw <a href>)',
  );
});

test('D-I31-01 — the bare-ID loading degrade survives (clarity-ref-chip--loading + {refId})', () => {
  const src = code(read());
  assert.match(src, /clarity-ref-chip--loading/, 'loading degrade class preserved');
  assert.match(src, /\{refId\}/, 'loading degrade renders the bare {refId}');
});

test('R3 — NO dangerouslySetInnerHTML in ref-chip.tsx', () => {
  const src = code(read());
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
});
