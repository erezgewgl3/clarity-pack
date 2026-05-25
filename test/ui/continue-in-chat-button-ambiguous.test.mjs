// test/ui/continue-in-chat-button-ambiguous.test.mjs
//
// Plan 04.2-07 Task 3 — source-grep contract test for the new
// existing-topics-ambiguous dispatch arm on the Reader-header
// Continue-in-chat button (D-02 popover reuse + D-06 tooltip-differentiation
// + D-08 UUID hygiene). Same source-grep idiom as continue-in-chat-button-
// d9.test.mjs (Node's test runner doesn't load .tsx).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'reader',
  'continue-in-chat-button.tsx',
);

function code() {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ---- T1 — dispatch arm literally named ------------------------------------

test('T1 — file contains the literal route name "existing-topics-ambiguous" (dispatch arm exists)', () => {
  const src = code();
  assert.match(
    src,
    /'existing-topics-ambiguous'/,
    "the single-quoted route literal 'existing-topics-ambiguous' must appear",
  );
});

// ---- T2 — typed prop declaration ------------------------------------------

test('T2 — file declares onRequestPickerOpen?: as a prop in ContinueInChatButtonProps', () => {
  const src = code();
  assert.match(
    src,
    /onRequestPickerOpen\?\s*:/,
    'expected onRequestPickerOpen?: to be declared as an optional prop',
  );
});

// ---- T3 — dispatch arm invokes prop (not nav.navigate) --------------------

test('T3 — dispatch arm invokes onRequestPickerOpen?.({...}) (no nav.navigate from ambiguous arm)', () => {
  const src = code();
  assert.match(
    src,
    /onRequestPickerOpen\?\.\(\s*\{/,
    'expected an onRequestPickerOpen?.({ ... }) call in the dispatch arm',
  );
});

// ---- T4 — D-06 tooltip differentiation -----------------------------------

test('T4 — tooltip contains "Pick from " near "conversations about" (D-06)', () => {
  const src = code();
  assert.match(
    src,
    /Pick from [\s\S]{0,80}conversations about/,
    'expected the literal phrasing "Pick from ... conversations about" in the tooltip',
  );
});

// ---- T5 — UUID-leak guardrail (no assigneeAgentId in title attribute) ----

test('T5 — assigneeAgentId never appears inside a title= attribute (D-08 / D-09)', () => {
  const src = code();
  // Approximate: any title={ ... assigneeAgentId ... } expression is forbidden.
  assert.doesNotMatch(
    src,
    /title=\{[^}]*assigneeAgentId/,
    'assigneeAgentId must NOT be referenced inside a title={...} attribute (D-08 UUID-leak guardrail)',
  );
});

// ---- T6 — sourceIssueIdentifier consumed (D-08 BEAAA-NNN reuse) ----------

test('T6 — file consumes result.sourceIssueIdentifier (D-08 BEAAA-NNN reuse)', () => {
  const src = code();
  assert.match(
    src,
    /result\.sourceIssueIdentifier/,
    'expected result.sourceIssueIdentifier reference in tooltip/text',
  );
});

// ---- T7 — D9 baseline preserved (employeeLabel + "this employee" fallback) --

test('T7 — D9 baseline preserved (employeeLabel fallback "this employee" still present)', () => {
  const src = code();
  assert.match(
    src,
    /'this employee'/,
    'the existing D9 fallback literal "this employee" must remain',
  );
  assert.match(src, /employeeLabel/, 'employeeLabel variable name preserved');
});
