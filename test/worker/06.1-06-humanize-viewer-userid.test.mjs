// Quick proving test for Plan 06.1-06: humanize-snapshot's "You"
// substitution for viewer userId in HUMAN_ACTION_ON terminal labels.
//
// Simulates the EXACT live scenario from Countermoves:
//   - Eric's userId: E8TMB44X20gwBYvFz3Qf4jUO7lbc8klB
//   - Chain terminal: HUMAN_ACTION_ON with userId === Eric's
//   - Pre-fix label: "E8TMB44X... to act on CEO"
//   - Expected post-fix label: "You to act on CEO"

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { humanizeChain, buildIdLookup } from '../../src/worker/jobs/humanize-snapshot.ts';

const ERIC_USER_ID = 'E8TMB44X20gwBYvFz3Qf4jUO7lbc8klB';
const CEO_AGENT_ID = 'b2a22e50-d772-4b70-bb50-4f4e93c2e984';

test('Plan 06.1-06: HUMAN_ACTION_ON with viewerUserId match → label substitutes "You"', () => {
  const chain = {
    startId: CEO_AGENT_ID,
    pathIds: [CEO_AGENT_ID],
    isStale: false,
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      userId: ERIC_USER_ID,
      label: `${ERIC_USER_ID} to act on ${CEO_AGENT_ID}`,
    },
  };
  const lookup = buildIdLookup({
    agents: [{ id: CEO_AGENT_ID, role: 'ceo' }],
    users: [],
  });

  const result = humanizeChain(chain, lookup, ERIC_USER_ID);

  console.log('LABEL:', result.terminal.label);
  assert.equal(result.terminal.label.includes(ERIC_USER_ID), false, 'raw user-id should NOT appear');
  assert.ok(result.terminal.label.includes('You'), 'label should contain "You"');
});

test('Plan 06.1-06 v2: HUMAN_ACTION_ON with NO viewerUserId → still substitutes "You" (v1.0 single-op)', () => {
  // v1.0 single-operator semantics: the worker only ever resolves
  // chains for the active operator, so any HUMAN_ACTION_ON terminal
  // with a non-__unowned__ userId is "You" by definition.
  const chain = {
    startId: CEO_AGENT_ID,
    pathIds: [CEO_AGENT_ID],
    isStale: false,
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      userId: ERIC_USER_ID,
      label: `${ERIC_USER_ID} to act on ${CEO_AGENT_ID}`,
    },
  };
  const lookup = buildIdLookup({ agents: [{ id: CEO_AGENT_ID, role: 'ceo' }], users: [] });

  const result = humanizeChain(chain, lookup);  // no viewerUserId arg

  console.log('LABEL (no viewerUserId):', result.terminal.label);
  assert.equal(result.terminal.label.includes(ERIC_USER_ID), false, 'raw user-id should NOT appear (v1.0 single-op)');
  assert.ok(result.terminal.label.includes('You'), 'label should contain "You"');
});

test('Plan 06.1-06 v2: __unowned__ terminal still uses "no owner assigned" form (regression baseline)', () => {
  const chain = {
    startId: CEO_AGENT_ID,
    pathIds: [CEO_AGENT_ID],
    isStale: false,
    terminal: {
      kind: 'HUMAN_ACTION_ON',
      userId: '__unowned__',
      label: `${CEO_AGENT_ID} to act on ${CEO_AGENT_ID}`,  // mimics blocker-chain.ts fallback
    },
  };
  const lookup = buildIdLookup({ agents: [{ id: CEO_AGENT_ID, role: 'ceo' }], users: [] });

  const result = humanizeChain(chain, lookup, ERIC_USER_ID);

  console.log('LABEL (__unowned__):', result.terminal.label);
  assert.ok(result.terminal.label.includes('no owner assigned'), '__unowned__ keeps the existing rewrite');
  assert.equal(result.terminal.label.includes('You'), false, '"You" should NOT appear on __unowned__ terminals');
});
