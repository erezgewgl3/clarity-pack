// test/worker/tldr-cache.test.mjs
//
// Plan 02-03 Task 1 — TL;DR cache CRUD against the baked plugin namespace.
// upsertTldr uses INSERT ... ON CONFLICT (surface, scope_id, content_hash) DO
// NOTHING semantics (EDITOR-03 idempotency). getTldrByScope returns the most
// recent row for (surface, scope_id) by generated_at DESC. Every SQL string
// MUST target `plugin_clarity_pack_cdd6bda4bd.tldr_cache` literally — the host
// validator rejects unqualified targets at runtime (02-01 SMOKE-FINDINGS
// Finding #4).
//
// v0.6.5 — Bug 2 (tldr-heartbeat-recursion debug). `upsertTldr` now binds the
// two `text[]` columns (`source_revisions`, `tags`) as Postgres array-LITERAL
// strings through `$N::text[]` casts. The host db bridge does not round-trip a
// JS array as a native array; a bare string into a `text[]` column threw
// `malformed array literal` live. The fake `execute` below DECODES the
// array-literal string back to a JS array on store — exactly as the real
// host's `postgres` driver round-trips a `$N::text[]` insert to a JS array on
// the SELECT readback.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  upsertTldr,
  getTldrByScope,
  toPgTextArrayLiteral,
} from '../../src/worker/db/tldr-cache.ts';
import { wrapHostFaithfulDb } from '../helpers/host-faithful-db.mjs';

/**
 * Decode a Postgres text-array literal (`{"a","b"}`, `{}`) back to a JS string
 * array — the inverse of `toPgTextArrayLiteral`. Mirrors how the live host's
 * `postgres` driver returns a `text[]` column as a JS array on SELECT.
 */
function decodePgTextArrayLiteral(literal) {
  if (typeof literal !== 'string') return literal; // already an array (defensive)
  const inner = literal.replace(/^\{/, '').replace(/\}$/, '');
  if (inner === '') return [];
  const out = [];
  let buf = '';
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '"') {
      i += 1;
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === '\\') {
          buf += inner[i + 1];
          i += 2;
        } else {
          buf += inner[i];
          i += 1;
        }
      }
      i += 1; // closing quote
    } else if (ch === ',') {
      out.push(buf);
      buf = '';
      i += 1;
    } else {
      buf += ch;
      i += 1;
    }
  }
  out.push(buf);
  return out;
}

function makeFakeDbCtx(initialRows = []) {
  const calls = [];
  const rows = [...initialRows];
  const ctx = {
    db: {
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        // Mimic ON CONFLICT DO NOTHING: only insert if no row matches the unique key.
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags] = params;
          const exists = rows.some(
            (r) => r.surface === surface && r.scope_id === scope_id && r.content_hash === content_hash,
          );
          if (!exists) {
            // The host round-trips a `$N::text[]` insert to a JS array on
            // SELECT — decode the array-literal string the same way here.
            rows.push({
              surface,
              scope_id,
              content_hash,
              body,
              generated_at,
              source_revisions: decodePgTextArrayLiteral(source_revisions),
              compiled_by_agent_id,
              tags: decodePgTextArrayLiteral(tags),
            });
          }
        }
        return { rowCount: 0 };
      },
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        // Plan 02-03b: SDK PluginDatabaseClient.query<T>() returns T[] directly,
        // NOT {rows: T[]}. Tests that mocked {rows} were modeled after the
        // node-postgres shape that drove the original drill defect (#7 in
        // 02-03b-API-SHAPES.md).
        if (/SELECT[\s\S]*FROM\s+plugin_clarity_pack_cdd6bda4bd\.tldr_cache/i.test(sql)) {
          const [surface, scope_id] = params;
          const matching = rows.filter((r) => r.surface === surface && r.scope_id === scope_id);
          matching.sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
          return matching.slice(0, 1);
        }
        return [];
      },
    },
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return { ctx, calls, rows };
}

test('upsertTldr targets the baked namespace plugin_clarity_pack_cdd6bda4bd.tldr_cache (Finding #4)', async () => {
  const { ctx, calls } = makeFakeDbCtx();
  await upsertTldr(ctx, {
    surface: 'issue',
    scope_id: 'BEAAA-141',
    content_hash: 'h1',
    body: 'TL;DR body',
    generated_at: '2026-05-13T10:00:00Z',
    source_revisions: ['h1'],
    compiled_by_agent_id: 'clarity-pack-editor-agent',
    tags: ['clarity:editor-write'],
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /plugin_clarity_pack_cdd6bda4bd\.tldr_cache/);
});

test('upsertTldr second call with same (surface, scope_id, content_hash) is a no-op (ON CONFLICT DO NOTHING)', async () => {
  const { ctx, rows } = makeFakeDbCtx();
  const tldr = {
    surface: 'issue',
    scope_id: 'BEAAA-141',
    content_hash: 'h-same',
    body: 'first body',
    generated_at: '2026-05-13T10:00:00Z',
    source_revisions: ['h-same'],
    compiled_by_agent_id: 'clarity-pack-editor-agent',
    tags: ['clarity:editor-write'],
  };
  await upsertTldr(ctx, tldr);
  await upsertTldr(ctx, { ...tldr, body: 'attempted overwrite' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, 'first body', 'second upsert was a no-op');
});

test('getTldrByScope returns the most-recent row (ORDER BY generated_at DESC LIMIT 1)', async () => {
  const initial = [
    {
      surface: 'issue',
      scope_id: 'BEAAA-141',
      content_hash: 'h-older',
      body: 'older',
      generated_at: '2026-05-12T10:00:00Z',
      source_revisions: [],
      compiled_by_agent_id: 'clarity-pack-editor-agent',
      tags: [],
    },
    {
      surface: 'issue',
      scope_id: 'BEAAA-141',
      content_hash: 'h-newer',
      body: 'newer',
      generated_at: '2026-05-13T10:00:00Z',
      source_revisions: [],
      compiled_by_agent_id: 'clarity-pack-editor-agent',
      tags: [],
    },
  ];
  const { ctx, calls } = makeFakeDbCtx(initial);
  const result = await getTldrByScope(ctx, 'issue', 'BEAAA-141');
  assert.ok(result, 'returns a row');
  assert.equal(result.body, 'newer', 'returns the row with later generated_at');
  // SQL targets the baked namespace
  assert.match(calls[0].sql, /plugin_clarity_pack_cdd6bda4bd\.tldr_cache/);
});

test('getTldrByScope returns null when no row matches', async () => {
  const { ctx } = makeFakeDbCtx();
  const result = await getTldrByScope(ctx, 'issue', 'BEAAA-9999');
  assert.equal(result, null);
});

// ===========================================================================
// v0.6.5 — Bug 2 regression (tldr-heartbeat-recursion debug). A bare string
// into the `source_revisions text[]` column threw `malformed array literal`
// at the host db layer on the 2026-05-17 v0.6.4 cycle-2 drill. upsertTldr must
// bind both `text[]` columns as Postgres array-literal strings through
// `$N::text[]` casts.
// ===========================================================================

test('Bug 2: toPgTextArrayLiteral encodes a JS array as a Postgres array literal', () => {
  assert.equal(toPgTextArrayLiteral([]), '{}', 'empty array → {}');
  assert.equal(toPgTextArrayLiteral(['h1']), '{"h1"}', 'single element is quoted');
  assert.equal(
    toPgTextArrayLiteral(['a', 'b', 'c']),
    '{"a","b","c"}',
    'multiple elements are comma-joined',
  );
  // A 64-hex-char content hash — the exact value that failed live as a bare
  // scalar. As a quoted array-literal element it is a valid `text[]` literal.
  const hash = 'a'.repeat(64);
  assert.equal(toPgTextArrayLiteral([hash]), `{"${hash}"}`);
  // Embedded quotes / backslashes are escaped per Postgres array-literal rules.
  assert.equal(toPgTextArrayLiteral(['say "hi"']), '{"say \\"hi\\""}');
  assert.equal(toPgTextArrayLiteral(['back\\slash']), '{"back\\\\slash"}');
});

test('Bug 2: upsertTldr binds source_revisions + tags as $N::text[] array-literal strings, not bare scalars', async () => {
  const { ctx, calls } = makeFakeDbCtx();
  const hash = 'b'.repeat(64);
  await upsertTldr(ctx, {
    surface: 'issue',
    scope_id: 'BEAAA-555',
    content_hash: hash,
    body: 'a tldr',
    generated_at: '2026-05-17T12:00:00Z',
    source_revisions: [hash],
    compiled_by_agent_id: 'clarity-pack-editor-agent',
    tags: ['clarity:editor-write'],
  });

  const insert = calls.find((c) => /INSERT\s+INTO/i.test(c.sql));
  assert.ok(insert, 'an INSERT was issued');

  // The SQL must cast the two text[] placeholders explicitly. Without the cast
  // Postgres cannot coerce the scalar param and throws `malformed array
  // literal` — the exact live v0.6.4 failure.
  assert.match(insert.sql, /\$6::text\[\]/, 'source_revisions placeholder is cast to text[]');
  assert.match(insert.sql, /\$8::text\[\]/, 'tags placeholder is cast to text[]');

  // The bound params for the two array columns must be array-LITERAL STRINGS,
  // never bare JS arrays or bare scalars.
  const [, , , , , sourceRevisionsParam, , tagsParam] = insert.params;
  assert.equal(typeof sourceRevisionsParam, 'string', 'source_revisions is bound as a string');
  assert.equal(sourceRevisionsParam, `{"${hash}"}`, 'source_revisions is a valid Postgres array literal');
  assert.equal(typeof tagsParam, 'string', 'tags is bound as a string');
  assert.equal(tagsParam, '{"clarity:editor-write"}', 'tags is a valid Postgres array literal');
});

test('Bug 2: a TL;DR round-trips — source_revisions stored and read back as a JS array', async () => {
  const { ctx } = makeFakeDbCtx();
  const hash = 'c'.repeat(64);
  await upsertTldr(ctx, {
    surface: 'issue',
    scope_id: 'BEAAA-777',
    content_hash: hash,
    body: 'round-trip tldr',
    generated_at: '2026-05-17T13:00:00Z',
    source_revisions: [hash],
    compiled_by_agent_id: 'clarity-pack-editor-agent',
    tags: ['clarity:editor-write', 'extra'],
  });
  const row = await getTldrByScope(ctx, 'issue', 'BEAAA-777');
  assert.ok(row, 'the TL;DR was persisted (no malformed-array-literal failure)');
  assert.deepEqual(row.source_revisions, [hash], 'source_revisions reads back as a JS array');
  assert.deepEqual(row.tags, ['clarity:editor-write', 'extra'], 'tags reads back as a JS array');
});
