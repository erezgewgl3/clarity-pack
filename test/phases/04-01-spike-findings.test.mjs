// test/phases/04-01-spike-findings.test.mjs
//
// Plan 04-01 is the falsify-first spike for Phase 4 (Employee Chat). It builds
// no chat code -- its sole durable artifact is a structured findings document,
// `.planning/phases/04-employee-chat/04-01-SPIKE-FINDINGS.md`, that records the
// empirical verdict per probed assumption (D-01/OQ-4, OQ-2, OQ-3, OQ-1) and a
// GO/NO-GO gate verdict that Plans 04-02..04-06 are gated on.
//
// This test pins the findings document's contract so the gate verdict cannot
// silently disappear or lose a required section: it asserts the file exists,
// carries all five required headers, names OQ-1 explicitly, ends with the
// `## SPIKE COMPLETE` marker, and records an explicit GO or NO-GO verdict.
//
// Authored for Plan 04-01 Task 3, 2026-05-18.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINDINGS_PATH = path.resolve(
  __dirname,
  '../../.planning/phases/04-employee-chat/04-01-SPIKE-FINDINGS.md',
);

const REQUIRED_HEADERS = [
  '## D-01',
  '## OQ-2',
  '## OQ-3',
  '## OQ-1',
  '## Phase 4 Gate Verdict',
];

test('04-01-SPIKE-FINDINGS.md exists', () => {
  assert.ok(
    existsSync(FINDINGS_PATH),
    `expected the spike findings doc at ${FINDINGS_PATH}`,
  );
});

test('04-01-SPIKE-FINDINGS.md contains all five required headers', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  for (const header of REQUIRED_HEADERS) {
    assert.ok(
      body.includes(header),
      `expected the findings doc to contain the header "${header}"`,
    );
  }
});

test('04-01-SPIKE-FINDINGS.md names OQ-1 explicitly', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.ok(body.includes('OQ-1'), 'expected the findings doc to mention OQ-1');
});

test('04-01-SPIKE-FINDINGS.md records an explicit GO or NO-GO gate verdict', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  const hasGo = /\bGO\b/.test(body);
  const hasNoGo = /\bNO-GO\b/.test(body);
  assert.ok(
    hasGo || hasNoGo,
    'expected the findings doc to record an explicit GO or NO-GO verdict',
  );
});

test('04-01-SPIKE-FINDINGS.md ends with the SPIKE COMPLETE marker', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.ok(
    body.trimEnd().endsWith('## SPIKE COMPLETE'),
    'expected the findings doc to end with the "## SPIKE COMPLETE" marker',
  );
});
