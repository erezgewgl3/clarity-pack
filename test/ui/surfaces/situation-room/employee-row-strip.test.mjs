// test/ui/surfaces/situation-room/employee-row-strip.test.mjs
//
// Plan 09-02 Task 3 — REWRITE for the grouped renderer (R2 / D-03 / R6).
//
// EmployeeRowStrip now renders EXACTLY three sections (Needs you / Working /
// Idle), ALWAYS, partitioning rows by the WORKER `group` field — it does NOT
// re-sort or re-derive group (R2). An empty group still renders its header +
// count + a muted "— none —" line (D-03). The merged blocked-backlog +
// critical-path expander mounts at the END of the Needs-you section (R6).
//
// Convention: source-grep (no jsdom in devDependencies).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const STRIP = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/employee-row-strip.tsx'),
  'utf8',
);
const STRIP_CODE = stripComments(STRIP);
const CSS = readFileSync(
  path.join(REPO_ROOT, 'src/ui/primitives/theme.css'),
  'utf8',
);

test('exports EmployeeRowStrip', () => {
  assert.match(STRIP, /export function EmployeeRowStrip/);
});

test('imports EmployeeRow + BlockedBacklogExpander', () => {
  assert.match(STRIP, /import \{ EmployeeRow[\s\S]*?\} from '\.\/employee-row\.tsx'/);
  assert.match(STRIP, /import \{ BlockedBacklogExpander \} from '\.\/blocked-backlog-expander\.tsx'/);
});

// ---------------------------------------------------------------------------
// R2 — worker group consumed VERBATIM (no re-sort)
// ---------------------------------------------------------------------------

test('R2: strip does NOT call .sort() (worker order is verbatim)', () => {
  assert.equal(
    (STRIP_CODE.match(/\.sort\(/g) || []).length,
    0,
    'rows must render in worker order — no UI re-sort',
  );
});

test('R2: strip partitions by row.group (not by re-deriving from state)', () => {
  assert.match(STRIP, /row\.group/);
  assert.match(STRIP, /byGroup/);
});

// ---------------------------------------------------------------------------
// D-03 — three sections always, with counts + "— none —" empty branch
// ---------------------------------------------------------------------------

test('D-03: exactly three groups in fixed order (needs_you, working, idle)', () => {
  assert.match(STRIP, /GROUP_ORDER:\s*EmployeeGroup\[\]\s*=\s*\[\s*'needs_you',\s*'working',\s*'idle'\s*\]/);
});

test('D-03: each group renders a header with a count + a "— none —" empty branch', () => {
  assert.match(STRIP, /clarity-group-title/);
  assert.match(STRIP, /clarity-group-count/);
  assert.match(STRIP, /— none —/);
  assert.match(STRIP, /rows\.length === 0/);
});

test('maps each group rows → EmployeeRow keyed on agentId', () => {
  assert.match(STRIP, /rows\.map\(/);
  assert.match(STRIP, /key=\{row\.agentId\}/);
});

// ---------------------------------------------------------------------------
// R6 — the merged expander mounts at the END of Needs-you only
// ---------------------------------------------------------------------------

test('R6: BlockedBacklogExpander mounted, gated on group === needs_you', () => {
  assert.match(STRIP, /<BlockedBacklogExpander/);
  assert.match(STRIP, /group === 'needs_you'/);
});

// ---------------------------------------------------------------------------
// Props threaded to each row (incl. the force-refetch on assign)
// ---------------------------------------------------------------------------

test('strip threads companyPrefix + companyId + userId + navigate + onAssignSuccess into each EmployeeRow', () => {
  assert.match(STRIP, /companyPrefix=\{companyPrefix\}/);
  assert.match(STRIP, /companyId=\{companyId\}/);
  assert.match(STRIP, /userId=\{userId\}/);
  assert.match(STRIP, /navigate=\{navigate\}/);
  assert.match(STRIP, /onAssignSuccess=\{onAssignSuccess\}/);
});

// ---------------------------------------------------------------------------
// CSS — group + strip chrome scoped
// ---------------------------------------------------------------------------

test('CSS: .clarity-employee-strip + .clarity-group-section scoped under [data-clarity-surface=situation-room]', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-employee-strip/);
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-group-section/);
});
