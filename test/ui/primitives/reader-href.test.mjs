// test/ui/primitives/reader-href.test.mjs
//
// Plan 18-01 Task 2 (LEG-01) — buildReaderHref unit test + render-scan funnel guard.
//
// Two parts (mirroring the *-no-uuid-leak source-grep render-scan convention — no
// jsdom in devDependencies, so we source-grep the surface files):
//   (1) UNIT — buildReaderHref returns the chosen-tier string (Tier-2 fallback, D-02).
//   (2) RENDER-SCAN — none of the five Open↗ surfaces inline `/issues/${` for the
//       issue-open path anymore; every issue-open funnels through buildReaderHref.
//       (This part passes only AFTER Task 3 re-points the sites — that is the proof
//       the funnel is complete.)
//
// INSTANCE-AGNOSTIC INVARIANT: reader-href.ts must contain no company-prefix literal
// (it takes companyPrefix as an arg). Asserted below.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const { buildReaderHref } = await import('../../../src/ui/primitives/reader-href.ts');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readSurface(rel) {
  return stripComments(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

// The five Open↗ issue-open surfaces re-pointed in Task 3.
const SURFACES = [
  'src/ui/surfaces/reader/live-blocker-panel.tsx',
  'src/ui/surfaces/situation-room/employee-row.tsx',
  'src/ui/surfaces/situation-room/blocked-backlog-expander.tsx',
  'src/ui/surfaces/bulletin/lineage-footer.tsx',
  'src/ui/surfaces/_shared/reply-in-place.tsx',
];

// ---------------------------------------------------------------------------
// (1) UNIT — buildReaderHref returns the chosen-tier string.
// ---------------------------------------------------------------------------

test('buildReaderHref — Tier-2 fallback (D-02): bare issue route, no tab carrier', () => {
  assert.equal(buildReaderHref('COU', 'BEAAA-972'), '/COU/issues/BEAAA-972');
  assert.equal(buildReaderHref('BEAAA', 'BEAAA-43'), '/BEAAA/issues/BEAAA-43');
});

test('buildReaderHref — Tier-2 verdict: NO ?tab= / #tab= carrier appended (probe deferred)', () => {
  const href = buildReaderHref('COU', 'COU-4');
  assert.doesNotMatch(href, /[?#]tab=/, 'Tier-2 fallback must not carry a tab deep-link carrier');
});

test('buildReaderHref — pure helper: same input → same output, no I/O', () => {
  assert.equal(buildReaderHref('X', 'X-1'), buildReaderHref('X', 'X-1'));
});

test('buildReaderHref — instance-agnostic: source contains no company-prefix literal', () => {
  const src = stripComments(readFileSync(path.join(REPO_ROOT, 'src/ui/primitives/reader-href.ts'), 'utf8'));
  // No hardcoded instance prefix in code (BEAAA/COU only appear in JSDoc examples,
  // which are stripped above). The prefix must arrive as the companyPrefix argument.
  assert.doesNotMatch(src, /['"`]\/(BEAAA|COU)\//, 'reader-href.ts must not hardcode an instance prefix');
  assert.match(src, /companyPrefix/, 'companyPrefix is taken as an argument');
});

// ---------------------------------------------------------------------------
// (2) RENDER-SCAN — every Open↗ issue-open funnels through buildReaderHref; no
// surface inlines `/issues/${` for the issue-open path. Passes after Task 3.
// ---------------------------------------------------------------------------

for (const rel of SURFACES) {
  test(`render-scan — ${rel} routes Open↗ through buildReaderHref (no inline /issues/$\{)`, () => {
    const code = readSurface(rel);
    assert.match(code, /buildReaderHref\(/, `${rel} must call buildReaderHref(`);
    assert.doesNotMatch(
      code,
      /\/issues\/\$\{/,
      `${rel} must NOT inline the issue path — funnel through buildReaderHref`,
    );
  });
}

// Landmine #8 — chat deep-links must remain untouched (they target /chat#h=…, not
// an issue open). employee-row + lineage-footer still call buildChatDeepLink.
test('landmine #8 — employee-row preserves buildChatDeepLink (chat deep-links untouched)', () => {
  const code = readSurface('src/ui/surfaces/situation-room/employee-row.tsx');
  assert.match(code, /buildChatDeepLink\(/, 'openChatWithOwner/assignWork must still call buildChatDeepLink');
});

test('landmine #8 — lineage-footer preserves buildChatDeepLink (chat deep-link untouched)', () => {
  const code = readSurface('src/ui/surfaces/bulletin/lineage-footer.tsx');
  assert.match(code, /buildChatDeepLink\(/, 'lineage-footer openChatWithOwner must still call buildChatDeepLink');
});
