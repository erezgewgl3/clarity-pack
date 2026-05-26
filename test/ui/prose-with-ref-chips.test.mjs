// test/ui/prose-with-ref-chips.test.mjs
//
// Plan B rc.8 hotfix (2026-05-26 Playwright verification) — REF_PATTERN
// generalization. The Plan 02-03 implementation hardcoded `/\bBEAAA-\d+\b/g`
// so refs only resolved for the BEAAA company. On every other company prefix
// (COU on Countermoves, ACME on a hypothetical install, etc.) every
// `COU-NNN` mention in chat bodies stayed plain text — directly violating
// the project's "zero rabbit-holes" core value (PROJECT.md).
//
// Test is source-grep style: assert the regex matches a generic prefix
// pattern (2-8 uppercase letters + digits) so refs work for ANY company.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/reader/prose-with-ref-chips.tsx'),
  'utf8',
);

test('prose-with-ref-chips: REF_PATTERN matches any uppercase company prefix (NOT just BEAAA)', () => {
  // Extract the const REF_PATTERN regex from the source so we can apply it.
  const match = SRC.match(/const\s+REF_PATTERN\s*=\s*(\/[^/]+\/[gimsuy]*)/);
  assert.ok(match, 'REF_PATTERN constant must be defined');
  // eslint-disable-next-line no-new-func
  const re = new Function('return ' + match[1])();
  assert.ok(re instanceof RegExp, 'REF_PATTERN must be a RegExp');

  // Must match a variety of company prefixes.
  const cases = [
    { input: 'See BEAAA-141 for details', want: ['BEAAA-141'] },
    { input: 'Recovery issue COU-2486 is resolving the missing disposition.', want: ['COU-2486'] },
    { input: 'Filed under ACME-9999 last week.', want: ['ACME-9999'] },
    { input: 'Two refs: COU-1 and BEAAA-2.', want: ['COU-1', 'BEAAA-2'] },
    { input: 'Mixed-case foo-bar should not match.', want: [] },
    { input: 'lowercase abc-123 should not match.', want: [] },
    { input: 'A-1 too short prefix should not match.', want: [] },
  ];

  for (const { input, want } of cases) {
    const found = input.match(new RegExp(re.source, 'g')) ?? [];
    assert.deepEqual(found, want, `regex match failure for input: ${JSON.stringify(input)}`);
  }
});

test('prose-with-ref-chips: REF_PATTERN is NOT hardcoded to BEAAA', () => {
  // The old broken pattern was /\bBEAAA-\d+\b/g — a generalized version
  // must NOT contain a literal BEAAA-bound.
  assert.doesNotMatch(
    SRC,
    /REF_PATTERN\s*=\s*\/\\bBEAAA-/,
    'REF_PATTERN must not be hardcoded to BEAAA — must generalize across company prefixes',
  );
});
