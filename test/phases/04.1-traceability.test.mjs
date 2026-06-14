// test/phases/04.1-traceability.test.mjs
//
// Plan 04.1-07 Task 2 RED -> GREEN -- Phase 4.1 (Chat -> True Task)
// traceability gate.
//
// Phase 4.1 ships all 8 CTT requirements (CTT-01..CTT-08). This test pins
// the `.planning/REQUIREMENTS.md` traceability table so a CTT row cannot
// silently regress to Pending / Planned / blank: it asserts every
// CTT-01..CTT-08 row exists, is marked `Implemented`, and carries a Phase
// 4.1 plan reference (an `04.1-NN` token). Written against the post-edit
// REQUIREMENTS.md so RED -> GREEN holds -- it fails before the Task 3
// traceability edit lands and passes after.
//
// Mirrors test/phases/04-traceability.test.mjs (the Phase 4 analog from
// Plan 04-06).
//
// Authored for Plan 04.1-07 Task 2, 2026-05-21.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// HYG-02 (Phase 20 hygiene, 2026-06-15): the CTT-01..08 traceability rows were
// archived to the v1.0.0 milestone requirements doc when the active
// .planning/REQUIREMENTS.md rolled over to the v1.5.0 milestone. Re-point this
// gate at the archive where the rows actually live + are marked Implemented
// (mirrors the 04-traceability re-point).
const REQUIREMENTS_PATH = path.resolve(
  __dirname,
  '../../.planning/milestones/v1.0.0-REQUIREMENTS.md',
);

const CTT_IDS = Array.from(
  { length: 8 },
  (_, i) => `CTT-${String(i + 1).padStart(2, '0')}`,
);

function traceabilityRow(body, id) {
  // Match a markdown traceability table row: | CTT-NN | Phase 4.1 | <status> |
  const m = body.match(
    new RegExp(`^\\|\\s*${id}\\s*\\|([^|]*)\\|([^|]*)\\|`, 'm'),
  );
  return m ? { phase: m[1].trim(), status: m[2].trim() } : null;
}

test('REQUIREMENTS.md exists', () => {
  assert.ok(
    existsSync(REQUIREMENTS_PATH),
    `expected the requirements doc at ${REQUIREMENTS_PATH}`,
  );
});

test('REQUIREMENTS.md has a traceability row for every CTT-01..CTT-08', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CTT_IDS) {
    assert.ok(
      traceabilityRow(body, id),
      `expected a traceability table row for ${id}`,
    );
  }
});

test('every CTT-01..CTT-08 row is marked Implemented', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CTT_IDS) {
    const row = traceabilityRow(body, id);
    assert.ok(row, `expected a row for ${id}`);
    assert.match(
      row.status,
      /^Implemented\b/,
      `${id} must be marked Implemented, got: "${row.status}"`,
    );
  }
});

test('every CTT-01..CTT-08 row carries a Phase 4.1 plan reference', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CTT_IDS) {
    const row = traceabilityRow(body, id);
    assert.ok(row, `expected a row for ${id}`);
    assert.match(
      row.status,
      /\b04\.1-\d{2}\b/,
      `${id} status must cite a Phase 4.1 plan (04.1-NN), got: "${row.status}"`,
    );
  }
});

test('every CTT-01..CTT-08 row is on Phase 4.1', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CTT_IDS) {
    const row = traceabilityRow(body, id);
    assert.ok(row, `expected a row for ${id}`);
    assert.match(
      row.phase,
      /^Phase 4\.1$/,
      `${id} must be on Phase 4.1, got: "${row.phase}"`,
    );
  }
});
