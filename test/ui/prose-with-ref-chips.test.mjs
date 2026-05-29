// test/ui/prose-with-ref-chips.test.mjs
//
// Plan 07-04 Task 3 (D-I31-03) — ProseWithRefChips is REWRITTEN to delegate to
// the ref-aware SafeMarkdown (Task 2) instead of its old manual-regex split.
// The operator reviewed BEAAA-828 (2026-05-29) and reported the main Reader
// prose body "looks half rendered… still asterisks, and still BEAAA-704 etc.
// that do not show the title." The old ProseWithRefChips rendered text segments
// as PLAIN text (literal `## BLUF` / `**bold**`) and refs as a title-less chip.
// Now the body renders via `<SafeMarkdown text={body} linkRefs companyPrefix=…/>`
// — formatted markdown AND clickable titled chips, identical to the TL;DR strip.
//
// The instance-agnostic ref regex now lives ONCE in safe-markdown.ts (asserted
// in test/ui/safe-markdown.test.mjs). prose-with-ref-chips keeps:
//   - the `{ body }` prop shape (so the Reader + chat call sites are unchanged),
//   - the companyPrefix derivation (useHostLocation + extractCompanyPrefixFromPathname),
//   - the `clarity-reader-prose` wrapper class,
//   - the `if (!body) return null` guard,
// and DROPS the manual `re.exec(body)` split loop + the local BROAD_REF_PATTERN.
//
// Source-grep idiom (Node 24's strip-types loads .ts but NOT .tsx).

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

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('prose-with-ref-chips (07-04): delegates to ref-aware SafeMarkdown (linkRefs + companyPrefix)', () => {
  const c = code(SRC);
  assert.match(c, /import\s*\{[^}]*\bSafeMarkdown\b[^}]*\}\s*from/, 'imports SafeMarkdown');
  assert.match(c, /<SafeMarkdown\b/, 'renders <SafeMarkdown />');
  assert.match(c, /linkRefs/, 'passes linkRefs to enable ref-awareness');
  assert.match(c, /companyPrefix=\{companyPrefix\}/, 'threads the derived companyPrefix into SafeMarkdown');
});

test('prose-with-ref-chips (07-04): derives companyPrefix from the pathname (instance-agnostic intent preserved)', () => {
  const c = code(SRC);
  assert.match(c, /useHostLocation/, 'reads the current pathname via useHostLocation');
  assert.match(c, /extractCompanyPrefixFromPathname/, 'derives the prefix via extractCompanyPrefixFromPathname');
});

test('prose-with-ref-chips (07-04): keeps the clarity-reader-prose wrapper + the empty-body guard + the { body } prop shape', () => {
  const c = code(SRC);
  assert.match(c, /clarity-reader-prose/, 'keeps the clarity-reader-prose wrapper class');
  assert.match(c, /if\s*\(!body\)\s*return null/, 'keeps the empty-body guard');
  assert.match(c, /ProseWithRefChips\(\{\s*body\s*\}/, 'prop shape stays { body } so call sites are unchanged');
});

test('prose-with-ref-chips (07-04): the manual regex split loop is GONE (delegation, not hand-rolled split)', () => {
  const c = code(SRC);
  assert.doesNotMatch(c, /re\.exec\(body\)/, 'no manual re.exec(body) split loop');
  assert.doesNotMatch(c, /while\s*\(\s*\(match\s*=\s*re\.exec/, 'no manual match-loop');
  assert.doesNotMatch(c, /const\s+BROAD_REF_PATTERN/, 'the local BROAD_REF_PATTERN moved to safe-markdown.ts');
});

test('prose-with-ref-chips (07-04): no dangerouslySetInnerHTML (SafeMarkdown preserves the no-innerHTML posture)', () => {
  const c = code(SRC);
  assert.doesNotMatch(c, /dangerouslySetInnerHTML/);
});
