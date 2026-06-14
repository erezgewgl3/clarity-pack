// test/worker/handlers/issue-reader-activity-actor-scrub.test.mjs
//
// Phase 18 (LEG-02 gap) — the Reader activity timeline must NEVER render a raw
// comment-author UUID (or a legacy `agent#<hex>` partial-hash) as the actor.
// Discovered in the live BEAAA drill: commentToActivity set
//   actor = authorUserId ?? authorAgentId ?? null
// and the UI rendered `{e.actor}` verbatim, so an unresolved agent/user UUID
// (e.g. 54d017b2-2a20-4dc3-8990-84b595368db2) leaked into human-facing text.
//
// These tests assert the NO_UUID_LEAK contract for the activity actor:
//   1. A raw-UUID author resolves to a real name when ctx.agents.get knows it.
//   2. A raw-UUID author with NO resolution → AGENT_FALLBACK, never the UUID.
//   3. A readable non-UUID author (e.g. "local-board") passes through unchanged.
//   4. Degrade path: ctx.agents.get throwing → AGENT_FALLBACK, no throw.
//   5. A residual UUID embedded in a "resolved" name is still scrubbed (floor).
//
// The vocabulary (UUID_RE / PARTIAL_HEX_RE / AGENT_FALLBACK) is imported from
// the SINGLE source of truth so the test can never drift from the runtime guard.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerIssueReader } from '../../../src/worker/handlers/issue-reader.ts';
import {
  UUID_RE,
  PARTIAL_HEX_RE,
  AGENT_FALLBACK,
} from '../../../src/shared/scrub-human-action.ts';

const RAW_UUID_A = '54d017b2-2a20-4dc3-8990-84b595368db2';
const RAW_UUID_B = '93e0b62b-2d87-4dc7-990a-5808079e1c4e';
const ISSUE_ID = 'BEAAA-972';

// Minimal ctx: only the slices the activity path touches. The opt-in guard
// query, the issue.get, the TL;DR cache, and listComments are stubbed; every
// other slice degrades to empty (which is fine for these assertions).
function makeCtx({ comments, agentsGet }) {
  const registered = new Map();
  const agentsGetCalls = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    data: { register(k, h) { registered.set(k, h); } },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async execute() { return { rowCount: 0 }; },
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        return [];
      },
    },
    issues: {
      async get(id) {
        if (id === ISSUE_ID) {
          return {
            id: ISSUE_ID,
            identifier: ISSUE_ID,
            key: ISSUE_ID,
            title: 'test issue',
            description: 'no refs here',
            parentId: null,
            projectId: null,
            goalId: null,
            status: 'in_progress',
          };
        }
        return null;
      },
      async list() { return []; },
      async listComments() { return comments; },
      relations: { async get() { return { blockedBy: [], blocks: [] }; } },
      documents: { async list() { return []; }, async get() { return null; } },
    },
    agents: {
      async get(uuid, companyId) {
        agentsGetCalls.push({ uuid, companyId });
        return agentsGet(uuid, companyId);
      },
    },
  };
  return { ctx, registered, agentsGetCalls };
}

async function runReader(ctx, registered) {
  registerIssueReader(ctx);
  const handler = registered.get('issue.reader');
  assert.ok(handler, 'issue.reader handler registered');
  return handler({ userId: 'viewer-1', issueId: ISSUE_ID, companyId: 'co-1' });
}

function assertNoLeak(actor) {
  assert.equal(typeof actor === 'string' || actor === null, true, 'actor is string|null');
  if (typeof actor === 'string') {
    assert.equal(UUID_RE.test(actor), false, `actor must not contain a UUID: "${actor}"`);
    assert.equal(PARTIAL_HEX_RE.test(actor), false, `actor must not contain agent#<hex>: "${actor}"`);
  }
}

test('activity actor: a raw-UUID author resolves to a real name (never the UUID)', async () => {
  const { ctx, registered, agentsGetCalls } = makeCtx({
    comments: [
      { id: 'c-1', authorUserId: RAW_UUID_A, createdAt: '2026-06-13T19:30:00Z', body: 'did a thing' },
    ],
    agentsGet: (uuid) => (uuid === RAW_UUID_A ? { id: uuid, name: 'CFO Bot' } : null),
  });
  const result = await runReader(ctx, registered);
  assert.equal(result.activity.length, 1);
  assert.equal(result.activity[0].actor, 'CFO Bot', 'resolved to the agent name');
  assertNoLeak(result.activity[0].actor);
  // Resolution actually fired for the UUID author.
  assert.ok(agentsGetCalls.some((c) => c.uuid === RAW_UUID_A), 'agents.get called for the UUID author');
});

test('activity actor: an UNRESOLVED raw-UUID author becomes AGENT_FALLBACK (never the UUID)', async () => {
  const { ctx, registered } = makeCtx({
    comments: [
      { id: 'c-1', authorAgentId: RAW_UUID_B, createdAt: '2026-06-13T19:30:00Z', body: 'agent note' },
    ],
    agentsGet: () => null, // host does not resolve it
  });
  const result = await runReader(ctx, registered);
  assert.equal(result.activity[0].actor, AGENT_FALLBACK, 'falls back to plain English');
  assertNoLeak(result.activity[0].actor);
});

test('activity actor: a readable non-UUID author (e.g. "local-board") passes through unchanged', async () => {
  const { ctx, registered, agentsGetCalls } = makeCtx({
    comments: [
      { id: 'c-1', authorUserId: 'local-board', createdAt: '2026-06-13T19:30:00Z', body: 'board note' },
    ],
    agentsGet: () => { throw new Error('should not be called for a readable id'); },
  });
  const result = await runReader(ctx, registered);
  assert.equal(result.activity[0].actor, 'local-board', 'readable id preserved verbatim');
  assertNoLeak(result.activity[0].actor);
  // A readable id needs no lookup — O(unique UUID authors), no wasted round-trip.
  assert.equal(agentsGetCalls.length, 0, 'no agents.get spent on a readable author');
});

test('activity actor: degrade path — agents.get THROWING yields AGENT_FALLBACK and never throws', async () => {
  const { ctx, registered } = makeCtx({
    comments: [
      { id: 'c-1', authorUserId: RAW_UUID_A, createdAt: '2026-06-13T19:30:00Z', body: 'x' },
    ],
    agentsGet: () => { throw new Error('resolution backend down'); },
  });
  // Must not throw — the whole Reader payload still returns.
  const result = await runReader(ctx, registered);
  assert.equal(result.activity[0].actor, AGENT_FALLBACK, 'degrades to AGENT_FALLBACK on throw');
  assertNoLeak(result.activity[0].actor);
});

test('activity actor: the read-time floor scrubs a residual UUID embedded in a "resolved" name', async () => {
  // Even a pathological resolution that returns a name containing a UUID must
  // not leak — rescrubPersisted rewrites the embedded UUID to AGENT_FALLBACK.
  const { ctx, registered } = makeCtx({
    comments: [
      { id: 'c-1', authorUserId: RAW_UUID_A, createdAt: '2026-06-13T19:30:00Z', body: 'x' },
    ],
    agentsGet: () => ({ id: RAW_UUID_A, name: `agent ${RAW_UUID_A}` }),
  });
  const result = await runReader(ctx, registered);
  assertNoLeak(result.activity[0].actor);
});

test('activity actor: batches/dedupes — N comments by the SAME UUID author = ONE agents.get', async () => {
  const { ctx, registered, agentsGetCalls } = makeCtx({
    comments: [
      { id: 'c-1', authorUserId: RAW_UUID_A, createdAt: '2026-06-13T19:30:00Z', body: 'one' },
      { id: 'c-2', authorUserId: RAW_UUID_A, createdAt: '2026-06-13T19:31:00Z', body: 'two' },
      { id: 'c-3', authorUserId: RAW_UUID_A, createdAt: '2026-06-13T19:32:00Z', body: 'three' },
    ],
    agentsGet: () => ({ id: RAW_UUID_A, name: 'Repeat Bot' }),
  });
  const result = await runReader(ctx, registered);
  assert.equal(result.activity.length, 3);
  for (const e of result.activity) assert.equal(e.actor, 'Repeat Bot');
  const distinct = new Set(agentsGetCalls.map((c) => c.uuid));
  assert.equal(distinct.size, 1, 'only the distinct UUID author was resolved');
  assert.equal(agentsGetCalls.length, 1, 'agents.get fired exactly once (deduped, no N+1)');
});

test('activity actor: a pre-resolved name carried ON the comment is used without a lookup', async () => {
  const { ctx, registered, agentsGetCalls } = makeCtx({
    comments: [
      {
        id: 'c-1',
        authorUserId: RAW_UUID_A,
        authorName: 'Pre-Resolved Editor',
        createdAt: '2026-06-13T19:30:00Z',
        body: 'x',
      },
    ],
    agentsGet: () => { throw new Error('should not be called when a name is carried'); },
  });
  const result = await runReader(ctx, registered);
  assert.equal(result.activity[0].actor, 'Pre-Resolved Editor', 'carried name used directly');
  assertNoLeak(result.activity[0].actor);
  assert.equal(agentsGetCalls.length, 0, 'no lookup spent when the comment carries a readable name');
});
