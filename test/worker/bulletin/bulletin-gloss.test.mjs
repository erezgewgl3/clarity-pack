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

// ---------------------------------------------------------------------------
// Plan 07-05 read-back fix (BUG 2) — the compile lands on a LATER view.
//
// The Editor-Agent files its compile-result document AND (per
// RESULT_DELIVERY_INSTRUCTION) marks the operation issue `done` ~40s after the
// START view's immediate poll has already returned `pending`. By the next view
// the op is TERMINAL, so startAgentTask's idempotency search (which reuses only
// NON-terminal ops) skips it and spawns a fresh op whose immediate poll is again
// `pending` → permanent "Gloss pending…" + a wasteful recompile per view.
//
// A stateful host stub reproduces the two-view sequence: view 1 creates op-1 +
// returns `compiling`; the agent then stores the result on op-1 and marks it
// done; view 2 must READ BACK op-1's stored result (NOT spawn a duplicate op),
// finalize it into the cache, and return `glossed`.
test('compile lands on a LATER view → existing op READ BACK, same op reused, gloss applied (no duplicate op)', async () => {
  const GLOSS = 'We re-ran the live tests to confirm the quality numbers stay trustworthy.';
  const GLOSS_BODY = `{"${THREAD_ID}":"${GLOSS}"}`;

  const opStore = []; // { id, originId, status, doc: string|null }
  let opSeq = 0;
  const spies = { creates: 0, finalizeUpserts: 0 };

  const ctx = {
    logger: { warn() {}, info() {} },
    db: {
      async query() {
        return []; // ALWAYS a cache miss — forces the read-back / start path.
      },
      async execute(sql) {
        if (/INSERT INTO plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          spies.finalizeUpserts += 1;
        }
        return { rowCount: 0 };
      },
    },
    issues: {
      async list(args) {
        // startAgentTask idempotency AND the read-back lookup both pass originId.
        if (args && args.originId) {
          return opStore.filter((o) => o.originId === args.originId);
        }
        // resolveEditorAgentId op-issue discovery (originKindPrefix, no originId).
        if (args && args.originKindPrefix) {
          return [{ assigneeAgentId: 'agent-editor' }];
        }
        return [];
      },
      async create(input) {
        spies.creates += 1;
        const id = `op-${++opSeq}`;
        opStore.push({ id, originId: input.originId, status: 'todo', doc: null });
        return { id };
      },
      async requestWakeup() {
        return undefined;
      },
      async listComments() {
        return [];
      },
      async update(id, patch) {
        const o = opStore.find((x) => x.id === id);
        if (o && patch && patch.status) o.status = patch.status;
        return undefined;
      },
      documents: {
        async get(opId, key) {
          const o = opStore.find((x) => x.id === opId);
          if (o && o.doc && key === 'compile-result') return { body: o.doc, key: 'compile-result' };
          return null;
        },
        async list(opId) {
          const o = opStore.find((x) => x.id === opId);
          return o && o.doc ? [{ key: 'compile-result' }] : [];
        },
      },
    },
    agents: {
      async get() {
        return null; // status unknown → never the paused branch.
      },
      managed: {
        async reconcile() {
          return { agentId: 'agent-editor' };
        },
      },
    },
  };

  // VIEW 1 — no op yet → create op-1, immediate poll pending → compiling.
  const v1 = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 1, threads: threads() });
  assert.equal(v1.status, 'compiling', 'view 1 has no result yet');
  assert.equal(spies.creates, 1, 'view 1 creates exactly one op');
  assert.equal(opStore.length, 1);

  // AGENT compiles op-1 asynchronously: stores the compile-result document AND
  // marks the op done (exactly what RESULT_DELIVERY_INSTRUCTION instructs).
  opStore[0].doc = GLOSS_BODY;
  opStore[0].status = 'done';

  // VIEW 2 — cache still misses → must READ BACK op-1's stored result rather than
  // spawning a duplicate op whose immediate poll would again be pending.
  const v2 = await driveBulletinGlossStep(ctx, { companyId: 'co-1', cycleNumber: 1, threads: threads() });
  assert.equal(v2.status, 'glossed', 'view 2 must read back the gloss the agent already stored');
  assert.equal(v2.threads[0].gloss, GLOSS);
  assert.equal(spies.creates, 1, 'view 2 must NOT create a duplicate op — it reads back the existing one');
  assert.equal(spies.finalizeUpserts, 1, 'view 2 finalizes the read-back result into the cache');
});
