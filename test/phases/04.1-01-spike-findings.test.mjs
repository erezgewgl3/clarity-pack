// test/phases/04.1-01-spike-findings.test.mjs
//
// Plan 04.1-01 is the falsify-first spike for Phase 4.1 (Chat -> True Task).
// It builds no chat code -- its sole durable artifact is a structured findings
// document, `.planning/phases/04.1-chat-true-task/04.1-01-SPIKE-FINDINGS.md`,
// that records the empirical verdict per probed assumption
// (PROBE-OQ3 / PROBE-D14-DISCRIM / PROBE-OQ1-STATUS / PROBE-OQ2-FILTER /
// FLAG-1 / FLAG-2) and a GO/RE-SCOPE gate verdict that Plans 04.1-02..04.1-06
// are gated on.
//
// This test pins the locked findings document's contract so the gate verdict
// cannot silently disappear or lose a required section: it asserts the file
// exists, carries `status: locked` and `verdict: GO` in its frontmatter,
// contains each sub-probe's verdict word verbatim, and the raw JSON appendix
// preserves the OQ3 probe issue id and the D-14 notice row id (the two
// load-bearing audit anchors).
//
// Mirrors test/phases/04-01-spike-findings.test.mjs from Plan 04-01.
// Authored for Plan 04.1-01 Task 3, 2026-05-20.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINDINGS_PATH = path.resolve(
  __dirname,
  '../../.planning/phases/04.1-chat-true-task/04.1-01-SPIKE-FINDINGS.md',
);

const REQUIRED_HEADERS = [
  '## TL;DR Verdict',
  '## Per-Probe PASS/FAIL Table',
  '## PROBE-OQ3',
  '## PROBE-D14-DISCRIM',
  '## PROBE-OQ1-STATUS',
  '## PROBE-OQ2-FILTER',
  '## FLAG-1 reconciliation',
  '## FLAG-2',
  '## Phase 4.1 Gate Verdict',
  '## Raw evidence',
];

// Per-sub-probe verdict words that MUST appear verbatim in the locked findings.
// These are the empirical results the rest of Phase 4.1 implements against.
const REQUIRED_VERDICT_WORDS = [
  'PASS-NATIVE',          // PROBE-OQ3 (D-12)
  'AGENT-LEAVES-IN-PROGRESS', // PROBE-OQ1-STATUS
  'WEAK',                 // PROBE-OQ2-FILTER (WEAK / WEAK-REST-LIMIT)
];

// The two load-bearing audit anchors -- if these ids ever change in the doc,
// the cross-references back to the probe run are broken.
const OQ3_PROBE_ISSUE_ID = '0dc3bea1-b60b-4f54-a2f0-cfd8c97f37e5';
const D14_NOTICE_ROW_ID = 'fa25ef4d-78ee-4143-a527-c23227721eec';

test('04.1-01-SPIKE-FINDINGS.md exists', () => {
  assert.ok(
    existsSync(FINDINGS_PATH),
    `expected the spike findings doc at ${FINDINGS_PATH}`,
  );
});

test('04.1-01-SPIKE-FINDINGS.md frontmatter carries status: locked', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.match(
    body,
    /^---[\s\S]*?\nstatus:\s*locked\b[\s\S]*?\n---/,
    'expected the findings doc frontmatter to declare status: locked',
  );
});

test('04.1-01-SPIKE-FINDINGS.md frontmatter carries verdict: GO', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.match(
    body,
    /^---[\s\S]*?\nverdict:\s*GO\b[\s\S]*?\n---/,
    'expected the findings doc frontmatter to declare verdict: GO',
  );
});

test('04.1-01-SPIKE-FINDINGS.md contains all required section headers', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  for (const header of REQUIRED_HEADERS) {
    assert.ok(
      body.includes(header),
      `expected the findings doc to contain the header "${header}"`,
    );
  }
});

test('04.1-01-SPIKE-FINDINGS.md records every sub-probe verdict word verbatim', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  for (const word of REQUIRED_VERDICT_WORDS) {
    assert.ok(
      body.includes(word),
      `expected the findings doc to record verdict word "${word}"`,
    );
  }
});

test('04.1-01-SPIKE-FINDINGS.md records the D-14 PASS verdict', () => {
  // "PASS" appears in many places (per-probe table, FLAG-2). We just need to
  // confirm D-14 is recorded as PASS rather than PASS-NATIVE / FAIL.
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  // The D-14 section's "**VERDICT: PASS.**" line is the load-bearing assertion.
  assert.match(
    body,
    /## PROBE-D14-DISCRIM[\s\S]{0,200}\*\*VERDICT:\s*PASS\.\*\*/,
    'expected PROBE-D14-DISCRIM section to record VERDICT: PASS',
  );
});

test('04.1-01-SPIKE-FINDINGS.md preserves the OQ3 probe issue id in the raw evidence appendix', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.ok(
    body.includes(OQ3_PROBE_ISSUE_ID),
    `expected the raw-evidence appendix to preserve the OQ3 probe issue id ${OQ3_PROBE_ISSUE_ID}`,
  );
});

test('04.1-01-SPIKE-FINDINGS.md preserves the D-14 notice row id in the raw evidence appendix', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.ok(
    body.includes(D14_NOTICE_ROW_ID),
    `expected the raw-evidence appendix to preserve the D-14 notice row id ${D14_NOTICE_ROW_ID}`,
  );
});

test('04.1-01-SPIKE-FINDINGS.md ends with the SPIKE COMPLETE marker', () => {
  const body = readFileSync(FINDINGS_PATH, 'utf8');
  assert.ok(
    body.trimEnd().endsWith('## SPIKE COMPLETE'),
    'expected the findings doc to end with the "## SPIKE COMPLETE" marker',
  );
});
