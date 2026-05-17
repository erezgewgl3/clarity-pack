// src/worker/db/tldr-cache.ts
//
// Plan 02-03b Task 2 — fix the {rows}-unwrap bug. SDK's PluginDatabaseClient
// query<T>() returns T[] directly, not {rows: T[]}. The Plan 02-03 draft was
// modeled on node-postgres and silently returned no TL;DR even when one was
// cached.
//
// EDITOR-03 idempotency is enforced via the UNIQUE (surface, scope_id,
// content_hash) constraint + ON CONFLICT DO NOTHING semantics: upserting the
// same hash twice is a no-op.
//
// v0.6.5 — Bug 2 (tldr-heartbeat-recursion debug). The `tldr_cache` table has
// TWO `text[]` columns (`source_revisions`, `tags`). The host's
// `ctx.db.execute` parameter bridge does NOT pass a JS string array through to
// the underlying `postgres` driver as a native array — it arrives at Postgres
// as a scalar, and Postgres then fails to coerce the scalar into `text[]` with
// `ERROR: malformed array literal: "<value>"` (observed live on the
// 2026-05-17 v0.6.4 cycle-2 drill — every TL;DR write failed at the host db
// layer). The fix: format each `text[]` value as an explicit Postgres
// array-LITERAL string (`{"a","b"}`) and bind it through a `$N::text[]` cast
// in the SQL. A cast scalar is unambiguous regardless of how the host bridge
// serializes the parameter — see `toPgTextArrayLiteral` below.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

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
  db: PluginDatabaseClient;
};

/**
 * Format a JS string array as a Postgres array LITERAL string — e.g.
 * `['a', 'b']` → `{"a","b"}`, `[]` → `{}`.
 *
 * v0.6.5 Bug 2. Bound through a `$N::text[]` cast, this scalar text parameter
 * is unambiguously coerced to `text[]` by Postgres, sidestepping the host
 * `ctx.db.execute` bridge's lossy array serialization (which caused
 * `malformed array literal` on the live v0.6.4 drill).
 *
 * Each element is double-quoted and any embedded `"` / `\` is backslash-
 * escaped — the Postgres array-literal quoting rules. Double-quoting every
 * element (rather than bare-wording the safe ones) keeps the encoder simple
 * and correct for empty strings, commas, braces, and whitespace alike.
 *
 * Exported for direct unit testing of the encoder contract.
 */
export function toPgTextArrayLiteral(values: string[]): string {
  const escaped = values.map(
    (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(',')}}`;
}

/**
 * Insert a TL;DR. If (surface, scope_id, content_hash) already exists, the
 * insert is a no-op (EDITOR-03 idempotency). The Postgres ON CONFLICT clause
 * does the deduplication server-side — no read-then-write race.
 *
 * The two `text[]` columns (`source_revisions`, `tags`) are bound as
 * array-literal strings through `$N::text[]` casts (v0.6.5 Bug 2 — see the
 * file header).
 */
export async function upsertTldr(ctx: TldrCacheCtx, tldr: TldrRow): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.tldr_cache
       (surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8::text[])
     ON CONFLICT (surface, scope_id, content_hash) DO NOTHING`,
    [
      tldr.surface,
      tldr.scope_id,
      tldr.content_hash,
      tldr.body,
      tldr.generated_at,
      toPgTextArrayLiteral(tldr.source_revisions),
      tldr.compiled_by_agent_id,
      toPgTextArrayLiteral(tldr.tags),
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
  const rows = await ctx.db.query<TldrRow>(
    `SELECT surface, scope_id, content_hash, body, generated_at, source_revisions, compiled_by_agent_id, tags
     FROM plugin_clarity_pack_cdd6bda4bd.tldr_cache
     WHERE surface = $1 AND scope_id = $2
     ORDER BY generated_at DESC
     LIMIT 1`,
    [surface, scopeId],
  );
  return rows[0] ?? null;
}
