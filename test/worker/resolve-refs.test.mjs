// test/worker/resolve-refs.test.mjs
//
// Plan 02-02 Task 1 — verifies the worker handler invokes the fetcher exactly
// ONCE for N=5 ids (PRIM-01 single round-trip). The fake ctx records every
// ctx.http.fetch call so the assertion is direct.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerResolveRefs } from '../../src/worker/handlers/resolve-refs.ts';

function makeFakeCtx() {
  const fetchCalls = [];
  const registered = new Map();
  const ctx = {
    host: { currentCompanyId: 'company-1' },
    data: {
      register(key, handler) {
        registered.set(key, handler);
      },
    },
    // Plan 02-04 Task 1: wrapDataHandler queries clarity_user_prefs first.
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    http: {
      async fetch(url, init) {
        fetchCalls.push({ url, init });
        // Parse ids out of the query string and return one issue per id.
        const idsParam = new URL('http://x' + url).searchParams.get('ids') ?? '';
        const ids = idsParam.split(',').filter(Boolean);
        return {
          async json() {
            return ids.map((id) => ({
              key: id,
              title: `Title ${id}`,
              status: 'in_progress',
              assignee_user_id: 'eric',
              body: `Body of ${id}`,
              _viewer_can_read: true,
            }));
          },
        };
      },
    },
  };
  return { ctx, fetchCalls, registered };
}

test('registerResolveRefs registers a resolve-refs handler that invokes the fetcher EXACTLY ONCE for N=5 ids (PRIM-01)', async () => {
  const { ctx, fetchCalls, registered } = makeFakeCtx();
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  assert.ok(handler, "handler 'resolve-refs' was registered");

  const ids = ['BEAAA-1', 'BEAAA-2', 'BEAAA-3', 'BEAAA-4', 'BEAAA-5'];
  const result = await handler({ userId: 'eric', ids });

  assert.equal(fetchCalls.length, 1, `expected ONE fetch call; got ${fetchCalls.length}`);
  assert.match(fetchCalls[0].url, /\/api\/companies\/company-1\/issues\?ids=/);
  assert.equal(result.length, 5);
  assert.equal(result[0].id, 'BEAAA-1');
  assert.equal(result[0].url, '/issues/BEAAA-1');
  // Excerpt forwarded (short body, no truncation, _viewer_can_read=true)
  assert.equal(result[0].excerpt, 'Body of BEAAA-1');
});

test('registerResolveRefs handles empty input without making any fetch calls', async () => {
  const { ctx, fetchCalls, registered } = makeFakeCtx();
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: [] });
  assert.deepEqual(result, []);
  assert.equal(fetchCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Plan 05-05 Task 2 (D-09) — descriptionExcerpt + ownerName extension
// ---------------------------------------------------------------------------

function makeAgentsFakeCtx({ agentsGetThrows = false, agentName = 'CEO Bot', body = 'first line\nsecond line\nthird' } = {}) {
  const fetchCalls = [];
  const agentsGetCalls = [];
  const registered = new Map();
  const ctx = {
    host: { currentCompanyId: 'company-1' },
    data: { register(key, h) { registered.set(key, h); } },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    http: {
      async fetch(url) {
        fetchCalls.push(url);
        const idsParam = new URL('http://x' + url).searchParams.get('ids') ?? '';
        const ids = idsParam.split(',').filter(Boolean);
        return {
          async json() {
            return ids.map((id) => ({
              key: id,
              title: `Title ${id}`,
              status: 'in_progress',
              assignee_user_id: 'agent-uuid-001',
              body,
              _viewer_can_read: true,
            }));
          },
        };
      },
    },
    agents: {
      async get(uuid, companyId) {
        agentsGetCalls.push({ uuid, companyId });
        if (agentsGetThrows) throw new Error('agents.get failure');
        return { id: uuid, name: agentName };
      },
    },
    logger: { warn() {}, info() {}, error() {} },
  };
  return { ctx, fetchCalls, agentsGetCalls, registered };
}

test('D-09 — descriptionExcerpt truncates to 120 chars + first-line only (no \\n)', async () => {
  // 200-char first line + a newline + second line. Worker truncates first
  // line to 120 chars with ellipsis; the multiline tail is dropped entirely.
  const longFirstLine = 'A'.repeat(200);
  const body = `${longFirstLine}\nsecond line should not appear`;
  const { ctx, registered } = makeAgentsFakeCtx({ body });
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-10'] });
  assert.equal(result.length, 1);
  const excerpt = result[0].descriptionExcerpt;
  assert.ok(typeof excerpt === 'string', 'descriptionExcerpt is a string');
  assert.ok(excerpt.length <= 120, `excerpt length ${excerpt.length} must be <= 120`);
  assert.match(excerpt, /…$/, 'long excerpt ends with …');
  assert.equal(excerpt.includes('\n'), false, 'first-line-only — no newline in output');
  assert.equal(excerpt.includes('second line'), false, 'multiline tail dropped');
});

test('D-09 — descriptionExcerpt short-body case (no truncation needed)', async () => {
  const { ctx, registered } = makeAgentsFakeCtx({ body: 'short first line' });
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-11'] });
  assert.equal(result[0].descriptionExcerpt, 'short first line', 'short body returned verbatim');
});

test('D-09 — ownerName resolved via ctx.agents.get (NO_UUID_LEAK happy path)', async () => {
  const { ctx, registered, agentsGetCalls } = makeAgentsFakeCtx({ agentName: 'CEO Bot' });
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-12'] });
  assert.equal(result[0].ownerName, 'CEO Bot', 'ownerName is the resolved display name');
  assert.ok(agentsGetCalls.length >= 1, 'ctx.agents.get was invoked at least once for the owner UUID');
});

test('D-09 — ownerName degrades to null on ctx.agents.get throw — NEVER falls back to UUID', async () => {
  const { ctx, registered } = makeAgentsFakeCtx({ agentsGetThrows: true });
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-13'] });
  // The hygiene rule is about OPERATOR-VISIBLE display fields. ownerUserId
  // stays the legitimate UUID (it routes the URL); ownerName MUST be null
  // when the lookup degraded so the UI fallback is the literal 'unassigned'.
  assert.equal(result[0].ownerName, null, 'ownerName null on agents.get throw');
  // Operator-visible display fields must NOT contain the UUID. The UI peek
  // renders { title, status, ownerName, descriptionExcerpt } — only these.
  const visible = {
    title: result[0].title,
    status: result[0].status,
    ownerName: result[0].ownerName,
    descriptionExcerpt: result[0].descriptionExcerpt,
  };
  assert.doesNotMatch(JSON.stringify(visible), /agent-uuid-001/, 'display fields contain no UUID fallback');
});

test('D-09 + PRIM-01 — owner name resolution dedupes across multiple refs with the same ownerUserId', async () => {
  // Two refs with the same owner — agents.get should fire exactly ONCE (dedupe).
  const { ctx, registered, agentsGetCalls } = makeAgentsFakeCtx();
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  await handler({ userId: 'eric', ids: ['BEAAA-14', 'BEAAA-15'] });
  // distinct owner UUIDs returned by fake = 1 (both refs share assignee_user_id)
  const distinctUuids = new Set(agentsGetCalls.map((c) => c.uuid));
  assert.equal(distinctUuids.size, 1, 'agents.get fires only for distinct owner UUIDs');
});

test('D-09 + PRIM-02 — descriptionExcerpt is null when _viewer_can_read is false (viewer-gate inherited)', async () => {
  const fetchCalls = [];
  const registered = new Map();
  const ctx = {
    host: { currentCompanyId: 'company-1' },
    data: { register: (k, h) => registered.set(k, h) },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    http: {
      async fetch(url) {
        fetchCalls.push(url);
        return {
          async json() {
            return [
              {
                key: 'BEAAA-99',
                title: 'Secret',
                status: 'in_progress',
                assignee_user_id: 'agent-uuid-001',
                body: 'classified body',
                _viewer_can_read: false,
              },
            ];
          },
        };
      },
    },
    agents: { async get() { return { id: 'agent-uuid-001', name: 'CEO Bot' }; } },
    logger: { warn() {} },
  };
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-99'] });
  assert.equal(result[0].descriptionExcerpt, null, 'PRIM-02 — excerpt null when viewer cannot read');
  assert.equal(result[0].excerpt, null, 'legacy excerpt also null');
});

test('registerResolveRefs forwards _viewer_can_read=false as excerpt=null (PRIM-02 viewer-permission proxy)', async () => {
  const fetchCalls = [];
  const registered = new Map();
  const ctx = {
    host: { currentCompanyId: 'company-1' },
    data: { register: (k, h) => registered.set(k, h) },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query(sql) {
        if (/clarity_user_prefs/.test(sql)) {
          return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
        }
        return [];
      },
      async execute() { return { rowCount: 0 }; },
    },
    http: {
      async fetch(url) {
        fetchCalls.push(url);
        return {
          async json() {
            return [
              {
                key: 'BEAAA-7',
                title: 'Secret',
                status: 'in_progress',
                assignee_user_id: 'eric',
                body: 'classified body',
                _viewer_can_read: false,
              },
            ];
          },
        };
      },
    },
  };
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-7'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].excerpt, null, 'PRIM-02: excerpt null when viewer cannot read');
});
