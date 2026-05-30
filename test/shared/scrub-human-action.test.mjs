// test/shared/scrub-human-action.test.mjs
//
// Plan 08-01 Task 1 — the extracted single-source-of-truth NO_UUID_LEAK guard.
//
// scrubHumanAction was a file-private helper in
// src/worker/handlers/org-blocked-backlog.ts (Plan 07-03 hotfix 35d4945). Plan
// 08-01 extracts it (plus UUID_RE / UUID_RE_G / UNOWNED_SENTINEL) into
// src/shared/scrub-human-action.ts so BOTH the ROOM-12 org-blocked-backlog AND
// the ROOM-13..16 per-employee rollup consume one definition. These 6 unit
// tests pin every terminal-kind path against the contract: the produced string
// carries ZERO raw hex UUIDs, for any Terminal kind.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  scrubHumanAction,
  UNOWNED_SENTINEL,
} from '../../src/shared/scrub-human-action.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Test 1 — __unowned__ HUMAN_ACTION_ON whose embedded UUID does NOT resolve →
// "Owner unknown — assign an owner first" (no UUID).
test('scrubHumanAction — __unowned__ with unresolved UUID → "Owner unknown — assign an owner first"', () => {
  const result = scrubHumanAction(
    {
      kind: 'HUMAN_ACTION_ON',
      userId: UNOWNED_SENTINEL,
      label: 'Owner unknown — assign 7b5c7deb-8135-4d23-b41b-6cf7b724e945 first',
    },
    '',
    new Map(),
  );
  assert.equal(result, 'Owner unknown — assign an owner first');
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 2 — __unowned__ whose embedded UUID resolves in nameByUuid →
// "<name> — assign an owner first".
test('scrubHumanAction — __unowned__ with a resolvable embedded UUID → "<name> — assign an owner first"', () => {
  const uuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const result = scrubHumanAction(
    { kind: 'HUMAN_ACTION_ON', userId: UNOWNED_SENTINEL, label: `Owner unknown — assign ${uuid} first` },
    '',
    new Map([[uuid, 'Compliance Bot']]),
  );
  assert.equal(result, 'Compliance Bot — assign an owner first');
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 3 — non-__unowned__ HUMAN_ACTION_ON whose userId is the viewer → "You".
test('scrubHumanAction — HUMAN_ACTION_ON whose userId === viewer → "You"', () => {
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const result = scrubHumanAction(
    { kind: 'HUMAN_ACTION_ON', userId: viewer, label: `Waiting on ${viewer}` },
    viewer,
    new Map([[viewer, 'Alice']]),
  );
  assert.match(result, /\bYou\b/);
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
});

// Test 4 — non-viewer HUMAN_ACTION_ON returns the RESOLVED NAME (not the UUID).
test('scrubHumanAction — non-viewer HUMAN_ACTION_ON returns the resolved name, never the UUID', () => {
  const owner = 'aaaaaaaa-1111-2222-3333-444444444444';
  const viewer = 'cccccccc-9999-0000-1111-222222222222';
  const result = scrubHumanAction(
    { kind: 'HUMAN_ACTION_ON', userId: owner, label: `${owner} to act on COU-2` },
    viewer,
    new Map([[owner, 'Head of Compliance']]),
  );
  assert.match(result, /Head of Compliance/);
  assert.ok(!result.includes('You'), 'a non-viewer must not be rewritten to You');
  assert.ok(!UUID_RE.test(result), `no raw UUID; got: ${result}`);
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
  assert.match(ext, /agent#dddddddd/);
  assert.ok(!UUID_RE.test(ext), `EXTERNAL leaked: ${ext}`);

  const cyc = scrubHumanAction(
    { kind: 'CYCLE', cycleNodes: [u, u], label: `Cycle: ${u} → ${u}` },
    '',
    new Map(),
  );
  assert.ok(!UUID_RE.test(cyc), `CYCLE leaked: ${cyc}`);
});

// Test 6 — belt-and-suspenders: a UUID that escapes step-2/step-3 is rewritten
// to agent#<8hex>. We simulate by passing an unresolved UUID in an EXTERNAL
// label — the final pass must short-form it.
test('scrubHumanAction — belt-and-suspenders: any surviving UUID → agent#<8hex>', () => {
  const u = '12345678-9abc-def0-1234-56789abcdef0';
  const result = scrubHumanAction(
    { kind: 'EXTERNAL', label: `blocked on ${u} forever` },
    '',
    new Map(),
  );
  assert.match(result, /agent#12345678/);
  assert.ok(!UUID_RE.test(result), `no raw UUID survives; got: ${result}`);
});
