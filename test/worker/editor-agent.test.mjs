// test/worker/editor-agent.test.mjs
//
// Plan 02-03 Task 1 — Editor-Agent integration: compileTldr enforces EDITOR-03
// idempotency (same hash → cache hit, no LLM call), EDITOR-05 max-tokens cap
// BEFORE the LLM call, EDITOR-04 tag stamp on writes (so the next heartbeat's
// self-loop filter excludes the write), and D-06 circuit breaker (3 LLM
// throws → ctx.agents.pause invoked once with the resolved agentId).
//
// The "LLM adapter" is injected. In production it's
// ctx.agents.invoke(agentId, ...) or an MCP tool the agent calls; the kernel
// of the contract — count calls, throw on budget, never invoke twice for the
// same hash — is identical and is what this test pins down.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  compileTldr,
  MAX_TOKENS,
  EDITOR_AGENT_ID_TAG,
} from '../../src/worker/agents/compile-tldr.ts';
import {
  resetCircuitBreakerState,
} from '../../src/worker/agents/circuit-breaker.ts';
import { EDITOR_WRITE_TAG } from '../../src/worker/agents/self-loop-filter.ts';

function makeFakeCtx({ llm, initialCache = [] } = {}) {
  const dbCalls = [];
  const pauseCalls = [];
  const cacheRows = [...initialCache];

  return {
    pauseCalls,
    dbCalls,
    llmCalls: llm?.calls,
    ctx: {
      logger: { info() {}, warn() {}, error() {} },
      llm: llm?.adapter, // injected adapter (test-only escape hatch on ctx)
      agents: {
        async pause(agentId, companyId) {
          pauseCalls.push({ agentId, companyId });
          return { id: agentId, status: 'paused' };
        },
      },
      db: {
        async execute(sql, params) {
          dbCalls.push({ kind: 'execute', sql, params });
          if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
            const [surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags] = params;
            if (!cacheRows.some((r) => r.surface === surface && r.scope_id === scope_id && r.content_hash === content_hash)) {
              cacheRows.push({ surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags });
            }
          }
        },
        async query(sql, params) {
          dbCalls.push({ kind: 'query', sql, params });
          if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
            // intentional: matches whether SELECT is multi-line or not (FROM .. tldr_cache is the unique marker)
            const [surface, scope_id] = params;
            const matching = cacheRows.filter((r) => r.surface === surface && r.scope_id === scope_id);
            matching.sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
            return { rows: matching.slice(0, 1) };
          }
          return { rows: [] };
        },
      },
    },
    cacheRows,
  };
}

function makeStubLlm(responses = ['compiled body']) {
  const calls = [];
  let i = 0;
  return {
    calls,
    adapter: {
      async complete(args) {
        calls.push(args);
        const r = responses[Math.min(i, responses.length - 1)];
        i++;
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

test('compileTldr is idempotent — same inputs twice invoke the LLM adapter EXACTLY ONCE (EDITOR-03)', async () => {
  resetCircuitBreakerState();
  const llm = makeStubLlm(['the tldr body 1', 'the tldr body 2 (should not be reached)']);
  const fake = makeFakeCtx({ llm });
  const args = {
    surface: 'issue',
    scopeId: 'BEAAA-141',
    inputs: { body: 'short body', comments: [], refs: [] },
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
  };
  const first = await compileTldr(fake.ctx, args);
  const second = await compileTldr(fake.ctx, args);
  assert.equal(llm.calls.length, 1, 'second compile is a cache hit; LLM not called again');
  assert.equal(first.body, 'the tldr body 1');
  assert.equal(second.body, 'the tldr body 1', 'second result is the cached row');
});

test('compileTldr throws BEFORE invoking the LLM adapter when input exceeds MAX_TOKENS (EDITOR-05)', async () => {
  resetCircuitBreakerState();
  const llm = makeStubLlm(['should-not-be-called']);
  const fake = makeFakeCtx({ llm });
  const oversized = 'x'.repeat(MAX_TOKENS * 5); // ~5x cap (estimator is 4 chars/token)
  await assert.rejects(
    () =>
      compileTldr(fake.ctx, {
        surface: 'issue',
        scopeId: 'BEAAA-OVER',
        inputs: { body: oversized, comments: [], refs: [] },
        agentKey: 'editor-agent',
        agentId: 'uuid-1',
        companyId: 'co-1',
      }),
    /max_tokens|MAX_TOKENS/i,
  );
  assert.equal(llm.calls.length, 0, 'LLM adapter never called when cap-check fires first');
});

test('compileTldr stamps clarity:editor-write tag AND EDITOR_AGENT_ID_TAG on the cached row (D-04 self-loop input)', async () => {
  resetCircuitBreakerState();
  const llm = makeStubLlm(['tagged body']);
  const fake = makeFakeCtx({ llm });
  const result = await compileTldr(fake.ctx, {
    surface: 'issue',
    scopeId: 'BEAAA-TAG',
    inputs: { body: 'tiny', comments: [], refs: [] },
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
  });
  assert.ok(Array.isArray(result.tags));
  assert.ok(result.tags.includes(EDITOR_WRITE_TAG), `tags include ${EDITOR_WRITE_TAG}`);
  assert.equal(result.compiled_by_agent_id, EDITOR_AGENT_ID_TAG);
});

test('3 consecutive LLM throws trigger ctx.agents.pause exactly once with (agentId, companyId) — D-06', async () => {
  resetCircuitBreakerState();
  const llm = makeStubLlm([new Error('e1'), new Error('e2'), new Error('e3')]);
  const fake = makeFakeCtx({ llm });
  const makeArgs = (id) => ({
    surface: 'issue',
    scopeId: id,
    inputs: { body: 'short', comments: [], refs: [] },
    agentKey: 'editor-agent',
    agentId: 'uuid-1',
    companyId: 'co-1',
  });
  await assert.rejects(() => compileTldr(fake.ctx, makeArgs('I-1')));
  await assert.rejects(() => compileTldr(fake.ctx, makeArgs('I-2')));
  await assert.rejects(() => compileTldr(fake.ctx, makeArgs('I-3')));
  assert.equal(fake.pauseCalls.length, 1, 'pause invoked once after 3rd failure');
  assert.equal(fake.pauseCalls[0].agentId, 'uuid-1');
  assert.equal(fake.pauseCalls[0].companyId, 'co-1');
});

test('compileTldr output failing schema validation (empty / too long) counts as a failure', async () => {
  resetCircuitBreakerState();
  const llm = makeStubLlm(['']); // empty output → schema fail
  const fake = makeFakeCtx({ llm });
  await assert.rejects(
    () =>
      compileTldr(fake.ctx, {
        surface: 'issue',
        scopeId: 'BEAAA-EMPTY',
        inputs: { body: 'tiny', comments: [], refs: [] },
        agentKey: 'editor-agent',
        agentId: 'uuid-1',
        companyId: 'co-1',
      }),
    /schema|validation|output/i,
  );
});

test('MAX_TOKENS is the locked literal 4000 (D-05 placeholder)', () => {
  assert.equal(MAX_TOKENS, 4000);
});
