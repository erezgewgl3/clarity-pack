// test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs
//
// Plan 14-02 Task 2 (T-14-08 / SC5 / NO_UUID_LEAK) — extend the Phase-11 11-07 +
// Phase-13 13-03 render-scan UUID guard to the new shared <ReplyInPlace> primitive.
//
// The split-identity invariant: the mutation carries the UUID (leafIssueUuid /
// targetAgentUuid / targetIssueUuid are dispatch-only consts), while ONLY
// leafIssueId + awaitedPartyLabel ever reach a rendered text node. This suite
// proves the *Uuid values are NEVER interpolated inside a JSX `{...}` render
// expression — they live in dispatch args / plain consts only.
//
// Convention: source-grep (no jsdom), mirroring employee-row-no-uuid-leak.test.mjs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SRC = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/_shared/reply-in-place.tsx'),
  'utf8',
);
const CODE = stripComments(SRC);

const LEAK_FIELDS = ['leafIssueUuid', 'targetAgentUuid', 'targetIssueUuid', 'mutationIssueUuid'];

// ---------------------------------------------------------------------------
// No UUID field interpolated inside a JSX text node `>{ ... }<`.
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — no *Uuid field rendered inside a JSX text node', () => {
  for (const field of LEAK_FIELDS) {
    const jsxTextNode = new RegExp(`>\\s*\\{[^{}]*\\b${field}\\b[^{}]*\\}\\s*<`, 'g');
    assert.equal(
      (CODE.match(jsxTextNode) || []).length,
      0,
      `${field} must never render as a JSX text node`,
    );
  }
});

test('NO_UUID_LEAK — no *Uuid field interpolated into a template literal that renders', () => {
  for (const field of LEAK_FIELDS) {
    // The only template literals in the component are the toast message and the
    // navigate URL. Neither may embed a UUID field.
    const tmpl = new RegExp(`\\$\\{[^}]*\\b${field}\\b[^}]*\\}`, 'g');
    const matches = CODE.match(tmpl) || [];
    assert.equal(matches.length, 0, `${field} must not be interpolated into a rendered/nav template: ${matches}`);
  }
});

// ---------------------------------------------------------------------------
// The Open↗ URL + the toast use the HUMAN key (leafIssueId / awaitedPartyLabel).
// ---------------------------------------------------------------------------

test('Open↗ navigates with the HUMAN leafIssueId, NOT a UUID', () => {
  assert.match(CODE, /navigate\(`\/\$\{companyPrefix\}\/issues\/\$\{leafIssueId\}`\)/);
  // The nav URL never embeds the UUID.
  assert.doesNotMatch(CODE, /issues\/\$\{leafIssueUuid\}/);
  assert.doesNotMatch(CODE, /issues\/\$\{mutationIssueUuid\}/);
});

test('the success toast renders leafIssueId + awaitedPartyLabel only (human strings)', () => {
  assert.match(CODE, /Replied to \$\{awaitedPartyLabel\}/);
  // The toast may include leafIssueId (human key) but never a UUID.
  const toastLine = CODE.slice(CODE.indexOf('Replied to'), CODE.indexOf('Replied to') + 120);
  for (const field of LEAK_FIELDS) {
    assert.doesNotMatch(toastLine, new RegExp(`\\b${field}\\b`), `toast must not carry ${field}`);
  }
});

// ---------------------------------------------------------------------------
// The mutation UUID is consumed as a dispatch arg only (the legitimate use).
// ---------------------------------------------------------------------------

test('mutationIssueUuid is consumed ONLY as the dispatch arg leafIssueUuid', () => {
  assert.match(CODE, /leafIssueUuid:\s*mutationIssueUuid/, 'dispatch arg use is present (legitimate)');
  // It is read into a plain const, never inside a render expression.
  assert.match(CODE, /const mutationIssueUuid = leafIssueUuid \?\? leafIssueId/);
});
