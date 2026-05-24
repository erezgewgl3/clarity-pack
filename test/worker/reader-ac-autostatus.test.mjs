// test/worker/reader-ac-autostatus.test.mjs
//
// Plan 05-03 (DIST-03) — reader.ac.autostatus scanner tests.
//
// Pinned contracts:
//   1. Both regex grammars match the canonical forms (multiline + case-
//      insensitive on the state token).
//   2. Earliest-comment-wins per ac-id (sort comments ASC by createdAt
//      before scanning; later matches for the same id are ignored).
//   3. sourceAuthorName falls back to NULL when ctx.agents.get returns null
//      or throws — NEVER to the UUID. (NO_UUID_LEAK, same family as 04.2-06
//      D9.)
//   4. Opt-in-gate fires BEFORE any host read (no listComments call when
//      opted-out).
//   5. Missing-param shape: { error: '<KEY>_REQUIRED' } returned, not thrown.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerReaderAcAutostatus } from '../../src/worker/handlers/reader-ac-autostatus.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

function makeCtx({
  optedIn = true,
  comments = [],
  listCommentsThrows = false,
  agents = {},
  agentsGetThrows = false,
} = {}) {
  const handlers = new Map();
  const warnLogs = [];
  const listCommentsCalls = [];
  const agentsGetCalls = [];

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info() {},
    },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async listComments(issueId, companyId) {
        listCommentsCalls.push({ issueId, companyId });
        if (listCommentsThrows) throw new Error('host listComments 503');
        return comments;
      },
    },
    agents: {
      async get(agentId, companyId) {
        agentsGetCalls.push({ agentId, companyId });
        if (agentsGetThrows) throw new Error('host agents.get 503');
        return agents[agentId] ?? null;
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _warnLogs: warnLogs,
    _listCommentsCalls: listCommentsCalls,
    _agentsGetCalls: agentsGetCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function params(overrides = {}) {
  return {
    companyId: 'COU',
    userId: 'user-eric',
    issueId: 'COU-4242',
    ...overrides,
  };
}

// ---- REGISTER ---------------------------------------------------------------

test('reader.ac.autostatus: registers exactly the reader.ac.autostatus key', () => {
  const ctx = makeCtx();
  registerReaderAcAutostatus(ctx);
  assert.ok(ctx._handlers.has('reader.ac.autostatus'));
  assert.equal(ctx._handlers.size, 1);
});

// ---- OPT-IN-GATE ------------------------------------------------------------

test('reader.ac.autostatus: opted-out caller -> { error: OPT_IN_REQUIRED } before any listComments', async () => {
  const ctx = makeCtx({ optedIn: false, comments: [{ id: 'c1', body: 'AC: foo: ✓', createdAt: '2026-05-24T10:00:00Z' }] });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._listCommentsCalls.length, 0, 'gate fires before the host read');
});

// ---- MISSING PARAMS ---------------------------------------------------------

test('reader.ac.autostatus: missing issueId -> { error: ISSUE_ID_REQUIRED } (return, not throw)', async () => {
  const ctx = makeCtx();
  registerReaderAcAutostatus(ctx);
  const p = params();
  delete p.issueId;
  const result = await ctx._handlers.get('reader.ac.autostatus')(p);
  assert.equal(result.error, 'ISSUE_ID_REQUIRED');
});

// ---- CANONICAL GRAMMAR ------------------------------------------------------

test('reader.ac.autostatus: canonical "AC: <id>: ✓" matches; case variants on state work', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c1',
        body: 'AC: deploy: ✓\nAC: tests: done\nAC: docs: COMPLETE\nAC: deploy-2: x',
        createdAt: '2026-05-24T10:00:00Z',
        authorAgentId: null,
      },
    ],
  });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.kind, 'acAutoStatus');
  const ids = Object.keys(result.detections).sort();
  assert.deepEqual(ids, ['deploy', 'deploy-2', 'docs', 'tests']);
  // Every match is the same comment, no agent on it.
  for (const id of ids) {
    assert.equal(result.detections[id].detected, true);
    assert.equal(result.detections[id].sourceCommentId, 'c1');
    assert.equal(result.detections[id].sourceAuthorAgentId, null);
    assert.equal(result.detections[id].sourceAuthorName, null);
  }
});

// ---- BRACKET GRAMMAR --------------------------------------------------------

test('reader.ac.autostatus: bracket "AC[<id>]: <state>" matches the alternate form', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c1',
        body: 'AC[security-audit]: done\nAC[infra-99]: ✓',
        createdAt: '2026-05-24T10:00:00Z',
        authorAgentId: null,
      },
    ],
  });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  const ids = Object.keys(result.detections).sort();
  assert.deepEqual(ids, ['infra-99', 'security-audit']);
});

// ---- EARLIEST-COMMENT-WINS --------------------------------------------------

test('reader.ac.autostatus: earliest-comment-wins per ac-id (later matches ignored)', async () => {
  const ctx = makeCtx({
    comments: [
      { id: 'c-late', body: 'AC: foo: ✓', createdAt: '2026-05-24T15:00:00Z', authorAgentId: 'agent-late' },
      { id: 'c-early', body: 'AC: foo: done', createdAt: '2026-05-24T10:00:00Z', authorAgentId: 'agent-early' },
      { id: 'c-middle', body: 'AC: foo: complete', createdAt: '2026-05-24T12:00:00Z', authorAgentId: 'agent-middle' },
    ],
    agents: {
      'agent-early': { id: 'agent-early', name: 'EarlyAgent' },
      'agent-middle': { id: 'agent-middle', name: 'MiddleAgent' },
      'agent-late': { id: 'agent-late', name: 'LateAgent' },
    },
  });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.detections.foo.sourceCommentId, 'c-early');
  assert.equal(result.detections.foo.sourceAuthorAgentId, 'agent-early');
  assert.equal(result.detections.foo.sourceAuthorName, 'EarlyAgent');
  assert.equal(result.detections.foo.sourceCreatedAt, '2026-05-24T10:00:00Z');
});

// ---- NO_UUID_LEAK: degrade to null on agents.get failure --------------------

test('reader.ac.autostatus: sourceAuthorName falls back to NULL when agents.get returns null (NEVER to UUID)', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c1',
        body: 'AC: feat-x: done',
        createdAt: '2026-05-24T10:00:00Z',
        authorAgentId: '618ebd0d-4d39-45f4-8380-3b30b205d02d',
      },
    ],
    agents: {}, // ctx.agents.get returns null for any agentId
  });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.detections['feat-x'].sourceAuthorAgentId, '618ebd0d-4d39-45f4-8380-3b30b205d02d');
  assert.strictEqual(result.detections['feat-x'].sourceAuthorName, null,
    'sourceAuthorName must be null when the lookup degrades (NO_UUID_LEAK — NEVER fall back to the UUID)');
});

test('reader.ac.autostatus: sourceAuthorName falls back to NULL when agents.get throws (NEVER to UUID)', async () => {
  const ctx = makeCtx({
    comments: [
      {
        id: 'c1',
        body: 'AC: feat-y: ✓',
        createdAt: '2026-05-24T10:00:00Z',
        authorAgentId: 'agent-throws',
      },
    ],
    agentsGetThrows: true,
  });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.detections['feat-y'].sourceAuthorAgentId, 'agent-throws');
  assert.strictEqual(result.detections['feat-y'].sourceAuthorName, null);
  // Warn-logged so an operator can debug the silent degrade.
  assert.ok(ctx._warnLogs.some((l) => /agents\.get failed/i.test(l.msg)));
});

// ---- AGENT-NAME RESOLUTION CACHE -------------------------------------------

test('reader.ac.autostatus: agents.get is cached per distinct authorAgentId (no N+1 storm)', async () => {
  // Three matches across two comments, same author on both.
  const ctx = makeCtx({
    comments: [
      {
        id: 'c1',
        body: 'AC: a: ✓\nAC: b: done',
        createdAt: '2026-05-24T10:00:00Z',
        authorAgentId: 'agent-cmo',
      },
      {
        id: 'c2',
        body: 'AC: c: complete',
        createdAt: '2026-05-24T11:00:00Z',
        authorAgentId: 'agent-cmo', // same author
      },
    ],
    agents: { 'agent-cmo': { id: 'agent-cmo', name: 'CMO' } },
  });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  for (const id of ['a', 'b', 'c']) {
    assert.equal(result.detections[id].sourceAuthorName, 'CMO');
  }
  assert.equal(
    ctx._agentsGetCalls.length,
    1,
    'ctx.agents.get must be cached per distinct agentId — exactly one call for one distinct author',
  );
});

// ---- LIST FAILS -------------------------------------------------------------

test('reader.ac.autostatus: listComments throws -> { error: LIST_COMMENTS_FAILED } + warn-log', async () => {
  const ctx = makeCtx({ listCommentsThrows: true });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.error, 'LIST_COMMENTS_FAILED');
  assert.ok(ctx._warnLogs.some((l) => /listComments failed/i.test(l.msg)));
});

// ---- EMPTY THREAD -----------------------------------------------------------

test('reader.ac.autostatus: empty thread -> { kind: acAutoStatus, detections: {} }', async () => {
  const ctx = makeCtx({ comments: [] });
  registerReaderAcAutostatus(ctx);
  const result = await ctx._handlers.get('reader.ac.autostatus')(params());
  assert.equal(result.kind, 'acAutoStatus');
  assert.deepEqual(result.detections, {});
});

// ---- export shape -----------------------------------------------------------

test('registerReaderAcAutostatus is exported as a function', async () => {
  const mod = await import('../../src/worker/handlers/reader-ac-autostatus.ts');
  assert.equal(typeof mod.registerReaderAcAutostatus, 'function');
});
