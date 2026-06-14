// test/worker/deliverable-preview.test.mjs
//
// Plan 05-04 Task 1 (RED -> GREEN) — deliverable.preview DATA handler.
//
// DIST-04: full-fidelity previewer dispatch for the Reader-view "The
// deliverable" section. The handler parses xlsx server-side via SheetJS
// (worker bundle only — never in the UI bundle) and returns a discriminated
// union `{ kind: 'xlsx-grid' | 'pdf-embed' | 'md' | 'img' | 'placeholder' }
// | { error }`.
//
// Threat-model anchors (T-05-04-01..-04):
//   - T-05-04-01 Tampering (SheetJS formula-injection): handler MUST call
//     XLSX.read with cellFormula:false (parse-only path; no formula eval).
//   - T-05-04-02 Tampering (.xlsm macro-enabled): hard reject; SheetJS NEVER
//     called.
//   - T-05-04-03 DoS (oversize xlsx): 5MB ceiling enforced BEFORE SheetJS
//     parses — chokepoint constant `XLSX_MAX_BYTES`.
//
// Data-handler convention (mirrors chat-active-tasks.test.mjs):
//   - missing required string param -> { error: '<KEY>_REQUIRED' }
//   - opted-out caller              -> { error: 'OPT_IN_REQUIRED' }
//   - corrupt/oversize file         -> { error: '<NAME>' } (never throw)

import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { registerDeliverablePreview } from '../../src/worker/handlers/deliverable-preview.ts';

function makeCtx({
  optedIn = true,
  // Map of `${issueId}|${key}` -> { body: string, summary?: { size?, updatedAt? } }
  documents = {},
  // Set of issueIds for which documents.list throws.
  listThrows = new Set(),
  // Set of `${issueId}|${key}` for which documents.get throws.
  getThrows = new Set(),
} = {}) {
  const handlers = new Map();
  const warnLogs = [];
  const xlsxReadCalls = [];

  // Wrap XLSX.read so tests can verify it was NOT called on the reject paths
  // (T-05-04-02 macro rejection + T-05-04-03 oversize). We do this via a
  // global counter the tests can inspect; the handler imports xlsx at module
  // top so we cannot monkey-patch — instead the tests pass fixtures that
  // SHOULD fail BEFORE the parse step, and we assert the structured error
  // shape (a parse-attempt would produce a different shape entirely).

  const ctx = {
    logger: {
      warn(msg, fields) { warnLogs.push({ msg, fields }); },
      info() {},
    },
    data: {
      register(key, fn) { handlers.set(key, fn); },
    },
    issues: {
      documents: {
        async list(issueId, _companyId) {
          if (listThrows.has(issueId)) throw new Error('host docs.list 503');
          // Return summary entries for every doc keyed by issueId.
          const summaries = [];
          for (const k of Object.keys(documents)) {
            const [docIssueId, key] = k.split('|');
            if (docIssueId === issueId) {
              const doc = documents[k];
              summaries.push({
                id: `doc-${key}`,
                key,
                filename: key,
                title: key,
                updatedAt: doc.summary?.updatedAt ?? '2026-05-25T00:00:00Z',
                ...(doc.summary ?? {}),
              });
            }
          }
          return summaries;
        },
        async get(issueId, key, _companyId) {
          const k = `${issueId}|${key}`;
          if (getThrows.has(k)) throw new Error('host docs.get 503');
          const doc = documents[k];
          if (!doc) return null;
          return {
            id: `doc-${key}`,
            key,
            body: doc.body,
            ...(doc.summary ?? {}),
          };
        },
      },
    },
    db: {
      async query(sql, _params) {
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
    _xlsxReadCalls: xlsxReadCalls,
  };
  return ctx;
}

function previewParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    issueId: 'issue-1',
    documentKey: 'sheet.xlsx',
    ...overrides,
  };
}

// Build a small xlsx buffer in-memory so tests don't ship a binary fixture.
function makeXlsxBuffer(rows = [['A', 'B'], ['1', '2']], sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

// ---- Test 1 — handler registers under exactly deliverable.preview --------

test('deliverable.preview: handler registers under key deliverable.preview', () => {
  const ctx = makeCtx();
  registerDeliverablePreview(ctx);
  assert.ok(ctx._handlers.has('deliverable.preview'));
  assert.equal(ctx._handlers.size, 1, 'exactly one handler key registered');
});

// ---- Test 2 — OPT-IN gate ------------------------------------------------

test('deliverable.preview: opted-out caller -> { error: OPT_IN_REQUIRED }', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(previewParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

// ---- Test 3 — PARAM guards (data-handler convention) ---------------------

test('deliverable.preview: missing companyId -> { error: COMPANY_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerDeliverablePreview(ctx);
  const p = previewParams();
  delete p.companyId;
  const result = await ctx._handlers.get('deliverable.preview')(p);
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('deliverable.preview: missing userId -> opt-in-guard fires first -> OPT_IN_REQUIRED', async () => {
  const ctx = makeCtx();
  registerDeliverablePreview(ctx);
  const p = previewParams();
  delete p.userId;
  const result = await ctx._handlers.get('deliverable.preview')(p);
  // extractUserId returns null -> isOptedIn returns false -> OPT_IN_REQUIRED.
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

test('deliverable.preview: missing issueId -> { error: ISSUE_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerDeliverablePreview(ctx);
  const p = previewParams();
  delete p.issueId;
  const result = await ctx._handlers.get('deliverable.preview')(p);
  assert.equal(result.error, 'ISSUE_ID_REQUIRED');
});

test('deliverable.preview: missing documentKey -> { error: DOCUMENT_KEY_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerDeliverablePreview(ctx);
  const p = previewParams();
  delete p.documentKey;
  const result = await ctx._handlers.get('deliverable.preview')(p);
  assert.equal(result.error, 'DOCUMENT_KEY_REQUIRED');
});

// ---- Test 4 — xlsx HAPPY PATH (kind dispatch + cell coercion) ------------

test('deliverable.preview: .xlsx -> { kind: xlsx-grid, sheets: [{name, rows}] }', async () => {
  const xlsxBytes = makeXlsxBuffer([['Header A', 'Header B'], ['1', 'two'], ['', null]]);
  const xlsxBase64 = Buffer.from(xlsxBytes).toString('base64');
  const ctx = makeCtx({
    documents: {
      'issue-1|grid.xlsx': { body: xlsxBase64 },
    },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'grid.xlsx' }),
  );
  assert.equal(result.kind, 'xlsx-grid', 'kind dispatched on .xlsx');
  assert.ok(Array.isArray(result.sheets));
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].name, 'Sheet1');
  // Every cell coerced to string; null -> empty string.
  for (const row of result.sheets[0].rows) {
    for (const cell of row) {
      assert.equal(typeof cell, 'string', `cell ${JSON.stringify(cell)} should be a string`);
    }
  }
  assert.equal(result.sheets[0].rows[0][0], 'Header A');
});

// ---- Test 5 — markdown HAPPY PATH ----------------------------------------

test('deliverable.preview: .md -> { kind: md, body }', async () => {
  const mdBody = '# Hello\n\nWorld';
  const ctx = makeCtx({
    documents: { 'issue-1|notes.md': { body: mdBody } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'notes.md' }),
  );
  assert.equal(result.kind, 'md');
  assert.equal(result.body, mdBody);
});

test('deliverable.preview: .markdown -> { kind: md, body }', async () => {
  const ctx = makeCtx({
    documents: { 'issue-1|README.markdown': { body: 'plain text' } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'README.markdown' }),
  );
  assert.equal(result.kind, 'md');
});

// ---- Test 6 — pdf / img HAPPY PATH ---------------------------------------

test('deliverable.preview: .pdf -> { kind: pdf-embed, body, mimeType }', async () => {
  // Hotfix 2026-05-26 (rc.8): the Plan 05-04 design returned `{ url }` and
  // assumed the host's `/api/issues/<id>/documents/<key>` served binary
  // bytes. The live host actually returns JSON with body base64-encoded,
  // so `<embed type="application/pdf" src={url}>` showed JSON-as-text.
  // Fix: worker returns body bytes directly; UI creates a Blob URL.
  const ctx = makeCtx({
    documents: { 'issue-1|report.pdf': { body: 'fake-pdf-bytes-base64' } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'report.pdf' }),
  );
  assert.equal(result.kind, 'pdf-embed');
  assert.equal(typeof result.body, 'string', 'body string present (base64)');
  assert.ok(result.body.length > 0, 'body non-empty');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.url, undefined, 'no url field — UI blob-ifies locally');
});

test('deliverable.preview: .png -> { kind: img, body, mimeType }', async () => {
  const ctx = makeCtx({
    documents: { 'issue-1|chart.png': { body: 'fake-png-bytes-base64' } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'chart.png' }),
  );
  assert.equal(result.kind, 'img');
  assert.equal(typeof result.body, 'string');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.url, undefined);
});

test('deliverable.preview: .jpg/.jpeg/.gif/.webp -> { kind: img } with mimeType', async () => {
  const mimes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  for (const ext of Object.keys(mimes)) {
    const key = `pic${ext}`;
    const ctx = makeCtx({
      documents: { [`issue-1|${key}`]: { body: 'bytes' } },
    });
    registerDeliverablePreview(ctx);
    const result = await ctx._handlers.get('deliverable.preview')(
      previewParams({ documentKey: key }),
    );
    assert.equal(result.kind, 'img', `${ext} routes to img`);
    assert.equal(result.mimeType, mimes[ext], `${ext} mimeType`);
    assert.equal(typeof result.body, 'string');
  }
});

test('deliverable.preview: filenameHint resolves ext when documentKey has none (chat-attach UUID key case)', async () => {
  // Hotfix 2026-05-26 (rc.8): chat-attach document keys are UUID-only
  // (chat-attach-<uuid>). Without filenameHint the dispatcher cannot
  // route. With filenameHint='Report.pdf' the dispatcher MUST treat the
  // doc as PDF and return { kind: 'pdf-embed', body, mimeType }.
  const ctx = makeCtx({
    documents: {
      'issue-1|chat-attach-fakeuuid-deadbeef': { body: 'fake-pdf-base64' },
    },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({
      documentKey: 'chat-attach-fakeuuid-deadbeef',
      filenameHint: 'Document_Archive_Index.PDF',
    }),
  );
  assert.equal(result.kind, 'pdf-embed', 'filenameHint resolves .pdf');
  assert.equal(result.mimeType, 'application/pdf');
});

test('deliverable.preview: filenameHint also routes png correctly for UUID keys', async () => {
  const ctx = makeCtx({
    documents: {
      'issue-1|chat-attach-otheruuid': { body: 'fake-png-base64' },
    },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({
      documentKey: 'chat-attach-otheruuid',
      filenameHint: 'screenshot.png',
    }),
  );
  assert.equal(result.kind, 'img');
  assert.equal(result.mimeType, 'image/png');
});

// ---- Test 7 — size-cap CHOKEPOINT (T-05-04-03) ---------------------------

test('deliverable.preview: oversize xlsx (>5MB) -> { error: DELIVERABLE_TOO_LARGE } BEFORE parse', async () => {
  // 6 MB-ish base64 body.
  const big = Buffer.alloc(6_000_000, 'A').toString('base64');
  const ctx = makeCtx({
    documents: { 'issue-1|huge.xlsx': { body: big } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'huge.xlsx' }),
  );
  assert.equal(result.error, 'DELIVERABLE_TOO_LARGE');
  assert.ok(typeof result.sizeBytes === 'number' && result.sizeBytes > 5_000_000);
});

// ---- Test 8 — MACRO REJECTION (T-05-04-02) -------------------------------

test('deliverable.preview: .xlsm -> { error: XLSM_REJECTED } BEFORE SheetJS', async () => {
  const ctx = makeCtx({
    documents: { 'issue-1|macro.xlsm': { body: 'whatever-bytes' } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'macro.xlsm' }),
  );
  assert.equal(result.error, 'XLSM_REJECTED');
});

// ---- Test 9 — PARSE FAILURE graceful degrade -----------------------------

test('deliverable.preview: corrupt .xlsx -> { error: PARSE_FAILED } (never throws)', async () => {
  // PK header (zip magic) followed by garbage -- SheetJS treats this as a
  // corrupted zip and throws. A short non-PK buffer would be silently
  // parsed as an empty workbook (SheetJS 0.18.5 behaviour), which is NOT
  // what the threat model is guarding against -- a malformed-but-claims-
  // to-be-xlsx file is the actual attack surface (T-05-04-01 / -03).
  const corruptBytes = Buffer.from(
    'PK\x03\x04corrupted-and-too-short-to-be-a-real-zip-archive',
    'binary',
  );
  const ctx = makeCtx({
    documents: {
      'issue-1|broken.xlsx': { body: corruptBytes.toString('base64') },
    },
  });
  registerDeliverablePreview(ctx);
  let threw = false;
  let result;
  try {
    result = await ctx._handlers.get('deliverable.preview')(
      previewParams({ documentKey: 'broken.xlsx' }),
    );
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, false, 'handler must NOT throw on parse failure');
  assert.equal(result.error, 'PARSE_FAILED');
});

// ---- Test 10 — UNKNOWN kind -> placeholder -------------------------------

test('deliverable.preview: unknown extension -> { kind: placeholder, reason }', async () => {
  const ctx = makeCtx({
    documents: { 'issue-1|file.xyz': { body: 'whatever' } },
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'file.xyz' }),
  );
  assert.equal(result.kind, 'placeholder');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  // T1-B — the reason now NAMES the extension so the limitation is legible.
  assert.ok(result.reason.includes('.xyz'), 'placeholder reason names the extension');
});

// ---- T1-B — plain-text-family inline preview -----------------------------

test('deliverable.preview: .txt/.csv/.json/.log/.yaml -> { kind: text, body } (inline)', async () => {
  const cases = {
    'notes.txt': 'hello world',
    'export.csv': 'a,b,c\n1,2,3',
    'config.json': '{"k":"v"}',
    'run.log': 'INFO booted',
    'manifest.yaml': 'name: clarity',
  };
  for (const [key, content] of Object.entries(cases)) {
    const ctx = makeCtx({ documents: { [`issue-1|${key}`]: { body: content } } });
    registerDeliverablePreview(ctx);
    const result = await ctx._handlers.get('deliverable.preview')(
      previewParams({ documentKey: key }),
    );
    assert.equal(result.kind, 'text', `${key} routes to text`);
    assert.equal(result.body, content, `${key} body surfaced verbatim`);
  }
});

test('deliverable.preview: oversize text (>2MB) -> { kind: text, truncated: true }', async () => {
  const big = 'x'.repeat(2_500_000);
  const ctx = makeCtx({ documents: { 'issue-1|huge.log': { body: big } } });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'huge.log' }),
  );
  assert.equal(result.kind, 'text');
  assert.equal(result.truncated, true);
  assert.ok(result.body.length < big.length, 'body is truncated below the cap');
});

// ---- Test 11 — DOCUMENT NOT FOUND degrade --------------------------------

test('deliverable.preview: documents.get returns null -> { error: READ_FAILED }', async () => {
  const ctx = makeCtx({
    documents: {}, // empty
  });
  registerDeliverablePreview(ctx);
  const result = await ctx._handlers.get('deliverable.preview')(
    previewParams({ documentKey: 'missing.md' }),
  );
  assert.equal(result.error, 'READ_FAILED');
});
