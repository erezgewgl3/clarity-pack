// test/worker/handlers/chat-attachment-list.test.mjs
//
// Plan 05-11 Task 2 -- chat.attachment.list DATA handler (CHAT-07 gap closure).
//
// Mirrors test/worker/handlers/chat-topic-pin.test.mjs harness shape.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatAttachmentList } from '../../../src/worker/handlers/chat-attachment-list.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeAttachmentRow(overrides = {}) {
  return {
    id: 'att-1',
    company_id: 'co-1',
    topic_issue_id: 'issue-topic-1',
    chat_message_id: 'msg-uuid-1',
    comment_id: null,
    document_key: 'chat-attach-msg-uuid-1-sample.pdf',
    mime_type: 'application/pdf',
    original_filename: 'sample.pdf',
    byte_size: 2048,
    created_at: '2026-05-26T18:00:00.000Z',
    ...overrides,
  };
}

function makeCtx({
  optedIn = true,
  attachments = [],
  selectThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  const issueUpdateCalls = [];

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
    // Spy in case a future regression accidentally adds ctx.issues.update.
    issues: {
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
    },
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (
          /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(sql)
        ) {
          if (selectThrows) throw new Error('host db.query 503');
          // Honour the limit param ($3) like the real DB would.
          const limit = params?.[2];
          if (typeof limit === 'number') {
            return attachments.slice(0, limit);
          }
          return attachments;
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _calls: calls,
    _warnLogs: warnLogs,
    _issueUpdateCalls: issueUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function listParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    limit: 5,
    ...overrides,
  };
}

// ---- Test 1 -- opted-out caller -> OPT_IN_REQUIRED ----------------------

test('chat.attachment.list: opted-out caller returns OPT_IN_REQUIRED, no body call', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams());
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  // The opt-in-guard returns BEFORE the attachments SELECT. The only
  // db.query call should be the clarity_user_prefs lookup.
  const attachmentSelects = ctx._calls.filter(
    (c) => c.kind === 'query' && /chat_message_attachments/i.test(c.sql),
  );
  assert.equal(attachmentSelects.length, 0);
});

// ---- Test 2 -- missing companyId returns structured error --------------

test('chat.attachment.list: missing companyId -> COMPANY_ID_REQUIRED', async () => {
  const ctx = makeCtx();
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams({ companyId: undefined }));
  assert.deepEqual(result, { error: 'COMPANY_ID_REQUIRED' });
});

// ---- Test 3 -- missing topicIssueId returns structured error -----------

test('chat.attachment.list: missing topicIssueId -> TOPIC_ISSUE_ID_REQUIRED', async () => {
  const ctx = makeCtx();
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams({ topicIssueId: undefined }));
  assert.deepEqual(result, { error: 'TOPIC_ISSUE_ID_REQUIRED' });
});

// ---- Test 4 -- happy path with limit=5 returns last 5 newest-first ------

test('chat.attachment.list: happy path returns last N attachments as camelCase entries', async () => {
  const rows = [
    makeAttachmentRow({ id: 'a-newest', created_at: '2026-05-26T18:05:00.000Z' }),
    makeAttachmentRow({ id: 'a-mid', created_at: '2026-05-26T18:03:00.000Z' }),
    makeAttachmentRow({ id: 'a-oldest', created_at: '2026-05-26T18:00:00.000Z' }),
  ];
  const ctx = makeCtx({ attachments: rows });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams({ limit: 5 }));
  assert.equal(result.kind, 'attachments');
  assert.equal(result.topicIssueId, 'issue-topic-1');
  assert.equal(result.attachments.length, 3);
  // camelCase keys present, snake_case absent.
  const first = result.attachments[0];
  assert.equal(first.id, 'a-newest');
  assert.equal(first.chatMessageId, 'msg-uuid-1');
  assert.equal(first.documentKey, 'chat-attach-msg-uuid-1-sample.pdf');
  assert.equal(first.mimeType, 'application/pdf');
  assert.equal(first.originalFilename, 'sample.pdf');
  assert.equal(first.byteSize, 2048);
  assert.equal(first.commentId, null);
  assert.equal(first.createdAt, '2026-05-26T18:05:00.000Z');
});

// ---- Test 5 -- empty topic returns kind=attachments with empty list ----

test('chat.attachment.list: empty topic returns { kind, topicIssueId, attachments: [] }', async () => {
  const ctx = makeCtx({ attachments: [] });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams());
  assert.deepEqual(result, {
    kind: 'attachments',
    topicIssueId: 'issue-topic-1',
    attachments: [],
  });
});

// ---- Test 6 -- default limit is 5 -------------------------------------

test('chat.attachment.list: default limit (no param) is 5', async () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    makeAttachmentRow({ id: `a-${i}` }),
  );
  const ctx = makeCtx({ attachments: rows });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams({ limit: undefined }));
  // The fake honors the LIMIT $3 param; default of 5 yields 5 rows.
  assert.equal(result.attachments.length, 5);
  // Verify the SELECT was issued with limit=5 in the params.
  const select = ctx._calls.find(
    (c) => c.kind === 'query' && /chat_message_attachments/i.test(c.sql),
  );
  assert.equal(select.params[2], 5);
});

// ---- Test 7 -- limit clamped to MAX_LIST_LIMIT = 100 -------------------

test('chat.attachment.list: limit clamps to MAX_LIST_LIMIT=100', async () => {
  const ctx = makeCtx({ attachments: [] });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  await handler(listParams({ limit: 9999 }));
  const select = ctx._calls.find(
    (c) => c.kind === 'query' && /chat_message_attachments/i.test(c.sql),
  );
  assert.equal(select.params[2], 100, 'limit clamped to 100');
});

// ---- Test 8 -- explicit limit honored when below cap -------------------

test('chat.attachment.list: explicit limit:50 is honored', async () => {
  const ctx = makeCtx({ attachments: [] });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  await handler(listParams({ limit: 50 }));
  const select = ctx._calls.find(
    (c) => c.kind === 'query' && /chat_message_attachments/i.test(c.sql),
  );
  assert.equal(select.params[2], 50);
});

// ---- Test 9 -- repo SELECT failure returns ATTACHMENTS_FAILED + warn ---

test('chat.attachment.list: SELECT failure returns ATTACHMENTS_FAILED + warn-log', async () => {
  const ctx = makeCtx({ selectThrows: true });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  const result = await handler(listParams());
  assert.deepEqual(result, { error: 'ATTACHMENTS_FAILED' });
  assert.ok(
    ctx._warnLogs.some((w) => /SELECT failed/i.test(w.msg)),
    'warn log fires',
  );
});

// ---- Test 10 -- CTT-07 invariant: ctx.issues.update never called -------

test('chat.attachment.list: CTT-07 invariant -- zero ctx.issues.update calls across all paths', async () => {
  const ctx = makeCtx({
    attachments: [makeAttachmentRow()],
  });
  registerChatAttachmentList(ctx);
  const handler = ctx._handlers.get('chat.attachment.list');
  await handler(listParams()); // happy
  await handler(listParams({ companyId: undefined })); // error: COMPANY_ID_REQUIRED
  await handler(listParams({ topicIssueId: undefined })); // error: TOPIC_ISSUE_ID_REQUIRED
  await handler(listParams({ limit: 9999 })); // happy with clamp
  assert.equal(
    ctx._issueUpdateCalls.length,
    0,
    'CTT-07 invariant: ctx.issues.update never called',
  );
});
