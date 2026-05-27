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

test('prose-with-ref-chips: BROAD_REF_PATTERN fallback matches any uppercase company prefix (used when URL has no prefix)', () => {
  // 2026-05-27 BEAAA hotfix: the runtime regex is now company-prefix-scoped
  // (companyPrefix from extractCompanyPrefixFromPathname → /\b<PREFIX>-\d+\b/g).
  // The BROAD pattern is the FALLBACK when pathname has no prefix (root URL,
  // standalone surfaces). This test still validates the broad pattern's
  // generality — it just no longer covers the in-company-router primary path.
  const match = SRC.match(/const\s+BROAD_REF_PATTERN\s*=\s*(\/[^/]+\/[gimsuy]*)/);
  assert.ok(match, 'BROAD_REF_PATTERN constant must be defined as the no-prefix fallback');
  // eslint-disable-next-line no-new-func
  const re = new Function('return ' + match[1])();
  assert.ok(re instanceof RegExp, 'BROAD_REF_PATTERN must be a RegExp');

  // Must match a variety of company prefixes when the fallback is in effect.
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

test('prose-with-ref-chips: BROAD_REF_PATTERN is NOT hardcoded to BEAAA', () => {
  // The old broken pattern was /\bBEAAA-\d+\b/g — the fallback broad
  // pattern must remain BEAAA-agnostic.
  assert.doesNotMatch(
    SRC,
    /BROAD_REF_PATTERN\s*=\s*\/\\bBEAAA-/,
    'BROAD_REF_PATTERN must not be hardcoded to BEAAA — must generalize across company prefixes',
  );
});

test('prose-with-ref-chips (2026-05-27 BEAAA hotfix): runtime regex is company-prefix-scoped to prevent over-match on YAML-shaped body content', () => {
  // BEAAA-828's body contained YAML tokens like DAY-3, GATE-2, PAGE-1, BY-1,
  // DRAFT-1 — all matched by the broad pattern, all 404'd on fetch, the
  // Reader threw and rendered "Clarity Pack: failed to render". The fix
  // narrows the regex to the current company's prefix when the URL exposes
  // one (always the case inside /:companyPrefix/issues/:id).
  assert.match(
    SRC,
    /useHostLocation/,
    'must import useHostLocation to learn the current pathname',
  );
  assert.match(
    SRC,
    /extractCompanyPrefixFromPathname/,
    'must call extractCompanyPrefixFromPathname to scope the regex',
  );
  assert.match(
    SRC,
    /companyPrefix\s*\n?\s*\?\s*new RegExp/,
    'must build a prefix-scoped regex when companyPrefix is known',
  );
});
