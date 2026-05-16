// test/worker/bulletin/compile-pass-1.test.mjs
//
// Plan 03-02 Task 1 RED — pass-1 LLM call producing a structured BulletinDraft.
// Mirrors compile-tldr.ts cap-then-call shape: token cap enforced BEFORE the
// LLM call; LLM errors / parse failures / schema failures call recordFailure.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  compilePass1,
  validateDraftSchema,
  BULLETIN_COMPILE_AGENT_KEY,
  MAX_BULLETIN_TOKENS,
} from '../../../src/worker/bulletin/compile-pass-1.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx() {
  const failures = [];
  const pauseCalls = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: {
      async pause(agentId, companyId) {
        pauseCalls.push({ agentId, companyId });
      },
    },
    db: {
      async execute(sql, params) {
        if (/editor_agent_failures/i.test(sql)) {
          failures.push({ sql, params });
        }
        return { rowCount: 1 };
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, failures, pauseCalls };
}

function wellFormedDraft() {
  return {
    masthead: { volume: 'I', number: 1, weekday: 'Monday', dateText: '2026-05-07', prepareForName: 'Eric G.', cycleNumber: 1 },
    actionInbox: [],
    departments: [],
    standingNumbers: [],
    lineageThreads: [],
  };
}

/** A real UUID — the shape the host's `agents.pause` requires. */
const EDITOR_UUID = '11111111-1111-4111-8111-111111111111';

const BASE_ARGS = {
  companyId: 'company-1',
  cycleNumber: 1,
  factsTable: {},
  standingNumbers: [],
  departments: ['Production', 'Sales'],
  editorAgentId: EDITOR_UUID,
};

test('compile-pass-1: BULLETIN_COMPILE_AGENT_KEY is the locked literal', () => {
  assert.equal(BULLETIN_COMPILE_AGENT_KEY, 'bulletin-compile');
});

test('compile-pass-1: MAX_BULLETIN_TOKENS is a number >= 4000', () => {
  assert.equal(typeof MAX_BULLETIN_TOKENS, 'number');
  assert.ok(MAX_BULLETIN_TOKENS >= 4000);
});

test('compile-pass-1: validateDraftSchema does not throw on a well-formed BulletinDraft', () => {
  assert.doesNotThrow(() => validateDraftSchema(wellFormedDraft(), {}));
});

test('compile-pass-1: validateDraftSchema throws on null', () => {
  assert.throws(() => validateDraftSchema(null, {}));
});

test('compile-pass-1: validateDraftSchema throws when masthead is not an object', () => {
  assert.throws(() => validateDraftSchema({ masthead: 'not an object' }, {}));
});

test('compile-pass-1: token cap exceeded -> recordFailure + throws with cap message', async () => {
  resetCircuitBreakerState();
  const { ctx, failures } = makeCtx();
  // A deliberately huge factsTable blows past the token cap.
  const huge = {};
  for (let i = 0; i < 20000; i += 1) huge[`k${i}`] = { sql: 'x', params: [], value: i, format: 'count' };
  await assert.rejects(
    compilePass1(ctx, { ...BASE_ARGS, factsTable: huge, llm: { async complete() { return '{}'; } } }),
    /exceeds max_tokens cap/i,
  );
  assert.equal(failures.length, 1, 'recordFailure must append exactly one audit row');
});

test('compile-pass-1: LLM throws -> recordFailure called once + original error re-thrown', async () => {
  resetCircuitBreakerState();
  const { ctx, failures } = makeCtx();
  const boom = new Error('llm-down');
  await assert.rejects(
    compilePass1(ctx, {
      ...BASE_ARGS,
      llm: { async complete() { throw boom; } },
    }),
    /llm-down/,
  );
  assert.equal(failures.length, 1);
});

test('compile-pass-1: valid LLM output parses + validates into a BulletinDraft', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeCtx();
  const draft = await compilePass1(ctx, {
    ...BASE_ARGS,
    llm: { async complete() { return JSON.stringify(wellFormedDraft()); } },
  });
  assert.ok(draft.masthead);
  assert.ok(Array.isArray(draft.departments));
});

test('compile-pass-1: a tripped circuit breaker pauses the RESOLVED agent UUID, not the name tag', async () => {
  // 2026-05-16 Countermoves drill defect A: compilePass1 hardcoded
  // `agentId: EDITOR_AGENT_ID_TAG` ('clarity-pack-editor-agent') in its
  // recordFailure calls. On the 3rd consecutive failure the D-06 breaker
  // calls ctx.agents.pause(agentId, …) — the host then rejects the non-UUID
  // with `invalid input syntax for type uuid`, masking the real failure.
  // compilePass1 must pass the resolved Editor-Agent UUID instead.
  resetCircuitBreakerState();
  const { ctx, pauseCalls } = makeCtx();
  const failingArgs = {
    ...BASE_ARGS,
    llm: { async complete() { throw new Error('llm-down'); } },
  };
  // MAX_CONSECUTIVE_FAILURES = 3 — three failures trip the breaker.
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(compilePass1(ctx, failingArgs), /llm-down/);
  }
  assert.equal(pauseCalls.length, 1, 'the breaker must pause exactly once, on the 3rd failure');
  assert.equal(
    pauseCalls[0].agentId,
    EDITOR_UUID,
    'pause must receive the resolved Editor-Agent UUID — the non-UUID tag "clarity-pack-editor-agent" is rejected host-side as invalid uuid syntax',
  );
});
