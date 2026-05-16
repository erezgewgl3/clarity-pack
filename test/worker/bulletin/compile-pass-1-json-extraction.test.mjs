// test/worker/bulletin/compile-pass-1-json-extraction.test.mjs
//
// Quick task 260516-gx4 Task 3 — Defect B.
//
// The 2026-05-16 Countermoves re-drill, with the session now reachable, hit a
// new failure: `compilePass1` rejects `LLM output was not valid JSON`. The
// Editor-Agent session DOES respond, but it wraps the BulletinDraft JSON in
// prose ("Here is the bulletin: {...}") or a ```json fence — and
// `compilePass1` ran `JSON.parse(raw)` directly on that wrapped string.
//
// The fix: a new pure `extractJsonObject(raw)` helper that peels a fence /
// prose preamble down to the bare `{...}` object before `JSON.parse`. Output
// that genuinely contains no JSON object still throws — so the existing
// 'LLM output was not valid JSON' rejection holds for true non-JSON.
//
// Group (a) — extractJsonObject unit cases.
// Group (b) — compilePass1 integration cases using the host-faithful sessions
//             fake from Task 1/2 (the agent streams fenced / prose / raw / non-
//             JSON output and the job must parse the first three, reject the
//             fourth).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  compilePass1,
  extractJsonObject,
} from '../../../src/worker/bulletin/compile-pass-1.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';
import { sessionLlmAdapter } from '../../../src/worker/agents/session-llm-adapter.ts';
import { makeHostFaithfulAgents } from '../../helpers/host-faithful-agents.mjs';

// ---- Group (a) — extractJsonObject unit cases ------------------------------

test('extractJsonObject: bare JSON object is returned unchanged', () => {
  const raw = '{"masthead":{"volume":"I"}}';
  assert.equal(extractJsonObject(raw), raw);
});

test('extractJsonObject: ```json fenced block -> the inner object', () => {
  const inner = '{"masthead":{"volume":"I"}}';
  const raw = '```json\n' + inner + '\n```';
  assert.equal(JSON.parse(extractJsonObject(raw)).masthead.volume, 'I');
});

test('extractJsonObject: bare ``` fence (no language tag) -> the inner object', () => {
  const inner = '{"a":1}';
  const raw = '```\n' + inner + '\n```';
  assert.deepEqual(JSON.parse(extractJsonObject(raw)), { a: 1 });
});

test('extractJsonObject: prose preamble before the object -> the {...} substring', () => {
  const raw = 'Here is the bulletin you asked for:\n{"a":1,"b":2}';
  assert.deepEqual(JSON.parse(extractJsonObject(raw)), { a: 1, b: 2 });
});

test('extractJsonObject: braces inside string values do not miscount (quote-aware)', () => {
  const raw = 'Note:\n{"text":"a } brace { in a string","n":7}';
  const parsed = JSON.parse(extractJsonObject(raw));
  assert.equal(parsed.text, 'a } brace { in a string');
  assert.equal(parsed.n, 7);
});

test('extractJsonObject: escaped quote inside a string is handled', () => {
  const raw = 'x {"q":"she said \\"hi\\" } here"}';
  const parsed = JSON.parse(extractJsonObject(raw));
  assert.equal(parsed.q, 'she said "hi" } here');
});

test('extractJsonObject: prose preamble + fenced block -> the fenced JSON wins', () => {
  const raw = 'Here is the bulletin:\n```json\n{"src":"fence"}\n```';
  assert.deepEqual(JSON.parse(extractJsonObject(raw)), { src: 'fence' });
});

test('extractJsonObject: nested objects -> the full outer object through its matching brace', () => {
  const raw = 'prose {"outer":{"inner":{"deep":true}},"tail":1} trailing prose';
  const parsed = JSON.parse(extractJsonObject(raw));
  assert.equal(parsed.outer.inner.deep, true);
  assert.equal(parsed.tail, 1);
});

test('extractJsonObject: genuinely non-JSON output (no { ) throws', () => {
  assert.throws(() => extractJsonObject('I could not complete this request.'));
});

test('extractJsonObject: empty string throws', () => {
  assert.throws(() => extractJsonObject(''));
});

// ---- Group (b) — compilePass1 integration via the host-faithful session ----

const EDITOR_UUID = '11111111-1111-4111-8111-111111111111';

function wellFormedDraft() {
  return {
    masthead: {
      volume: 'I',
      number: 1,
      weekday: 'Monday',
      dateText: '2026-05-07',
      prepareForName: 'Eric G.',
      cycleNumber: 1,
    },
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
  editorAgentId: EDITOR_UUID,
};

function makeCtx() {
  const failures = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: {
      async pause() {},
    },
    db: {
      async execute(sql, params) {
        if (/editor_agent_failures/i.test(sql)) failures.push({ sql, params });
        return { rowCount: 1 };
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, failures };
}

/**
 * Build a real sessionLlmAdapter wired to a host-faithful agent session that
 * streams `streamText` as its sole `chunk` event — exercising the production
 * accumulate-chunks-then-parse path with whatever wrapping the agent emits.
 */
function adapterStreaming(streamText) {
  const { agents } = makeHostFaithfulAgents({
    agentStatus: 'idle',
    sessionOpts: {
      events: [
        { eventType: 'chunk', stream: 'stdout', message: streamText, payload: null },
        { eventType: 'done', stream: 'system', message: null, payload: null },
      ],
    },
  });
  return sessionLlmAdapter({ agents }, { agentId: EDITOR_UUID, companyId: 'company-1' });
}

test('compilePass1 (b): agent streams ```json-fenced JSON -> parsed BulletinDraft', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeCtx();
  const fenced = '```json\n' + JSON.stringify(wellFormedDraft()) + '\n```';
  const draft = await compilePass1(ctx, { ...BASE_ARGS, llm: adapterStreaming(fenced) });
  assert.ok(draft.masthead, 'a fenced draft must parse into a BulletinDraft');
  assert.ok(Array.isArray(draft.departments));
});

test('compilePass1 (b): agent streams JSON with a prose preamble -> parsed BulletinDraft', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeCtx();
  const withProse = 'Here is the bulletin you requested:\n' + JSON.stringify(wellFormedDraft());
  const draft = await compilePass1(ctx, { ...BASE_ARGS, llm: adapterStreaming(withProse) });
  assert.ok(draft.masthead, 'a prose-wrapped draft must parse into a BulletinDraft');
});

test('compilePass1 (b): agent streams raw bare JSON -> parsed BulletinDraft (unchanged path)', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeCtx();
  const raw = JSON.stringify(wellFormedDraft());
  const draft = await compilePass1(ctx, { ...BASE_ARGS, llm: adapterStreaming(raw) });
  assert.ok(draft.masthead, 'raw JSON must still parse');
});

test('compilePass1 (b): agent streams non-JSON prose -> still rejects "LLM output was not valid JSON"', async () => {
  resetCircuitBreakerState();
  const { ctx, failures } = makeCtx();
  await assert.rejects(
    compilePass1(ctx, {
      ...BASE_ARGS,
      llm: adapterStreaming('I could not complete this request — please retry.'),
    }),
    /LLM output was not valid JSON/,
  );
  assert.equal(failures.length, 1, 'a genuinely non-JSON output still records one failure');
});

test('compilePass1 (b): agent streams a fenced block of NON-JSON text -> still rejects', async () => {
  resetCircuitBreakerState();
  const { ctx } = makeCtx();
  await assert.rejects(
    compilePass1(ctx, {
      ...BASE_ARGS,
      llm: adapterStreaming('```\nnot json at all\n```'),
    }),
    /LLM output was not valid JSON/,
  );
});
