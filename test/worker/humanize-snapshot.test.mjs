// test/worker/humanize-snapshot.test.mjs
//
// Plan 02-08 Task 2 RED — pure-helper unit tests for humanize-snapshot.ts.
//
// The Plan 02-04 drill caught raw UUIDs leaking into operator-facing
// terminal labels (DEV-11). humanizeChain rewrites terminal.label so it
// contains no UUID-shaped substrings — replacing each UUID with the matching
// lookup entry, or with a short-form 'agent#abcd1234' when not in lookup.
//
// SHAPE-NEGATION pattern: every fixture's output is asserted to NOT match the
// UUID regex. That's the operator-facing contract; the exact wording is a
// secondary concern (covered by the "contains 'no owner assigned'" assertion).
//
// No ctx — these are pure functions; no SDK loading; runs in stock node --test.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  humanizeChain,
  buildIdLookup,
  isUuidShaped,
} from '../../src/worker/jobs/humanize-snapshot.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------
// isUuidShaped — strict whole-string match
// ---------------------------------------------------------------------------

test("isUuidShaped: recognizes a real UUID", () => {
  assert.equal(isUuidShaped('b2a22e50-d772-4b70-bb50-4f4e93c2e984'), true);
});

test("isUuidShaped: rejects '__unowned__'", () => {
  assert.equal(isUuidShaped('__unowned__'), false);
});

test("isUuidShaped: rejects a short human-readable string", () => {
  assert.equal(isUuidShaped('eric'), false);
});

test("isUuidShaped: rejects empty string", () => {
  assert.equal(isUuidShaped(''), false);
});

test("isUuidShaped: rejects non-string input", () => {
  assert.equal(isUuidShaped(null), false);
  assert.equal(isUuidShaped(undefined), false);
  assert.equal(isUuidShaped(42), false);
});

// ---------------------------------------------------------------------------
// buildIdLookup — agent role + user name flat map
// ---------------------------------------------------------------------------

test('buildIdLookup: title-cases 2-4 letter agent roles as acronyms (ceo -> CEO)', () => {
  const lookup = buildIdLookup({
    agents: [
      { user_id: 'a-uuid', role: 'ceo' },
      { user_id: 'b-uuid', role: 'editor' },
      { user_id: 'c-uuid', role: 'cto' },
    ],
    users: [],
  });
  assert.deepEqual(lookup.get('a-uuid'), { label: 'CEO', kind: 'agent' });
  assert.deepEqual(lookup.get('b-uuid'), { label: 'Editor', kind: 'agent' });
  assert.deepEqual(lookup.get('c-uuid'), { label: 'CTO', kind: 'agent' });
});

test('buildIdLookup: title-cases longer roles with first-letter-upper (engineer -> Engineer)', () => {
  const lookup = buildIdLookup({
    agents: [{ user_id: 'a', role: 'engineer' }],
    users: [],
  });
  assert.deepEqual(lookup.get('a'), { label: 'Engineer', kind: 'agent' });
});

test('buildIdLookup: leaves mixed-case input unchanged', () => {
  const lookup = buildIdLookup({
    agents: [{ user_id: 'a', role: 'iOS Engineer' }],
    users: [],
  });
  assert.deepEqual(lookup.get('a'), { label: 'iOS Engineer', kind: 'agent' });
});

test('buildIdLookup: falls back to "agent" when role missing', () => {
  const lookup = buildIdLookup({
    agents: [{ user_id: 'a' }],
    users: [],
  });
  assert.deepEqual(lookup.get('a'), { label: 'Agent', kind: 'agent' });
});

test('buildIdLookup: registers users by id with name as label', () => {
  const lookup = buildIdLookup({
    agents: [],
    users: [{ id: 'eric-uuid', name: 'Eric' }],
  });
  assert.deepEqual(lookup.get('eric-uuid'), { label: 'Eric', kind: 'user' });
});

test('buildIdLookup: returns undefined for unknown ids', () => {
  const lookup = buildIdLookup({ agents: [], users: [] });
  assert.equal(lookup.get('unknown-uuid'), undefined);
});

test('buildIdLookup: skips entries missing id', () => {
  const lookup = buildIdLookup({
    agents: [{ role: 'ceo' }, { user_id: 'b', role: 'editor' }],
    users: [{ name: 'Eric' }, { id: 'c', name: 'Carol' }],
  });
  assert.equal(lookup.get('b').label, 'Editor');
  assert.equal(lookup.get('c').label, 'Carol');
  assert.equal(lookup.size, 2);
});

test('buildIdLookup: accepts alternate id field (a.id when no a.user_id)', () => {
  const lookup = buildIdLookup({
    agents: [{ id: 'fallback-id', role: 'pm' }],
    users: [],
  });
  assert.equal(lookup.get('fallback-id').label, 'PM');
});

// ---------------------------------------------------------------------------
// humanizeChain — operator-facing label rewriter
// ---------------------------------------------------------------------------

test('humanizeChain: HUMAN_ACTION_ON with __unowned__ + lookup hit -> "<label> has no owner assigned"', () => {
  const chain = {
    isStale: false,
    startId: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984',
    pathIds: ['b2a22e50-d772-4b70-bb50-4f4e93c2e984'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'Owner unknown — assign b2a22e50-d772-4b70-bb50-4f4e93c2e984 first',
      userId: '__unowned__',
    },
  };
  const lookup = new Map([
    ['b2a22e50-d772-4b70-bb50-4f4e93c2e984', { label: 'CEO', kind: 'agent' }],
  ]);
  const out = humanizeChain(chain, lookup);
  assert.equal(out.terminal.label, 'CEO has no owner assigned');
});

test('humanizeChain: HUMAN_ACTION_ON with __unowned__ + lookup MISS -> generic "Agent has no owner assigned"', () => {
  const chain = {
    isStale: false,
    startId: 'unknown-uuid-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    pathIds: ['unknown-uuid-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'Owner unknown — assign aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa first',
      userId: '__unowned__',
    },
  };
  const out = humanizeChain(chain, new Map());
  assert.match(out.terminal.label, /has no owner assigned/);
  // BLANKET: no UUID survives
  assert.doesNotMatch(out.terminal.label, UUID_RE);
});

test('humanizeChain: never mutates the input chain or terminal (purity)', () => {
  const chain = {
    isStale: false,
    startId: 'a',
    pathIds: ['a'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'Owner unknown — assign aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa first',
      userId: '__unowned__',
    },
  };
  const beforeLabel = chain.terminal.label;
  const out = humanizeChain(chain, new Map([['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { label: 'CEO', kind: 'agent' }]]));
  assert.notEqual(out, chain, 'humanizeChain must return a new chain object');
  assert.notEqual(out.terminal, chain.terminal, 'humanizeChain must return a new terminal object');
  assert.equal(chain.terminal.label, beforeLabel, 'humanizeChain must not mutate input.terminal.label');
});

test('humanizeChain: substitutes a UUID substring in a non-__unowned__ HUMAN_ACTION_ON label', () => {
  const chain = {
    isStale: false,
    startId: 'x',
    pathIds: ['x'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984 to act on x',
      userId: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984',
    },
  };
  const lookup = new Map([
    ['b2a22e50-d772-4b70-bb50-4f4e93c2e984', { label: 'CEO', kind: 'agent' }],
  ]);
  const out = humanizeChain(chain, lookup);
  assert.equal(out.terminal.label, 'CEO to act on x');
  assert.doesNotMatch(out.terminal.label, UUID_RE);
});

test('humanizeChain: substitutes unmatched UUIDs with short-form agent#abcdefgh', () => {
  const chain = {
    isStale: false,
    startId: 'x',
    pathIds: ['x'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984 to act on x',
      userId: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984',
    },
  };
  const out = humanizeChain(chain, new Map());
  assert.equal(out.terminal.label, 'agent#b2a22e50 to act on x');
  assert.doesNotMatch(out.terminal.label, UUID_RE);
});

test('humanizeChain: SELF_RESOLVING with no UUID is a no-op', () => {
  const chain = {
    isStale: false,
    startId: 'x',
    pathIds: ['x'],
    terminal: {
      kind: 'SELF_RESOLVING',
      etaIso: '2026-05-15T17:00Z',
      label: 'Self-resolving by 2026-05-15T17:00Z',
    },
  };
  const out = humanizeChain(chain, new Map());
  assert.equal(out.terminal.label, 'Self-resolving by 2026-05-15T17:00Z');
});

test('humanizeChain: EXTERNAL terminal with UUID substring still scrubs UUIDs', () => {
  const chain = {
    isStale: false,
    startId: 'x',
    pathIds: ['x'],
    terminal: {
      kind: 'EXTERNAL',
      label: 'External (b2a22e50-d772-4b70-bb50-4f4e93c2e984)',
    },
  };
  const lookup = new Map([
    ['b2a22e50-d772-4b70-bb50-4f4e93c2e984', { label: 'Stripe', kind: 'agent' }],
  ]);
  const out = humanizeChain(chain, lookup);
  assert.equal(out.terminal.label, 'External (Stripe)');
});

// BLANKET — for every drill-derived fixture, output is UUID-free.
const DRILL_FIXTURES = [
  {
    isStale: false,
    startId: 'b2a22e50-d772-4b70-bb50-4f4e93c2e984',
    pathIds: ['b2a22e50-d772-4b70-bb50-4f4e93c2e984'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'Owner unknown — assign b2a22e50-d772-4b70-bb50-4f4e93c2e984 first',
      userId: '__unowned__',
    },
  },
  {
    isStale: false,
    startId: '58f86f42-9fa3-4922-acff-985191ca15a7',
    pathIds: ['58f86f42-9fa3-4922-acff-985191ca15a7'],
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      label: 'Owner unknown — assign 58f86f42-9fa3-4922-acff-985191ca15a7 first',
      userId: '__unowned__',
    },
  },
];

const DRILL_LOOKUP = new Map([
  ['b2a22e50-d772-4b70-bb50-4f4e93c2e984', { label: 'CEO', kind: 'agent' }],
  ['58f86f42-9fa3-4922-acff-985191ca15a7', { label: 'Editor', kind: 'agent' }],
]);

for (const [i, fixture] of DRILL_FIXTURES.entries()) {
  test(`humanizeChain BLANKET: drill fixture #${i} produces zero UUID-shaped substrings`, () => {
    const out = humanizeChain(fixture, DRILL_LOOKUP);
    assert.doesNotMatch(
      out.terminal.label,
      UUID_RE,
      `terminal.label leaked a UUID: ${out.terminal.label}`,
    );
  });
}

test('humanizeChain BLANKET: drill fixture even without lookup still scrubs UUIDs to short form', () => {
  for (const fixture of DRILL_FIXTURES) {
    const out = humanizeChain(fixture, new Map());
    assert.doesNotMatch(out.terminal.label, UUID_RE);
  }
});
