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
