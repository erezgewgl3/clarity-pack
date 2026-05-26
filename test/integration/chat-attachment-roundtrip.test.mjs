// test/integration/chat-attachment-roundtrip.test.mjs
//
// Plan 05-11 Task 9 -- end-to-end round-trip integration test.
//
// Exercises BOTH new handlers (chat.attachment.upload + chat.attachment.list)
// against a single shared fake harness that models:
//
//   - opted-in user (clarity_user_prefs row);
//   - one chat_topics row;
//   - one chat_messages row already committed (simulating the post-chat.send
//     state under Option B upload-on-send semantics);
//   - an in-memory issue_documents store (ctx.issues.documents.upsert
//     writes; ctx.issues.documents.list reads) PLUS an in-memory
//     chat_message_attachments table.
//
// Round-trip:
//   1. seed (opt-in + chat_topics row + chat_messages row).
//   2. chat.attachment.upload for a 2 KB sample.md -> { ok }.
//   3. chat.attachment.list returns 1 attachment with matching documentKey.
//   4. ctx.issues.documents.list returns the SAME documentKey (Reader auto-sync
//      proof -- both stores read the same row because they ARE the same row).
//   5. CTT-07: ctx.issues.update callCount === 0 across the entire test.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatAttachmentUpload } from '../../src/worker/handlers/chat-attachment-upload.ts';
import { registerChatAttachmentList } from '../../src/worker/handlers/chat-attachment-list.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

// ---- Synthetic but realistic harness ----------------------------------

function makeHarness({ optedIn = true } = {}) {
  const handlers = new Map();
  const issueUpdateCalls = [];
  // In-memory chat_message_attachments table.
  const attachmentRows = [];
  // In-memory issue_documents store -- the cross-store invariant for the
  // Reader auto-sync proof.
  const issueDocuments = new Map(); // key: `${issueId}::${docKey}`
  const calls = [];

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
      documents: {
        async upsert({ issueId, key, body, companyId, title, format, changeSummary }) {
          const stored = {
            id: `doc-${key}`,
            issueId,
            key,
            body,
            companyId,
            title: title ?? null,
            format: format ?? null,
            changeSummary: changeSummary ?? null,
            updatedAt: new Date().toISOString(),
          };
          issueDocuments.set(`${issueId}::${key}`, stored);
          return stored;
        },
        async list(issueId, companyId) {
          const out = [];
          for (const [k, v] of issueDocuments) {
            if (v.issueId === issueId && v.companyId === companyId) {
              out.push({
                id: v.id,
                key: v.key,
                title: v.title,
                format: v.format,
                updatedAt: v.updatedAt,
              });
            }
            void k;
          }
          return out;
        },
        async get(issueId, key, companyId) {
          return issueDocuments.get(`${issueId}::${key}`) ?? null;
        },
        async delete(issueId, key, companyId) {
          issueDocuments.delete(`${issueId}::${key}`);
        },
      },
    },
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/COALESCE\s*\(\s*SUM\s*\(\s*byte_size\s*\)/i.test(sql)) {
          const [, chatMessageId] = params;
          const sum = attachmentRows
            .filter((r) => r.chat_message_id === chatMessageId)
            .reduce((acc, r) => acc + Number(r.byte_size), 0);
          return [{ sum_bytes: sum }];
        }
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(sql)) {
          // Readback after insert -> WHERE id = $1 AND company_id = $2
          if (/WHERE\s+id\s*=\s*\$1[\s\S]*LIMIT\s+1/i.test(sql)) {
            const [id, companyId] = params;
            const row = attachmentRows.find(
              (r) => r.id === id && r.company_id === companyId,
            );
            return row ? [row] : [];
          }
          // listChatMessageAttachmentsForTopic -- WHERE company_id, topic_issue_id, LIMIT $3
          if (
            /WHERE\s+company_id\s*=\s*\$1\s+AND\s+topic_issue_id\s*=\s*\$2[\s\S]*?ORDER\s+BY\s+created_at\s+DESC[\s\S]*?LIMIT\s+\$3/i.test(
              sql,
            )
          ) {
            const [companyId, topicIssueId, limit] = params;
            const matched = attachmentRows.filter(
              (r) =>
                r.company_id === companyId && r.topic_issue_id === topicIssueId,
            );
            matched.sort(
              (a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            );
            return matched.slice(0, typeof limit === 'number' ? limit : matched.length);
          }
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        if (
          /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(sql)
        ) {
          attachmentRows.push({
            id: params[0],
            company_id: params[1],
            topic_issue_id: params[2],
            chat_message_id: params[3],
            comment_id: params[4],
            document_key: params[5],
            mime_type: params[6],
            original_filename: params[7],
            byte_size: params[8],
            created_at: params[9],
          });
        }
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _attachmentRows: attachmentRows,
    _issueDocuments: issueDocuments,
    _issueUpdateCalls: issueUpdateCalls,
    _calls: calls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

// Build a base64 payload that satisfies the md-text mime-sniff:
// "# Hello\n\nThis is a 2 KB markdown file padded with ascii ...".
function sample2KbMarkdown() {
  const header = '# Hello\n\nThis is a 2 KB markdown file used for the\nPlan 05-11 round-trip integration test.\n\n';
  // Pad with printable ASCII to ~2 KB.
  const pad = 'lorem ipsum dolor sit amet '.repeat(80);
  return Buffer.from(header + pad, 'utf-8').toString('base64');
}

// ---- The round-trip ---------------------------------------------------

test('Plan 05-11 round-trip: upload sample.md -> list returns 1 -> issue_documents has same key', async () => {
  const ctx = makeHarness();
  registerChatAttachmentUpload(ctx);
  registerChatAttachmentList(ctx);

  const uploadHandler = ctx._handlers.get('chat.attachment.upload');
  const listHandler = ctx._handlers.get('chat.attachment.list');
  assert.ok(uploadHandler, 'upload handler registered');
  assert.ok(listHandler, 'list handler registered');

  // 1. upload a 2 KB sample.md.
  const uploadResult = await uploadHandler({
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    chatMessageId: 'msg-uuid-1',
    originalFilename: 'sample.md',
    mimeType: 'text/markdown',
    body: sample2KbMarkdown(),
  });
  assert.equal(uploadResult.ok, true, 'upload returns ok');
  assert.equal(uploadResult.mimeType, 'text/markdown');
  assert.ok(uploadResult.byteSize > 1900 && uploadResult.byteSize < 3000);
  const documentKey = uploadResult.documentKey;
  // Hotfix 2026-05-26: document_key is UUID-only (no filename component).
  // The original filename `sample.md` is preserved on documents.title (host)
  // and chat_message_attachments.original_filename (plugin namespace).
  assert.match(
    documentKey,
    /^chat-attach-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'documentKey is `chat-attach-<uuid>` (host-validator-safe)',
  );
  assert.equal(
    documentKey,
    `chat-attach-${uploadResult.attachmentId}`,
    'documentKey embeds attachmentId',
  );

  // 2. chat.attachment.list returns 1 attachment with matching documentKey.
  const listResult = await listHandler({
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    limit: 5,
  });
  assert.equal(listResult.kind, 'attachments');
  assert.equal(listResult.attachments.length, 1, 'one attachment after one upload');
  assert.equal(listResult.attachments[0].documentKey, documentKey);
  assert.equal(listResult.attachments[0].originalFilename, 'sample.md');
  assert.equal(listResult.attachments[0].mimeType, 'text/markdown');

  // 3. ctx.issues.documents.list returns the SAME documentKey -- Reader
  //    auto-sync proof (both stores read the same row because they ARE
  //    the same row).
  const documentList = await ctx.issues.documents.list(
    'issue-topic-1',
    'co-1',
  );
  assert.equal(documentList.length, 1, 'one document on the issue');
  assert.equal(documentList[0].key, documentKey);
  // Hotfix 2026-05-26: original filename lives on documents.title (host).
  // The plugin namespace also keeps it on chat_message_attachments.
  // .original_filename (asserted on listResult above) -- belt-and-braces.
  assert.equal(
    documentList[0].title,
    'sample.md',
    'original filename preserved on documents.title (host side)',
  );

  // 4. CTT-07: ctx.issues.update callCount === 0 across the entire test.
  assert.equal(
    ctx._issueUpdateCalls.length,
    0,
    'CTT-07 invariant: ctx.issues.update never called across the round-trip',
  );
});

test('Plan 05-11 round-trip: opted-out caller cannot upload OR list', async () => {
  const ctx = makeHarness({ optedIn: false });
  registerChatAttachmentUpload(ctx);
  registerChatAttachmentList(ctx);

  const uploadHandler = ctx._handlers.get('chat.attachment.upload');
  const listHandler = ctx._handlers.get('chat.attachment.list');

  const upload = await uploadHandler({
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    chatMessageId: 'msg-uuid-1',
    originalFilename: 'sample.md',
    mimeType: 'text/markdown',
    body: sample2KbMarkdown(),
  });
  assert.deepEqual(upload, { error: 'OPT_IN_REQUIRED' });

  const list = await listHandler({
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    limit: 5,
  });
  assert.deepEqual(list, { error: 'OPT_IN_REQUIRED' });

  // The opt-in-guard returns BEFORE any host call -- the issue_documents
  // store stays empty.
  assert.equal(ctx._issueDocuments.size, 0);
  assert.equal(ctx._issueUpdateCalls.length, 0);
});
