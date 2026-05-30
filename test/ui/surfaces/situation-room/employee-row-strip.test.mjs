// test/ui/surfaces/situation-room/employee-row-strip.test.mjs
//
// Plan 08-02 Task 1 — the ordered employee row strip (ROOM-13).
//
// EmployeeRowStrip maps the worker-produced `employees` array to <EmployeeRow>
// VERBATIM — it does NOT sort or filter (the worker already sorted
// blocked→stale→idle→reviewing→running). Empty array renders an inline
// "No employees in scope" placeholder instead of an empty list.
//
// Convention: source-grep (no jsdom in devDependencies).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
/** Strip // line comments and block comments so forbidden-substring asserts
 *  evaluate the CODE, not the prose (which legitimately documents the rule). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const STRIP_RAW = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/employee-row-strip.tsx'),
  'utf8',
);
const STRIP = STRIP_RAW;
const STRIP_CODE = stripComments(STRIP_RAW);
const CSS = readFileSync(
  path.join(REPO_ROOT, 'src/ui/primitives/theme.css'),
  'utf8',
);

test('exports EmployeeRowStrip', () => {
  assert.match(STRIP, /export function EmployeeRowStrip/);
});

test('imports EmployeeRow (single source of truth for row render)', () => {
  assert.match(STRIP, /import \{ EmployeeRow[\s\S]*?\} from '\.\/employee-row\.tsx'/);
});

// ---------------------------------------------------------------------------
// Test 8 — worker order consumed VERBATIM (no re-sort, no filter)
// ---------------------------------------------------------------------------

test('strip does NOT call .sort() on the employees prop (verbatim consumption)', () => {
  assert.equal(
    (STRIP_CODE.match(/\.sort\(/g) || []).length,
    0,
    'employees array must be consumed in worker order — no UI re-sort',
  );
});

test('strip does NOT call .filter() on the employees prop (verbatim consumption)', () => {
  assert.equal(
    (STRIP_CODE.match(/\.filter\(/g) || []).length,
    0,
    'employees array must be consumed in worker order — no UI filter',
  );
});

test('strip maps employees → EmployeeRow keyed on agentId', () => {
  assert.match(STRIP, /employees\.map\(/);
  assert.match(STRIP, /key=\{row\.agentId\}/);
});

// ---------------------------------------------------------------------------
// Test 9 — empty state placeholder
// ---------------------------------------------------------------------------

test('strip renders an inline empty-state placeholder for an empty array', () => {
  assert.match(STRIP, /No employees in scope/);
  assert.match(STRIP, /employees\.length === 0/);
});

// ---------------------------------------------------------------------------
// Props threaded to each row
// ---------------------------------------------------------------------------

test('strip threads companyPrefix + navigate into each EmployeeRow', () => {
  assert.match(STRIP, /companyPrefix=\{companyPrefix\}/);
  assert.match(STRIP, /navigate=\{navigate\}/);
});

// ---------------------------------------------------------------------------
// CSS — strip chrome scoped
// ---------------------------------------------------------------------------

test('CSS: .clarity-employee-strip is scoped under [data-clarity-surface=situation-room]', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-employee-strip/);
});
