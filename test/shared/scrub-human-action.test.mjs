// test/shared/scrub-human-action.test.mjs
//
// Plan 08-01 Task 1 — the extracted single-source-of-truth NO_UUID_LEAK guard.
//
// scrubHumanAction was a file-private helper in
// src/worker/handlers/org-blocked-backlog.ts (Plan 07-03 hotfix 35d4945). Plan
// 08-01 extracts it (plus UUID_RE / UUID_RE_G) into
// src/shared/scrub-human-action.ts so BOTH the ROOM-12 org-blocked-backlog AND
// the ROOM-13..16 per-employee rollup consume one definition. These unit tests
// pin every terminal-kind path against the contract: the produced string
// carries ZERO raw hex UUIDs, for any Terminal kind.
//
// Plan 11-04 (D-11/D-05) — migrated off the legacy HUMAN_ACTION_ON kind and the
// removed UNOWNED_SENTINEL userId magic-string. UNOWNED is now a first-class
// terminal kind carrying NO userId; the human-action variant is AWAITING_HUMAN.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { scrubHumanAction } from '../../src/shared/scrub-human-action.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Test 1 — genuine UNOWNED (Plan 11-01 D-11; was __unowned__ HUMAN_ACTION_ON)
// whose embedded UUID does NOT resolve → "Owner unknown — assign an owner first".
test('scrubHumanAction — UNOWNED with unresolved UUID → "Owner unknown — assign an owner first"', () => {
  const result = scrubHumanAction(
    {
      kind: 'UNOWNED',
      label: 'Owner unknown — assign 7b5c7deb-8135-4d23-b41b-6cf7b724e945 first',
    },
    '',
    new Map(),
  );
  assert.equal(result, 'Owner unknown — assign an owner first');
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 2 — UNOWNED whose embedded UUID resolves in nameByUuid →
// "<name> — assign an owner first".
test('scrubHumanAction — UNOWNED with a resolvable embedded UUID → "<name> — assign an owner first"', () => {
  const uuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const result = scrubHumanAction(
    { kind: 'UNOWNED', label: `Owner unknown — assign ${uuid} first` },
    '',
    new Map([[uuid, 'Compliance Bot']]),
  );
  assert.equal(result, 'Compliance Bot — assign an owner first');
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 3 — AWAITING_HUMAN (Plan 11-01 rename) whose userId is the viewer → "You".
test('scrubHumanAction — AWAITING_HUMAN whose userId === viewer → "You"', () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const result = scrubHumanAction(
    { kind: 'AWAITING_HUMAN', userId: viewer, label: `Waiting on ${viewer}` },
    viewer,
    new Map([[viewer, 'Alice']]),
  );
  assert.match(result, /\bYou\b/);
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 4 — non-viewer AWAITING_HUMAN returns the RESOLVED NAME (not the UUID).
test('scrubHumanAction — non-viewer AWAITING_HUMAN returns the resolved name, never the UUID', () => {
  const owner = 'aaaaaaaa-1111-2222-3333-444444444444';
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const result = scrubHumanAction(
    { kind: 'AWAITING_HUMAN', userId: owner, label: `${owner} to act on COU-2` },
    viewer,
    new Map([[owner, 'Head of Compliance']]),
  );
  assert.match(result, /Head of Compliance/);
  assert.ok(!result.includes('You'), 'a non-viewer must not be rewritten to You');
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 4b — the four NEW kinds (Plan 11-01 D-05) also scrub every embedded UUID.
test('scrubHumanAction — AWAITING_AGENT_WORKING/STUCK + UNCLASSIFIED scrub embedded UUIDs', () => {
  const u = 'eeeeeeee-7777-8888-9999-aaaaaaaaaaaa';
  const working = scrubHumanAction(
    { kind: 'AWAITING_AGENT_WORKING', agentId: u, label: `Agent ${u} is working` },
    '',
    new Map([[u, 'Drafting Bot']]),
  );
  assert.match(working, /Drafting Bot/);
  assert.ok(!UUID_RE.test(working), `AWAITING_AGENT_WORKING leaked: ${working}`);

  const stuck = scrubHumanAction(
    { kind: 'AWAITING_AGENT_STUCK', agentId: u, label: `Agent ${u} is stuck` },
    '',
    new Map(),
  );
  // Plan 18-02 (LEG-02) — INVERTED. An unresolved agent NO LONGER renders the
  // `agent#<hex>` partial-hash; it reads the plain-English "an agent". The
  // inversion IS the proof (landmine #4): a runtime-only change would leave the
  // OLD `assert.match(stuck, /agent#eeeeeeee/)` failing.
  assert.doesNotMatch(stuck, /agent#[0-9a-f]{6,}/i, `AWAITING_AGENT_STUCK leaked a partial hash: ${stuck}`);
  assert.match(stuck, /an agent/, `expected plain-English fallback; got: ${stuck}`);
  assert.ok(!UUID_RE.test(stuck), `AWAITING_AGENT_STUCK leaked: ${stuck}`);

  const unclassified = scrubHumanAction(
    { kind: 'UNCLASSIFIED', label: `Can't determine — ${u}` },
    '',
    new Map(),
  );
  assert.ok(!UUID_RE.test(unclassified), `UNCLASSIFIED leaked: ${unclassified}`);
  assert.ok(!unclassified.includes('assign'), 'UNCLASSIFIED must never claim assignment (D-12)');
});

// Test 5 — SELF_RESOLVING / EXTERNAL / CYCLE labels: every embedded UUID is
// replaced by name-or-shortform.
test('scrubHumanAction — SELF_RESOLVING / EXTERNAL / CYCLE labels scrub every embedded UUID', () => {
  const u = 'dddddddd-3333-4444-5555-666666666666';
  const self = scrubHumanAction(
    { kind: 'SELF_RESOLVING', etaIso: '2026-06-01T00:00:00Z', label: `Self-resolving by ${u}` },
    '',
    new Map([[u, 'Scheduler']]),
  );
  assert.match(self, /Scheduler/);
  assert.ok(!UUID_RE.test(self), `SELF_RESOLVING leaked: ${self}`);

  const ext = scrubHumanAction(
    { kind: 'EXTERNAL', label: `External (${u})` },
    '',
    new Map(),
  );
  // Plan 18-02 (LEG-02) — INVERTED. The unresolved UUID reads "an agent", not
  // `agent#dddddddd`.
  assert.doesNotMatch(ext, /agent#[0-9a-f]{6,}/i, `EXTERNAL leaked a partial hash: ${ext}`);
  assert.match(ext, /an agent/, `expected plain-English fallback; got: ${ext}`);
  assert.ok(!UUID_RE.test(ext), `EXTERNAL leaked: ${ext}`);

  const cyc = scrubHumanAction(
    { kind: 'CYCLE', cycleNodes: [u, u], label: `Cycle: ${u} → ${u}` },
    '',
    new Map(),
  );
  assert.ok(!UUID_RE.test(cyc), `CYCLE leaked: ${cyc}`);
});

// Test 6 — belt-and-suspenders: a UUID that escapes step-2/step-3 is rewritten
// to the plain-English "an agent" (Plan 18-02 LEG-02 — was `agent#<8hex>`). We
// simulate by passing an unresolved UUID in an EXTERNAL label — the final pass
// must replace it with the plain-English fallback, NEVER a partial hash.
test('scrubHumanAction — belt-and-suspenders: any surviving UUID → "an agent" (never a partial hash)', () => {
  const u = '12345678-9abc-def0-1234-56789abcdef0';
  const result = scrubHumanAction(
    { kind: 'EXTERNAL', label: `blocked on ${u} forever` },
    '',
    new Map(),
  );
  // Plan 18-02 (LEG-02) — INVERTED.
  assert.doesNotMatch(result, /agent#[0-9a-f]{6,}/i, `surviving UUID became a partial hash: ${result}`);
  assert.match(result, /an agent/, `expected plain-English fallback; got: ${result}`);
  assert.ok(!UUID_RE.test(result), `no raw UUID survives; got: ${result}`);
});
