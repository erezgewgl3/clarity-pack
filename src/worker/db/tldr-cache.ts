// src/worker/db/tldr-cache.ts
//
// Plan 02-03 Task 1 — TL;DR cache CRUD. EDITOR-03 idempotency is enforced via
// the UNIQUE (surface, scope_id, content_hash) constraint + ON CONFLICT DO
// NOTHING semantics: upserting the same hash twice is a no-op.
//
// Every SQL string targets the baked plugin namespace
// `plugin_clarity_pack_cdd6bda4bd.tldr_cache` literally. Paperclip's host
// validators reject unqualified targets at runtime AND at migration time per
// 02-01 SMOKE-FINDINGS Finding #4 — there is no template substitution.

export type TldrRow = {
  surface: 'issue' | 'situation' | 'bulletin';
  scope_id: string;
  content_hash: string;
  body: string;
  generated_at: string; // ISO
  source_revisions: string[];
  compiled_by_agent_id: string;
  tags: string[];
};

export type TldrCacheCtx = {
  db: {
    execute(sql: string, params: unknown[]): Promise<unknown>;
    query(sql: string, params: unknown[]): Promise<{ rows: TldrRow[] }>;
  };
};

/**
 * Insert a TL;DR. If (surface, scope_id, content_hash) already exists, the
 * insert is a no-op (EDITOR-03 idempotency). The Postgres ON CONFLICT clause
 * does the deduplication server-side — no read-then-write race.
 */
export async function upsertTldr(ctx: TldrCacheCtx, tldr: TldrRow): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.tldr_cache
       (surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (surface, scope_id, content_hash) DO NOTHING`,
    [
      tldr.surface,
      tldr.scope_id,
      tldr.content_hash,
      tldr.body,
      tldr.generated_at,
      tldr.source_revisions,
      tldr.compiled_by_agent_id,
      tldr.tags,
    ],
  );
}

/**
 * Read the most-recent TL;DR for (surface, scope_id). Returns null when no
 * row exists yet — UI surfaces render a "Compiling TL;DR…" placeholder in
 * that case (READER-02).
 */
export async function getTldrByScope(
  ctx: TldrCacheCtx,
  surface: TldrRow['surface'],
  scopeId: string,
): Promise<TldrRow | null> {
  const result = await ctx.db.query(
    `SELECT surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags
     FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache
     WHERE surface = $1 AND scope_id = $2
     ORDER BY generated_at DESC
     LIMIT 1`,
    [surface, scopeId],
  );
  return result.rows[0] ?? null;
}
