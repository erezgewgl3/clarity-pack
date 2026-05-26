// test/phases/06.1-traceability.test.mjs
//
// Plan 06.1-04 Task 1 RED -> GREEN -- Phase 6.1 (Situation Room
// spec-complete) traceability gate.
//
// Phase 6.1 ships three new requirements (ROOM-09 / ROOM-10 / ROOM-11).
// Unlike the Phase 4.1 traceability test (test/phases/04.1-traceability
// .test.mjs) which asserts REQUIREMENTS.md table rows, this test pins
// the PLANNING-LAYER traceability: every ROOM-09/10/11 ID must appear in
// the `requirements` frontmatter field of at least one Phase 6.1 plan
// file. This shape is intentional -- per Plan 06.1-04 the REQUIREMENTS
// .md implementation-status flip lives in the POST-DRILL closure commit
// (matching Plan 05-10 / 05-11 precedent), so the requirement-row status
// is still "Pending" during this test's execution and the traceability
// link we can pin BUILD-TIER is "the planner allocated each ROOM-NN to
// at least one plan."
//
// Assertion shape: for each id in ROOM-09 / ROOM-10 / ROOM-11, grep the
// YAML frontmatter `requirements: [...]` line in every `.planning/phases/
// 06.1-situation-room-spec-complete/*-PLAN.md` file; assert the id
// appears in at least one plan's requirements array.
//
// Authored for Plan 06.1-04 Task 1, 2026-05-27. Forked from
// test/phases/04.1-traceability.test.mjs (Phase 4.1 closure pattern) with
// the assertion target rewritten from REQUIREMENTS.md tables to plan
// frontmatter arrays per CONTEXT.md §traceability-test-shape.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHASE_DIR = path.resolve(
  __dirname,
  '../../.planning/phases/06.1-situation-room-spec-complete',
);

const ROOM_IDS = ['ROOM-09', 'ROOM-10', 'ROOM-11'];

/**
 * Read a plan file, locate its YAML frontmatter block (between the first
 * pair of `---` lines), then extract the `requirements: [...]` array and
 * return its IDs as a Set. Returns an empty Set if the field is missing.
 */
function readPlanRequirements(filePath) {
  const body = readFileSync(filePath, 'utf8');

  // Frontmatter is delimited by a leading `---` line and a closing `---`.
  // Match a multi-line frontmatter block at the top of the file.
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return new Set();

  const frontmatter = fmMatch[1];

  // The requirements field is YAML-array-on-one-line: `requirements: [A, B, C]`.
  // Per .planning/phases/06.1-situation-room-spec-complete/06.1-*-PLAN.md
  // convention. Defensive: tolerate optional spaces around the brackets
  // and around each comma-separated id.
  const reqMatch = frontmatter.match(/^requirements:\s*\[([^\]]*)\]/m);
  if (!reqMatch) return new Set();

  const ids = reqMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return new Set(ids);
}

function listPhasePlanFiles() {
  if (!existsSync(PHASE_DIR)) return [];
  return readdirSync(PHASE_DIR)
    .filter((f) => /^06\.1-\d{2}-PLAN\.md$/.test(f))
    .map((f) => path.join(PHASE_DIR, f))
    .sort();
}

test('Phase 6.1 directory exists', () => {
  assert.ok(
    existsSync(PHASE_DIR),
    `expected Phase 6.1 plan directory at ${PHASE_DIR}`,
  );
});

test('Phase 6.1 has at least one plan file (06.1-NN-PLAN.md)', () => {
  const plans = listPhasePlanFiles();
  assert.ok(
    plans.length >= 1,
    `expected at least one Phase 6.1 plan file in ${PHASE_DIR}`,
  );
});

test('every Phase 6.1 plan file has a parseable requirements frontmatter field', () => {
  const plans = listPhasePlanFiles();
  for (const plan of plans) {
    const reqs = readPlanRequirements(plan);
    // Soft assertion -- a plan MAY legitimately have requirements: []
    // (e.g., a pure-housekeeping plan); we just require the field to
    // exist and be parseable. We assert this by checking the frontmatter
    // contains the `requirements:` key at all.
    const body = readFileSync(plan, 'utf8');
    const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(
      fmMatch,
      `plan ${path.basename(plan)} lacks a YAML frontmatter block`,
    );
    const hasReqLine = /^requirements:\s*\[/m.test(fmMatch[1]);
    assert.ok(
      hasReqLine,
      `plan ${path.basename(plan)} lacks a "requirements: [...]" frontmatter field`,
    );
    // For visibility in test output: log the parsed set (no-op assertion).
    assert.ok(reqs instanceof Set);
  }
});

test('every ROOM-09 / ROOM-10 / ROOM-11 id appears in at least one Phase 6.1 plan frontmatter', () => {
  const plans = listPhasePlanFiles();
  assert.ok(
    plans.length >= 1,
    'expected at least one Phase 6.1 plan to scan for requirements',
  );

  // Accumulate the union of every plan's requirements set.
  const allRequirements = new Set();
  for (const plan of plans) {
    for (const id of readPlanRequirements(plan)) {
      allRequirements.add(id);
    }
  }

  for (const id of ROOM_IDS) {
    assert.ok(
      allRequirements.has(id),
      `expected ${id} to appear in at least one Phase 6.1 plan's "requirements" frontmatter; ` +
        `union across plans was: [${[...allRequirements].sort().join(', ')}]`,
    );
  }
});

test('each ROOM-09 / ROOM-10 / ROOM-11 id appears in exactly the plans that own it', () => {
  // Bookkeeping assertion: the Phase 6.1 plan structure (per CONTEXT.md
  // + the 06.1-01/02/03/04 PLAN.md frontmatter) is:
  //   06.1-01-PLAN.md  -- ROOM-09 (worker tier owner-resolution)
  //   06.1-02-PLAN.md  -- ROOM-10 (worker tier artifact union)
  //   06.1-03-PLAN.md  -- ROOM-09 / ROOM-10 / ROOM-11 (UI tier)
  //   06.1-04-PLAN.md  -- ROOM-09 / ROOM-10 / ROOM-11 (closure / drill)
  //
  // This test pins the minimum coverage envelope: ROOM-09 must own at
  // least 2 plans (the worker tier + UI/closure); ROOM-10 must own at
  // least 2 plans (the worker tier + UI/closure); ROOM-11 must own at
  // least 1 plan (the UI tier where it FIRST appears -- it's a UI-only
  // requirement).
  const plans = listPhasePlanFiles();
  const owners = { 'ROOM-09': [], 'ROOM-10': [], 'ROOM-11': [] };
  for (const plan of plans) {
    const reqs = readPlanRequirements(plan);
    for (const id of ROOM_IDS) {
      if (reqs.has(id)) owners[id].push(path.basename(plan));
    }
  }

  assert.ok(
    owners['ROOM-09'].length >= 2,
    `ROOM-09 should own >= 2 plans (worker tier + UI/closure); owners: [${owners['ROOM-09'].join(', ')}]`,
  );
  assert.ok(
    owners['ROOM-10'].length >= 2,
    `ROOM-10 should own >= 2 plans (worker tier + UI/closure); owners: [${owners['ROOM-10'].join(', ')}]`,
  );
  assert.ok(
    owners['ROOM-11'].length >= 1,
    `ROOM-11 should own >= 1 plan (UI tier); owners: [${owners['ROOM-11'].join(', ')}]`,
  );
});
