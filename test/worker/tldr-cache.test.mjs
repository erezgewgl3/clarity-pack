// test/worker/tldr-cache.test.mjs
//
// Plan 02-03 Task 1 — TL;DR cache CRUD against the baked plugin namespace.
// upsertTldr uses INSERT ... ON CONFLICT (surface, scope_id, content_hash) DO
// NOTHING semantics (EDITOR-03 idempotency). getTldrByScope returns the most
// recent row for (surface, scope_id) by generated_at DESC. Every SQL string
// MUST target `plugin_clarity_pack_cdd6bda4bd.tldr_cache` literally — the host
// validator rejects unqualified targets at runtime (02-01 SMOKE-FINDINGS
// Finding #4).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  upsertTldr,
  getTldrByScope,
} from '../../src/worker/db/tldr-cache.ts';

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
            rows.push({ surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags });
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
