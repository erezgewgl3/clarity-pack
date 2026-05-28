// test/worker/resolve-refs.test.mjs
//
// Plan 02-02 Task 1 — verifies the worker handler resolves N refs via the
// resolveRefs fetcher (PRIM-01 single fetcher invocation).
//
// 07-01 rewrite — resolution moved from the SSRF-blocked
// `ctx.http.fetch(.../issues?ids=...)` path to per-ref
// `ctx.issues.get(identifier, companyId)` in parallel + a cached
// `ctx.issues.list({companyId})`-and-match-on-.identifier fallback. PRIM-01 is
// redefined as "one fetcher invocation at the resolveRefs boundary"; the legacy
// `?ids=` http.fetch path must fire ZERO times. The fetcher echoes
// `id = the requested identifier` so reference-resolver's byId map hits. Field
// mapping reads the REAL camelCase SDK Issue shape
// (identifier / title / status / assigneeUserId / description).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerResolveRefs } from '../../src/worker/handlers/resolve-refs.ts';

function makeFakeCtx() {
  const fetchCalls = [];
  const getCalls = [];
  const listCalls = [];
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
    // 07-01 — the legacy SSRF-blocked path. KEPT in the fake so a regression
    // that still calls `?ids=` would be caught: the PRIM-01 test asserts this
    // is NEVER invoked for ref resolution.
    http: {
      async fetch(url, init) {
        fetchCalls.push({ url, init });
        return {
          async json() { return []; },
        };
      },
    },
    // 07-01 — the SDK resolution surface. get(issueId, companyId) returns the
    // camelCase Issue; the handler echoes `id = the requested identifier`.
    issues: {
      async get(issueId, companyId) {
        getCalls.push({ issueId, companyId });
        return {
          id: `uuid-${issueId}`,
          identifier: issueId,
          title: `Title ${issueId}`,
          status: 'in_progress',
          assigneeUserId: 'agent-uuid-eric',
          description: `Body of ${issueId}`,
        };
      },
      // Fallback (fires only when get returns null) — unused on the happy path.
      async list(input) {
        listCalls.push(input);
        return [];
      },
    },
    agents: {
      async get(uuid, companyId) {
        return { id: uuid, name: uuid === 'agent-uuid-eric' ? 'Eric' : 'Someone' };
      },
    },
    logger: { warn() {}, info() {}, error() {} },
  };
  return { ctx, fetchCalls, getCalls, listCalls, registered };
}

test('registerResolveRefs resolves N=5 refs via per-ref ctx.issues.get (PRIM-01: one fetcher invocation, ZERO ?ids= http.fetch)', async () => {
  const { ctx, fetchCalls, getCalls, registered } = makeFakeCtx();
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  assert.ok(handler, "handler 'resolve-refs' was registered");

  const ids = ['BEAAA-1', 'BEAAA-2', 'BEAAA-3', 'BEAAA-4', 'BEAAA-5'];
  const result = await handler({ userId: 'eric', ids });

  // The legacy SSRF-blocked `?ids=` http.fetch path must NOT be used.
  const idsFetches = fetchCalls.filter((c) => /\/issues\?ids=/.test(c.url));
  assert.equal(idsFetches.length, 0, `the legacy ?ids= http.fetch path must NOT fire; got ${idsFetches.length}`);
  // One fetcher invocation → per-ref get for each of the 5 unique ids.
  assert.equal(getCalls.length, 5, `expected 5 per-ref ctx.issues.get calls; got ${getCalls.length}`);
  for (const c of getCalls) assert.equal(c.companyId, 'company-1', 'companyId threaded into ctx.issues.get');
  assert.equal(result.length, 5);
  // The fetcher echoes the requested identifier as `id` so byId.get(ref) hits.
  assert.equal(result[0].id, 'BEAAA-1');
  assert.equal(result[0].url, '/issues/BEAAA-1');
  assert.notEqual(result[0].status, 'unknown', 'resolved to a real status (not the unknown placeholder)');
  // Excerpt forwarded from description (short body, no truncation).
  assert.equal(result[0].excerpt, 'Body of BEAAA-1');
});

test('registerResolveRefs handles empty input without making any resolution calls', async () => {
  const { ctx, fetchCalls, getCalls, registered } = makeFakeCtx();
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: [] });
  assert.deepEqual(result, []);
  assert.equal(fetchCalls.length, 0);
  assert.equal(getCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Plan 05-05 Task 2 (D-09) — descriptionExcerpt + ownerName extension
// ---------------------------------------------------------------------------

function makeAgentsFakeCtx({ agentsGetThrows = false, agentName = 'CEO Bot', body = 'first line\nsecond line\nthird' } = {}) {
  const fetchCalls = [];
  const getCalls = [];
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
    // Legacy SSRF path kept so a regression is caught.
    http: {
      async fetch(url) {
        fetchCalls.push(url);
        return { async json() { return []; } };
      },
    },
    // 07-01 — per-ref get. assigneeUserId drives the D-09 ownerName enrichment;
    // description drives the excerpt. A non-null get result is "readable".
    issues: {
      async get(issueId, companyId) {
        getCalls.push({ issueId, companyId });
        return {
          id: `uuid-${issueId}`,
          identifier: issueId,
          title: `Title ${issueId}`,
          status: 'in_progress',
          assigneeUserId: 'agent-uuid-001',
          description: body,
        };
      },
      async list() { return []; },
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
  return { ctx, fetchCalls, getCalls, agentsGetCalls, registered };
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

test('D-09 + PRIM-02 — descriptionExcerpt is null when the ref is unreadable (get returns null + no list match)', async () => {
  // 07-01 — the SDK Issue has no `_viewer_can_read`. The viewer gate is now the
  // SDK proxy itself: ctx.issues.get returns null for an issue the caller may
  // not read. An unresolvable ref falls through to reference-resolver's unknown
  // placeholder, whose excerpt + descriptionExcerpt are null.
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
    http: { async fetch(url) { fetchCalls.push(url); return { async json() { return []; } }; } },
    issues: {
      async get() { return null; }, // unreadable / not found
      async list() { return []; },  // fallback can't match either
    },
    agents: { async get() { return { id: 'agent-uuid-001', name: 'CEO Bot' }; } },
    logger: { warn() {} },
  };
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-99'] });
  assert.equal(result[0].descriptionExcerpt, null, 'PRIM-02 — excerpt null when the ref is unreadable');
  assert.equal(result[0].excerpt, null, 'legacy excerpt also null on the unknown placeholder');
  assert.equal(result[0].status, 'unknown', 'unresolvable ref is the unknown placeholder');
});

test('registerResolveRefs emits the unknown placeholder (excerpt=null) when a ref is unresolvable (PRIM-02 viewer-permission proxy via get-null)', async () => {
  const fetchCalls = [];
  const registered = new Map();
  const ctx = {
    issues: {
      async get() { return null; },
      async list() { return []; },
    },
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
    http: { async fetch(url) { fetchCalls.push(url); return { async json() { return []; } }; } },
  };
  registerResolveRefs(ctx);
  const handler = registered.get('resolve-refs');
  const result = await handler({ userId: 'eric', ids: ['BEAAA-7'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].excerpt, null, 'PRIM-02: excerpt null when the ref is unresolvable');
});
