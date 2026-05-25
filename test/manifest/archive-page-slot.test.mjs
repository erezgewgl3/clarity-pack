// test/manifest/archive-page-slot.test.mjs
//
// Plan 05-08 Task 4 — pin the new clarity-archive page slot.
//
// Asserts the manifest declares a page slot with:
//   - id: 'clarity-archive'
//   - routePath: 'archive'        (NOT 'clarity-pack/archive')
//   - exportName: 'ArchivePage'
//   - type: 'page'
//
// Route resolves to /<companyPrefix>/archive per memory
// `clarity-pack-plugin-page-routes`.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import manifest from '../../src/manifest.ts';

test('MS1: manifest declares the clarity-archive page slot with routePath archive', () => {
  const slot = manifest.ui?.slots?.find((s) => s.id === 'clarity-archive');
  assert.ok(slot, 'clarity-archive slot must be declared');
  assert.equal(slot.type, 'page');
  assert.equal(slot.exportName, 'ArchivePage');
  assert.equal(slot.routePath, 'archive');
});

test('MS2: clarity-archive routePath is NOT prefixed with clarity-pack/', () => {
  // Per memory `clarity-pack-plugin-page-routes`: the host resolves
  // routePath against companyPrefix only (`/<prefix>/<routePath>`). A
  // routePath of `clarity-pack/archive` would resolve to a 404
  // `/<prefix>/clarity-pack/archive`. CONTEXT.md D-15 had this slip; the
  // plan corrects it.
  const slot = manifest.ui?.slots?.find((s) => s.id === 'clarity-archive');
  assert.ok(slot);
  assert.doesNotMatch(slot.routePath, /\//);
  assert.doesNotMatch(slot.routePath, /clarity-pack/i);
});

test('MS3: manifest slot list contains the archive slot + the four other clarity slots', () => {
  const slots = manifest.ui?.slots ?? [];
  const ids = new Set(slots.map((s) => s.id));
  for (const id of [
    'clarity-reader',
    'clarity-situation',
    'clarity-bulletin',
    'clarity-chat',
    'clarity-archive',
    'clarity-settings',
  ]) {
    assert.ok(ids.has(id), `manifest must declare ${id} slot`);
  }
});
