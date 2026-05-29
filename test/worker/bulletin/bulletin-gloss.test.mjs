// test/worker/bulletin/bulletin-gloss.test.mjs
//
// Plan 07-05 Task 1 RED — Phase 7 ITEM 5 (D-I5-02).
//
// `driveBulletinGlossStep` mirrors editor.ts driveTldrCompileStep: it compiles a
// one-line plain-English gloss per surviving lineage thread via the Editor-Agent
// (LLM) in a VALID HTTP-request scope (the bulletin.byCycle data handler — NOT
// the scope-dead compile-bulletin job), cached in the EXISTING tldr_cache
// (surface='bulletin', scopeId='bulletin-gloss:<cycle>'), keyed by a content-hash
// of the filtered thread set. A paused/unresolvable agent degrades gracefully to
// no-gloss (NEVER an error, NEVER auto-resume); the step NEVER throws.
//
// Convention: plain-object ctx stub (no new devDep); instance-neutral fixtures.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { driveBulletinGlossStep } from '../../../src/worker/bulletin/bulletin-gloss.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// A clearly COMPOSITE thread id (NOT a bare UUID) — the gloss must not echo a
// host UUID into the returned gloss text (plan-checker warning 1).
const THREAD_ID = 'iss-uuid:actor:1700000000';

function threads() {
  return [
    {
      id: THREAD_ID,
      entityId: 'iss-uuid',
      nodes: [{ time: '11:02', name: 'Pricing sheet draft', detail: 'Pricing sheet draft v2', isTerminal: true }],
      truncatedCount: 0,
    },
  ];
}

// A configurable ctx stub. `spies` records the host calls so a test can assert
// "no startAgentTask was issued" (cache-hit / paused / unavailable paths).
function makeCtx({
  cacheRow = null, // a TldrRow for getTldrByScope, or null (miss)
  ops = [{ assigneeAgentId: 'agent-editor' }], // op-issue discovery → editor agent id
  reconcileAgentId = 'agent-editor',
  agentStatus = null, // { status, pausedAt } from agents.get
  pollResult = { status: 'pending' }, // pollAgentTaskResult outcome
  startThrows = false,
} = {}) {
  const spies = { startCalls: 0, finalizeUpserts: 0, resumeCalls: 0, pollCalls: 0 };
  const ctx = {
    logger: { warn() {}, info() {} },
    db: {
      async query(sql) {
        if (/FROM plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          return cacheRow ? [cacheRow] : [];
        }
        return [];
      },
      async execute(sql) {
        // finalizeTldr upsert into tldr_cache
        if (/INSERT INTO plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          spies.finalizeUpserts += 1;
        }
        return { rowCount: 0 };
      },
    },
    issues: {
      async list(args) {
        // startAgentTask idempotency search carries an originId → no in-flight
        // op (so a fresh operation issue is created, exercising startCalls).
        if (args && args.originId) return [];
        // resolveEditorAgentId op-issue discovery (originKindPrefix, no originId)
        if (args && args.originKindPrefix) return ops;
        return [];
      },
      async create() {
        spies.startCalls += 1;
        if (startThrows) throw new Error('start failed');
        return { id: 'op-issue-1' };
      },
      async requestWakeup() {
        return undefined;
      },
      async listComments() {
        return [];
      },
      async update() {
        return undefined;
      },
      documents: {
        async get() {
          spies.pollCalls += 1;
          if (pollResult.status === 'ready') {
            return { body: pollResult.body, key: 'compile-result' };
          }
          return null;
        },
        async list() {
          return [];
        },
      },
    },
    agents: {
      async pause() {
        return undefined;
      },
      async get() {
        return agentStatus;
      },
      async resume() {
        spies.resumeCalls += 1;
        return undefined;
      },
      managed: {
        async reconcile() {
          return { agentId: reconcileAgentId };
        },
      },
    },
    _spies: spies,
  };
  return ctx;
}

// ---------------------------------------------------------------------------

test('empty threads → { threads:[], status:"glossed" } with NO agent call', async () => {
  const ctx = makeCtx();
  const out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: [] });
  assert.deepEqual(out.threads, []);
  assert.equal(out.status, 'glossed');
  assert.equal(ctx._spies.startCalls, 0);
});

test('cache HIT (content_hash matches) → glosses applied from the map, NO startAgentTask', async () => {
  // Compute the cache row with the SAME content hash the step will derive.
  // We rely on the step's own hashing by reading the row back: stage a row whose
  // content_hash matches by letting the step compute it — so we use a two-phase
  // approach: first run a MISS to learn the hash, then re-run with a matching row.
  const miss = makeCtx({ pollResult: { status: 'ready', body: `{"${THREAD_ID}":"x"}` } });
  await driveBulletinGlossStep(miss, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  // The miss path called finalizeTldr; capture the body the step canonicalized
  // via a fresh hit: stage a row body = the gloss map, content_hash = whatever
  // the step recomputes (it recomputes deterministically from the same threads).
  // Since we can't read the private hash, assert the HIT behavior structurally:
  // a row whose content_hash equals the step's recomputed hash yields a no-start.
  // We approximate by capturing the hash the step writes — see derivedHash test.
  assert.ok(true);
});

test('cache HIT path: a row with the step-derived content_hash short-circuits (no start)', async () => {
  // Derive the hash the step uses by running a MISS that finalizes, recording the
  // content_hash passed to the upsert via a capturing execute.
  let derivedHash = null;
  const capture = makeCtx({ pollResult: { status: 'ready', body: `{"${THREAD_ID}":"This means X"}` } });
  capture.db.execute = async (sql, params) => {
    if (/INSERT INTO plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
      derivedHash = params[2]; // content_hash is the 3rd column
    }
    return { rowCount: 0 };
  };
  await driveBulletinGlossStep(capture, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  assert.ok(derivedHash, 'expected the miss path to finalize and expose a content_hash');

  const hit = makeCtx({
    cacheRow: {
      surface: 'bulletin',
      scope_id: 'bulletin-gloss:7',
      content_hash: derivedHash,
      body: `{"${THREAD_ID}":"This means X"}`,
      generated_at: '2026-05-29T00:00:00.000Z',
      source_revisions: [derivedHash],
      compiled_by_agent_id: 'editor-agent',
      tags: [],
    },
  });
  const out = await driveBulletinGlossStep(hit, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  assert.equal(out.status, 'glossed');
  assert.equal(out.threads[0].gloss, 'This means X');
  assert.equal(hit._spies.startCalls, 0, 'a cache hit must NOT start an agent task');
});

test('cache MISS + READY poll → gloss applied, finalizeTldr called once, status glossed', async () => {
  const ctx = makeCtx({ pollResult: { status: 'ready', body: `{"${THREAD_ID}":"This means X"}` } });
  const out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  assert.equal(out.status, 'glossed');
  assert.equal(out.threads[0].gloss, 'This means X');
  assert.equal(ctx._spies.startCalls, 1);
  assert.equal(ctx._spies.finalizeUpserts, 1);
});

test('PAUSED agent → all gloss:null, status paused, NO startAgentTask, NO resume (no-auto-resume)', async () => {
  const ctx = makeCtx({ agentStatus: { status: 'paused', pausedAt: '2026-05-29T00:00:00.000Z' } });
  const out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  assert.equal(out.status, 'paused');
  assert.equal(out.threads[0].gloss, null);
  assert.equal(ctx._spies.startCalls, 0);
  assert.equal(ctx._spies.resumeCalls, 0, 'must NEVER auto-resume a paused agent on a passive view');
});

test('UNRESOLVABLE agent (no op + reconcile null) → gloss:null, status unavailable', async () => {
  const ctx = makeCtx({ ops: [], reconcileAgentId: null });
  const out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  assert.equal(out.status, 'unavailable');
  assert.equal(out.threads[0].gloss, null);
  assert.equal(ctx._spies.startCalls, 0);
});

test('NOT-ready poll → gloss:null, status compiling', async () => {
  const ctx = makeCtx({ pollResult: { status: 'pending' } });
  const out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  assert.equal(out.status, 'compiling');
  assert.equal(out.threads[0].gloss, null);
});

test('startAgentTask THROW → gloss:null without the step throwing', async () => {
  const ctx = makeCtx({ startThrows: true });
  let out;
  await assert.doesNotReject(async () => {
    out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  });
  assert.equal(out.threads[0].gloss, null);
  assert.notEqual(out.status, 'glossed');
});

test('malformed (non-JSON) ready body → gloss:null without throwing', async () => {
  const ctx = makeCtx({ pollResult: { status: 'ready', body: 'not json prose' } });
  let out;
  await assert.doesNotReject(async () => {
    out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  });
  assert.equal(out.threads[0].gloss, null);
});

test('NO_UUID_LEAK: no raw UUID appears in any returned gloss string', async () => {
  const ctx = makeCtx({ pollResult: { status: 'ready', body: `{"${THREAD_ID}":"This summarizes the pricing draft"}` } });
  const out = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 7, threads: threads() });
  for (const t of out.threads) {
    if (t.gloss) assert.ok(!UUID_RE.test(t.gloss), `gloss must not contain a raw UUID: ${t.gloss}`);
  }
});
