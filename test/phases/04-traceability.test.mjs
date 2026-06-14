// test/phases/04-traceability.test.mjs
//
// Plan 04-06 Task 2 RED -> GREEN -- Phase 4 (Employee Chat) traceability gate.
//
// Phase 4 ships all 11 CHAT requirements (CHAT-01..CHAT-11). This test pins the
// `.planning/REQUIREMENTS.md` traceability table so a CHAT row cannot silently
// regress to Pending / Planned / blank: it asserts every CHAT-01..CHAT-11 row
// exists, is marked `Implemented`, and carries a Phase 4 plan reference
// (an `04-NN` token). Written against the post-edit REQUIREMENTS.md so RED ->
// GREEN holds -- it fails before the Task 2 traceability edit lands and passes
// after.
//
// Authored for Plan 04-06 Task 2, 2026-05-19.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// HYG-02 (Phase 20 hygiene, 2026-06-15): the CHAT-01..11 traceability rows were
// archived to the v1.0.0 milestone requirements doc when the active
// .planning/REQUIREMENTS.md rolled over to the v1.5.0 milestone (which carries
// SNAP/LOOP/WAIT/LEG/CARD/HYG, not the closed Phase-4 CHAT rows). Re-point this
// gate at the archive where the rows actually live + are marked Implemented, so
// the Phase-4 traceability stays pinned without polluting the active milestone
// doc with closed-phase rows.
const REQUIREMENTS_PATH = path.resolve(
  __dirname,
  '../../.planning/milestones/v1.0.0-REQUIREMENTS.md',
);

const CHAT_IDS = Array.from(
  { length: 11 },
  (_, i) => `CHAT-${String(i + 1).padStart(2, '0')}`,
);

function traceabilityRow(body, id) {
  // Match a markdown traceability table row: | CHAT-NN | Phase 4 | <status> |
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

test('REQUIREMENTS.md has a traceability row for every CHAT-01..CHAT-11', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CHAT_IDS) {
    assert.ok(
      traceabilityRow(body, id),
      `expected a traceability table row for ${id}`,
    );
  }
});

test('every CHAT-01..CHAT-11 row is marked Implemented', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CHAT_IDS) {
    const row = traceabilityRow(body, id);
    assert.ok(row, `expected a row for ${id}`);
    assert.match(
      row.status,
      /^Implemented\b/,
      `${id} must be marked Implemented, got: "${row.status}"`,
    );
  }
});

test('every CHAT-01..CHAT-11 row carries a Phase 4 plan reference', () => {
  const body = readFileSync(REQUIREMENTS_PATH, 'utf8');
  for (const id of CHAT_IDS) {
    const row = traceabilityRow(body, id);
    assert.ok(row, `expected a row for ${id}`);
    assert.match(
      row.status,
      /\b04-\d{2}\b/,
      `${id} status must cite a Phase 4 plan (04-NN), got: "${row.status}"`,
    );
  }
});
