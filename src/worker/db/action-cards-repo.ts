// src/worker/db/action-cards-repo.ts
//
// Plan 13-01 Task 2 (D-01/D-02) — the Editor-Agent action-card cache repo.
// A 1:1 structural mirror of src/worker/db/tldr-cache.ts: same ctx shape
// (db: PluginDatabaseClient), same EDITOR-03 idempotency discipline
// (UNIQUE + ON CONFLICT DO NOTHING), same text[] binding fix.
//
// EDITOR-03 idempotency is company-scoped (the 0014 multi-company lesson):
// the UNIQUE (company_id, source_issue_id, content_hash) constraint +
// ON CONFLICT DO NOTHING means upserting the same (company, leaf, content)
// twice is a no-op — one input, one LLM call, one row. The dedup happens
// server-side; there is no read-then-write race.
//
// text[] columns (source_revisions, tags) are bound as Postgres array-LITERAL
// strings through $N::text[] casts via the shared toPgTextArrayLiteral helper
// (v0.6.5 Bug 2 — the host ctx.db.execute bridge does NOT pass a JS string
// array through to the postgres driver as a native array; a cast scalar is
// unambiguous). The helper is REUSED from tldr-cache.ts verbatim, never
// re-implemented.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

import { toPgTextArrayLiteral } from './tldr-cache.ts';

/**
 * One persisted action-card row — matches the columns of
 * plugin_clarity_pack_cdd6bda4bd.action_cards (migration 0015). source_issue_id
 * is the leaf issue UUID the card grounds in (key/dispatch only, never rendered
 * — NO_UUID_LEAK). decision_options is null unless the source issue poses an
 * explicit binary (D-08 conservative default).
 */
export type ActionCardRow = {
  company_id: string;
  source_issue_id: string;
  named_action: string;
  awaited_party: string;
  est_bucket: 'quick' | 'focused' | 'deep';
  action_kind: 'answer' | 'decide' | 'assign' | 'none';
  decision_options: string[] | null;
  content_hash: string;
  generated_at: string; // ISO
  compiled_by_agent_id: string;
  source_revisions: string[];
  tags: string[];
};

export type ActionCardsCacheCtx = {
  db: PluginDatabaseClient;
};

/**
 * Insert an action card. If (company_id, source_issue_id, content_hash) already
 * exists, the insert is a no-op (EDITOR-03 company-scoped idempotency). The
 * Postgres ON CONFLICT clause dedupes server-side — no read-then-write race.
 *
 * The two text[] columns (source_revisions, tags) are bound as array-literal
 * strings through $N::text[] casts (v0.6.5 Bug 2 — see the file header and
 * tldr-cache.ts). decision_options is bound as JSON text through a $N::jsonb
 * cast (null stays null).
 */
export async function upsertActionCard(
  ctx: ActionCardsCacheCtx,
  card: ActionCardRow,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.action_cards
       (company_id, source_issue_id, named_action, awaited_party, est_bucket, action_kind, decision_options, content_hash, generated_at, compiled_by_agent_id, source_revisions, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::text[], $12::text[])
     ON CONFLICT (company_id, source_issue_id, content_hash) DO NOTHING`,
    [
      card.company_id,
      card.source_issue_id,
      card.named_action,
      card.awaited_party,
      card.est_bucket,
      card.action_kind,
      card.decision_options === null ? null : JSON.stringify(card.decision_options),
      card.content_hash,
      card.generated_at,
      card.compiled_by_agent_id,
      toPgTextArrayLiteral(card.source_revisions),
      toPgTextArrayLiteral(card.tags),
    ],
  );
}

/**
 * Read the most-recent action card for (company_id, source_issue_id). Returns
 * null when no row exists yet — the caller degrades to the deterministic engine
 * line in that case (D-12), never blank, never fabricated.
 */
export async function getActionCardBySource(
  ctx: ActionCardsCacheCtx,
  companyId: string,
  sourceIssueId: string,
): Promise<ActionCardRow | null> {
  const rows = await ctx.db.query<ActionCardRow>(
    `SELECT company_id, source_issue_id, named_action, awaited_party, est_bucket, action_kind, decision_options, content_hash, generated_at, compiled_by_agent_id, source_revisions, tags
     FROM plugin_clarity_pack_cdd6bda4bd.action_cards
     WHERE company_id = $1 AND source_issue_id = $2
     ORDER BY generated_at DESC
     LIMIT 1`,
    [companyId, sourceIssueId],
  );
  return rows[0] ?? null;
}
