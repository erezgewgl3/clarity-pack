// test/worker/db/chat-message-attachments-repo.test.mjs
//
// Plan 05-11 Task 1 -- repo helpers for chat_message_attachments
// (migration 0011). Mirrors the chat-topics-repo-pinned.test.mjs shape:
// wrapHostFaithfulDb decorates the fake so a SELECT-via-execute or a
// write-via-query throws exactly as the live host would.
//
// Tests cover all four helpers:
//
//   - insertChatMessageAttachment       — INSERT + readback (one execute + one query)
//   - listChatMessageAttachmentsForTopic — SELECT WHERE company + topic ORDER created_at DESC LIMIT $3
//   - listChatMessageAttachmentsForMessage — SELECT WHERE company + chat_message_id ORDER created_at ASC
//   - sumChatMessageAttachmentBytesByMessage — SELECT COALESCE(SUM(byte_size),0) AS sum_bytes

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  insertChatMessageAttachment,
  listChatMessageAttachmentsForTopic,
  listChatMessageAttachmentsForMessage,
  sumChatMessageAttachmentBytesByMessage,
} from '../../../src/worker/db/chat-topics-repo.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeFakeDbCtx({
  topicRows = [],
  messageRows = [],
  sumRows = null,
  readbackRow = null,
} = {}) {
  const calls = [];
  const fake = {
    async execute(sql, params) {
      calls.push({ kind: 'execute', sql, params });
      return { rowCount: 1 };
    },
    async query(sql, params) {
      calls.push({ kind: 'query', sql, params });
      // sumChatMessageAttachmentBytesByMessage probe (the COALESCE(SUM(...)) row).
      if (/COALESCE\s*\(\s*SUM\s*\(\s*byte_size\s*\)/i.test(sql)) {
        return sumRows ?? [{ sum_bytes: 0 }];
      }
      // listChatMessageAttachmentsForTopic probe -- ORDER BY created_at DESC + LIMIT $3.
      if (
        /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments[\s\S]*ORDER\s+BY\s+created_at\s+DESC[\s\S]*LIMIT\s+\$3/i.test(
          sql,
        )
      ) {
        return topicRows;
      }
      // listChatMessageAttachmentsForMessage probe -- ORDER BY created_at ASC, no LIMIT.
      if (
        /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments[\s\S]*ORDER\s+BY\s+created_at\s+ASC/i.test(
          sql,
        )
      ) {
        return messageRows;
      }
      // Readback after insert -- WHERE id = $1 AND company_id = $2 LIMIT 1.
      if (
        /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments[\s\S]*WHERE\s+id\s*=\s*\$1[\s\S]*LIMIT\s+1/i.test(
          sql,
        )
      ) {
        return readbackRow ? [readbackRow] : [];
      }
      return [];
    },
  };
  return { db: wrapHostFaithfulDb(fake), _calls: calls };
}

function makeRow(overrides = {}) {
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

// ---- R1 -- insertChatMessageAttachment issues an INSERT then a SELECT readback.

test('R1: insertChatMessageAttachment INSERTs into the plugin-namespace table', async () => {
  const row = makeRow();
  const ctx = makeFakeDbCtx({ readbackRow: row });
  const out = await insertChatMessageAttachment(ctx, row);
  const inserts = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(inserts.length, 1, 'one execute call');
  const w = inserts[0];
  assert.match(
    w.sql,
    /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i,
    'inserts into plugin-namespace chat_message_attachments',
  );
  assert.deepEqual(w.params, [
    row.id,
    row.company_id,
    row.topic_issue_id,
    row.chat_message_id,
    row.comment_id,
    row.document_key,
    row.mime_type,
    row.original_filename,
    row.byte_size,
    row.created_at,
  ]);
  // Readback returns the row.
  assert.deepEqual(out, row);
});

// ---- R2 -- insertChatMessageAttachment readback when SELECT returns nothing falls
//          back to the input row (defense-in-depth -- matches insertChatMessage shape).

test('R2: insertChatMessageAttachment falls back to input row when readback returns no row', async () => {
  const row = makeRow({ id: 'att-2' });
  const ctx = makeFakeDbCtx({ readbackRow: null });
  const out = await insertChatMessageAttachment(ctx, row);
  assert.deepEqual(out, row);
});

// ---- R3 -- listChatMessageAttachmentsForTopic SELECT shape + params.

test('R3: listChatMessageAttachmentsForTopic SELECT ORDER BY DESC + LIMIT', async () => {
  const rows = [makeRow({ id: 'a-1' }), makeRow({ id: 'a-2' })];
  const ctx = makeFakeDbCtx({ topicRows: rows });
  const out = await listChatMessageAttachmentsForTopic(ctx, 'co-1', 'issue-topic-1', 5);
  const queries = ctx._calls.filter((c) => c.kind === 'query');
  assert.equal(queries.length, 1, 'one query call');
  const q = queries[0];
  assert.match(
    q.sql,
    /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i,
    'reads plugin-namespace chat_message_attachments',
  );
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+topic_issue_id\s*=\s*\$2/i,
    'WHERE company_id + topic_issue_id',
  );
  assert.match(q.sql, /ORDER\s+BY\s+created_at\s+DESC/i, 'newest-first');
  assert.match(q.sql, /LIMIT\s+\$3/i, 'limit $3 placeholder');
  assert.deepEqual(q.params, ['co-1', 'issue-topic-1', 5]);
  assert.deepEqual(out, rows);
});

// ---- R4 -- listChatMessageAttachmentsForMessage SELECT shape + params (ASC).

test('R4: listChatMessageAttachmentsForMessage SELECT ORDER BY ASC, no LIMIT', async () => {
  const rows = [makeRow({ id: 'a-1' }), makeRow({ id: 'a-2' })];
  const ctx = makeFakeDbCtx({ messageRows: rows });
  const out = await listChatMessageAttachmentsForMessage(ctx, 'co-1', 'msg-uuid-1');
  const queries = ctx._calls.filter((c) => c.kind === 'query');
  assert.equal(queries.length, 1);
  const q = queries[0];
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+chat_message_id\s*=\s*\$2/i,
    'WHERE company_id + chat_message_id',
  );
  assert.match(q.sql, /ORDER\s+BY\s+created_at\s+ASC/i, 'upload-order ASC');
  assert.deepEqual(q.params, ['co-1', 'msg-uuid-1']);
  assert.deepEqual(out, rows);
});

// ---- R5 -- sumChatMessageAttachmentBytesByMessage COALESCE + Number() coerce.

test('R5: sumChatMessageAttachmentBytesByMessage returns COALESCE-summed bytes as number', async () => {
  const ctx = makeFakeDbCtx({ sumRows: [{ sum_bytes: 5000 }] });
  const out = await sumChatMessageAttachmentBytesByMessage(ctx, 'co-1', 'msg-uuid-1');
  const queries = ctx._calls.filter((c) => c.kind === 'query');
  assert.equal(queries.length, 1);
  const q = queries[0];
  assert.match(
    q.sql,
    /COALESCE\s*\(\s*SUM\s*\(\s*byte_size\s*\)\s*,\s*0\s*\)\s+AS\s+sum_bytes/i,
    'COALESCE(SUM(byte_size), 0) AS sum_bytes',
  );
  assert.match(
    q.sql,
    /WHERE\s+company_id\s*=\s*\$1\s+AND\s+chat_message_id\s*=\s*\$2/i,
    'WHERE company_id + chat_message_id',
  );
  assert.deepEqual(q.params, ['co-1', 'msg-uuid-1']);
  assert.equal(out, 5000);
});

// ---- R6 -- bigint-as-string coerce (node-postgres returns SUM(bigint) as string).

test('R6: sumChatMessageAttachmentBytesByMessage coerces string sum_bytes to number', async () => {
  // node-postgres returns SUM over a bigint column as a STRING.
  const ctx = makeFakeDbCtx({ sumRows: [{ sum_bytes: '12345' }] });
  const out = await sumChatMessageAttachmentBytesByMessage(ctx, 'co-1', 'msg-uuid-1');
  assert.equal(typeof out, 'number');
  assert.equal(out, 12345);
});

// ---- R7 -- empty topic returns 0, no row in result set.

test('R7: sumChatMessageAttachmentBytesByMessage returns 0 when query returns no rows', async () => {
  const ctx = makeFakeDbCtx({ sumRows: [] });
  const out = await sumChatMessageAttachmentBytesByMessage(ctx, 'co-1', 'msg-uuid-empty');
  assert.equal(out, 0);
});

// ---- R8 -- empty topic listing returns [].

test('R8: listChatMessageAttachmentsForTopic returns [] when topic has no attachments', async () => {
  const ctx = makeFakeDbCtx({ topicRows: [] });
  const out = await listChatMessageAttachmentsForTopic(ctx, 'co-1', 'issue-empty', 5);
  assert.deepEqual(out, []);
});
