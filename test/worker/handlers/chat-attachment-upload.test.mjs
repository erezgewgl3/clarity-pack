// test/worker/handlers/chat-attachment-upload.test.mjs
//
// Plan 05-11 Task 3 -- chat.attachment.upload ACTION handler (CHAT-07 gap closure).
//
// Behaviors:
//   1. opt-in-guard rejects opted-out callers BEFORE the body.
//   2. param-validation: missing required string params THROW.
//   3. per-file FILE_TOO_LARGE rejection (>10 MB).
//   4. per-message MESSAGE_TOO_LARGE rejection (existing sum + new > 50 MB).
//   5. mime-sniff happy paths: pdf / png / xlsx / md.
//   6. mime-sniff mismatch: pdf-extension + zip header; png-extension +
//      jpeg header; md-extension + binary (NUL) content.
//   7. MIME_NOT_ALLOWED: extension outside the allowlist BEFORE any host
//      call.
//   8. happy path: pdf returns { ok, attachmentId, documentKey, mimeType,
//      byteSize }; one documents.upsert + one insertChatMessageAttachment.
//   9. host upsert failure -> UPLOAD_FAILED + insertChatMessageAttachment
//      NOT called.
//  10. CTT-07 runtime spy: ctx.issues.update callCount === 0 across every
//      code path (happy + every error branch).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatAttachmentUpload } from '../../../src/worker/handlers/chat-attachment-upload.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

// ---- Magic-number test fixtures ----------------------------------------

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function pad(magic, totalLen) {
  // Pad the magic bytes to a chosen total length with NUL bytes (binary
  // formats are full of NULs; markdown is not).
  const out = Buffer.alloc(totalLen, 0x00);
  magic.copy(out, 0);
  return out;
}

function makePdfBytes(len = 1024) {
  return pad(PDF_MAGIC, len);
}
function makePngBytes(len = 1024) {
  return pad(PNG_MAGIC, len);
}
function makeXlsxBytes(len = 1024) {
  return pad(ZIP_MAGIC, len);
}
function makeMdBytes() {
  return Buffer.from('# Hello\n\nThis is a test markdown file.\n', 'utf-8');
}
function makeJpegBytes(len = 1024) {
  return pad(JPEG_MAGIC, len);
}

function asBase64(buf) {
  return buf.toString('base64');
}

// ---- Harness ----------------------------------------------------------

function makeCtx({
  optedIn = true,
  existingByteSum = 0,
  upsertThrows = false,
  insertThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const warnLogs = [];
  // CTT-07 runtime spy.
  const issueUpdateCalls = [];
  const documentUpsertCalls = [];
  const documentDeleteCalls = [];

  const ctx = {
    logger: {
      warn(msg, fields) {
        warnLogs.push({ msg, fields });
      },
      info() {},
    },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      // CTT-07 spy -- must remain at zero across every test path.
      async update(issueId, patch, companyId) {
        issueUpdateCalls.push({ issueId, patch, companyId });
        return { id: issueId, ...patch };
      },
      documents: {
        async upsert(input) {
          documentUpsertCalls.push(input);
          if (upsertThrows) throw new Error('host documents.upsert 503');
          return {
            id: 'doc-' + input.key,
            key: input.key,
            body: input.body,
            issueId: input.issueId,
          };
        },
        async delete(issueId, key, companyId) {
          documentDeleteCalls.push({ issueId, key, companyId });
        },
        async list() {
          return [];
        },
        async get() {
          return null;
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
          return [{ sum_bytes: existingByteSum }];
        }
        // Readback after insertChatMessageAttachment. Hotfix 2026-05-26:
        // document_key is UUID-only (chat-attach-<uuid>); the inserted id
        // (params[0]) IS the UUID, so we echo it into document_key.
        if (
          /FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments[\s\S]*WHERE\s+id\s*=\s*\$1/i.test(
            sql,
          )
        ) {
          return [
            {
              id: params[0],
              company_id: 'co-1',
              topic_issue_id: 'issue-topic-1',
              chat_message_id: 'msg-uuid-1',
              comment_id: null,
              document_key: `chat-attach-${params[0]}`,
              mime_type: 'application/pdf',
              original_filename: 'sample.pdf',
              byte_size: 1024,
              created_at: '2026-05-26T18:00:00.000Z',
            },
          ];
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(sql)) {
          if (insertThrows) throw new Error('host db.execute 503');
        }
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _calls: calls,
    _warnLogs: warnLogs,
    _issueUpdateCalls: issueUpdateCalls,
    _documentUpsertCalls: documentUpsertCalls,
    _documentDeleteCalls: documentDeleteCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function uploadParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    chatMessageId: 'msg-uuid-1',
    originalFilename: 'sample.pdf',
    mimeType: 'application/pdf',
    body: asBase64(makePdfBytes(1024)),
    ...overrides,
  };
}

// ---- Test 1 -- opt-in gate -------------------------------------------

test('chat.attachment.upload: opted-out caller -> OPT_IN_REQUIRED, no host call', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(uploadParams());
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(ctx._documentUpsertCalls.length, 0, 'no documents.upsert');
});

// ---- Test 2 -- param validation throws -------------------------------

test('chat.attachment.upload: missing companyId throws', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  await assert.rejects(
    () => handler(uploadParams({ companyId: undefined })),
    /companyId required/,
  );
});

test('chat.attachment.upload: missing chatMessageId throws', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  await assert.rejects(
    () => handler(uploadParams({ chatMessageId: undefined })),
    /chatMessageId required/,
  );
});

test('chat.attachment.upload: missing originalFilename throws', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  await assert.rejects(
    () => handler(uploadParams({ originalFilename: undefined })),
    /originalFilename required/,
  );
});

test('chat.attachment.upload: missing body throws', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  await assert.rejects(
    () => handler(uploadParams({ body: undefined })),
    /body required/,
  );
});

// ---- Test 3 -- FILE_TOO_LARGE (>10 MB) -------------------------------

test('chat.attachment.upload: file >10 MB -> FILE_TOO_LARGE BEFORE host call', async () => {
  // 10 MB + 1 byte.
  const big = pad(PDF_MAGIC, 10_485_761);
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({ body: asBase64(big) }),
  );
  assert.equal(result.error, 'FILE_TOO_LARGE');
  assert.equal(result.limitBytes, 10_485_760);
  assert.equal(result.actualBytes, 10_485_761);
  assert.equal(ctx._documentUpsertCalls.length, 0);
});

// ---- Test 4 -- MESSAGE_TOO_LARGE -------------------------------------

test('chat.attachment.upload: existing 40 MB + new 11 MB -> MESSAGE_TOO_LARGE', async () => {
  // existing 50 MB - 1 byte already on the message; new 1 byte tips it over.
  // Use a small new attachment to keep the per-file guard out of the way.
  const ctx = makeCtx({ existingByteSum: 52_428_800 });
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(uploadParams());
  assert.equal(result.error, 'MESSAGE_TOO_LARGE');
  assert.equal(result.limitBytes, 52_428_800);
  assert.equal(ctx._documentUpsertCalls.length, 0);
});

// ---- Test 5 -- mime-sniff happy paths --------------------------------

test('chat.attachment.upload: happy path -- pdf passes sniff + upserts + inserts', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(uploadParams());
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.byteSize, 1024);
  // Hotfix 2026-05-26: document_key is UUID-only (no filename component).
  // Format: `chat-attach-<uuid v4>` -- lowercase hex + hyphens only.
  assert.match(
    result.documentKey,
    /^chat-attach-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'documentKey is `chat-attach-<uuid>` (UUID-only, host-validator-safe)',
  );
  // attachmentId is the SAME UUID that the key embeds.
  assert.equal(
    result.documentKey,
    `chat-attach-${result.attachmentId}`,
    'documentKey embeds attachmentId verbatim',
  );
  // Host validator regression guard: the generated key MUST contain only
  // lowercase letters + digits + hyphens (no dots, underscores, uppercase).
  // This matches Paperclip's accepted pattern (`compile-result` style); the
  // previous filename-bearing key tripped "Invalid document key" 6+ times on
  // the Countermoves drill 2026-05-26.
  assert.match(
    result.documentKey,
    /^[a-z0-9-]+$/,
    'host-validator-safe charset: lowercase + digits + hyphens only',
  );
  assert.equal(ctx._documentUpsertCalls.length, 1);
  // Confirm the upsert call also carries the original filename in `title`
  // (the host stores it on documents.title -- this is how the filename
  // survives despite being absent from the key).
  assert.equal(
    ctx._documentUpsertCalls[0].title,
    'sample.pdf',
    'original filename preserved in documents.title',
  );
  const inserts = ctx._calls.filter(
    (c) =>
      c.kind === 'execute' &&
      /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(c.sql),
  );
  assert.equal(inserts.length, 1);
});

test('chat.attachment.upload: happy path -- png passes sniff', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'icon.png',
      mimeType: 'image/png',
      body: asBase64(makePngBytes(1024)),
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'image/png');
});

test('chat.attachment.upload: happy path -- xlsx passes (zip-prefix sniff)', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'sheet.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: asBase64(makeXlsxBytes(2048)),
    }),
  );
  assert.equal(result.ok, true);
});

test('chat.attachment.upload: happy path -- md passes (ASCII-text sniff)', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'README.md',
      mimeType: 'text/markdown',
      body: asBase64(makeMdBytes()),
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'text/markdown');
});

// ---- Test 6 -- mime-sniff mismatch -----------------------------------

test('chat.attachment.upload: pdf-extension + zip header -> MIME_MISMATCH', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'pretend.pdf',
      mimeType: 'application/pdf',
      body: asBase64(makeXlsxBytes(1024)),
    }),
  );
  assert.equal(result.error, 'MIME_MISMATCH');
  assert.equal(result.declared, 'application/pdf');
  assert.equal(ctx._documentUpsertCalls.length, 0, 'no upsert on mismatch');
});

test('chat.attachment.upload: png-extension + jpeg header -> MIME_MISMATCH', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'fake.png',
      mimeType: 'image/png',
      body: asBase64(makeJpegBytes(1024)),
    }),
  );
  assert.equal(result.error, 'MIME_MISMATCH');
});

test('chat.attachment.upload: md-extension + NUL-bearing binary -> MIME_MISMATCH', async () => {
  // Binary blob with a NUL early in the buffer -- the text heuristic
  // disqualifies it.
  const binary = Buffer.from([0x4d, 0x44, 0x00, 0x01, 0x02, 0x03]);
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'README.md',
      mimeType: 'text/markdown',
      body: asBase64(binary),
    }),
  );
  assert.equal(result.error, 'MIME_MISMATCH');
});

// ---- Test 7 -- MIME_NOT_ALLOWED -------------------------------------

test('chat.attachment.upload: .docx extension -> MIME_NOT_ALLOWED BEFORE any host call', async () => {
  const ctx = makeCtx();
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(
    uploadParams({
      originalFilename: 'spec.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: asBase64(makeXlsxBytes(1024)), // docx has the same zip prefix
    }),
  );
  assert.equal(result.error, 'MIME_NOT_ALLOWED');
  assert.deepEqual(result.allowed, ['xlsx', 'pdf', 'md', 'png']);
  assert.equal(ctx._documentUpsertCalls.length, 0);
});

// ---- Test 9 -- host upsert failure -> UPLOAD_FAILED -----------------

test('chat.attachment.upload: host documents.upsert failure -> UPLOAD_FAILED, no insert', async () => {
  const ctx = makeCtx({ upsertThrows: true });
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(uploadParams());
  assert.deepEqual(result, { error: 'UPLOAD_FAILED' });
  const inserts = ctx._calls.filter(
    (c) =>
      c.kind === 'execute' &&
      /INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_message_attachments/i.test(c.sql),
  );
  assert.equal(inserts.length, 0, 'no side-table insert when upsert fails');
});

test('chat.attachment.upload: side-table insert failure triggers compensating delete', async () => {
  const ctx = makeCtx({ insertThrows: true });
  registerChatAttachmentUpload(ctx);
  const handler = ctx._handlers.get('chat.attachment.upload');
  const result = await handler(uploadParams());
  assert.deepEqual(result, { error: 'UPLOAD_FAILED' });
  assert.equal(
    ctx._documentDeleteCalls.length,
    1,
    'compensating documents.delete fires',
  );
});

// ---- Test 10 -- CTT-07 runtime spy -----------------------------------

test('chat.attachment.upload: CTT-07 invariant -- zero ctx.issues.update across all code paths', async () => {
  const happy = makeCtx();
  registerChatAttachmentUpload(happy);
  const handler = happy._handlers.get('chat.attachment.upload');
  await handler(uploadParams()); // happy path
  await handler(uploadParams({ originalFilename: 'x.docx' })); // MIME_NOT_ALLOWED
  await handler(uploadParams({ body: asBase64(pad(PDF_MAGIC, 10_485_761)) })); // FILE_TOO_LARGE
  await handler(uploadParams({ body: asBase64(makeXlsxBytes(1024)) })); // MIME_MISMATCH
  assert.equal(happy._issueUpdateCalls.length, 0, 'happy + 3 errors -- zero updates');

  const optedOut = makeCtx({ optedIn: false });
  registerChatAttachmentUpload(optedOut);
  const handler2 = optedOut._handlers.get('chat.attachment.upload');
  await handler2(uploadParams());
  assert.equal(optedOut._issueUpdateCalls.length, 0, 'opt-out path -- zero updates');

  const upsertFail = makeCtx({ upsertThrows: true });
  registerChatAttachmentUpload(upsertFail);
  const handler3 = upsertFail._handlers.get('chat.attachment.upload');
  await handler3(uploadParams());
  assert.equal(upsertFail._issueUpdateCalls.length, 0, 'upsert-fail path -- zero updates');

  const overSum = makeCtx({ existingByteSum: 52_428_800 });
  registerChatAttachmentUpload(overSum);
  const handler4 = overSum._handlers.get('chat.attachment.upload');
  await handler4(uploadParams());
  assert.equal(overSum._issueUpdateCalls.length, 0, 'message-too-large path -- zero updates');
});
