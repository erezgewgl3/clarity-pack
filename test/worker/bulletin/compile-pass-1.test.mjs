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

function makeCtx() {
  const failures = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: { async pause() {} },
    db: {
      async execute(sql, params) {
        if (/editor_agent_failures/i.test(sql)) {
          failures.push({ sql, params });
        }
        return { rowCount: 1 };
      },
    },
  };
  return { ctx, failures };
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

const BASE_ARGS = {
  companyId: 'company-1',
  cycleNumber: 1,
  factsTable: {},
  standingNumbers: [],
  departments: ['Production', 'Sales'],
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
