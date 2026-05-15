// src/worker/db/bulletins-repo.ts
//
// Plan 03-01 — typed CRUD repo for the four 0004_bulletin.sql tables.
// Mirrors the src/worker/db/tldr-cache.ts shape exactly: every function takes
// a `BulletinsRepoCtx` (just `{ db }`) as its first argument, and every SQL
// string is fully-qualified against the deterministic plugin namespace
// plugin_clarity_pack_cdd6bda4bd (02-01 Finding #4 — no template
// substitution).
//
// Idempotency: inserts that must dedupe use `ON CONFLICT ... DO NOTHING`
// keyed on the table's UNIQUE/PK constraint, so re-firing a compile is a
// server-side no-op (D-13). upsertDepartmentMembership is the one reconcile
// path: ON CONFLICT (company_id, employee_user_id) DO NOTHING so a
// manual-source override row always survives a reconcile re-run (D-20).
//
// Wave-1 scope: Plan 03-01 ships the repo + the bootstrap path used by the
// compile-bulletin no-op skeleton. Plans 03-02/03-03/03-04 build the real
// compile, verify, publish, errata and failed-compile-banner flows on top.

import type { PluginDatabaseClient } from '@paperclipai/plugin-sdk';

export type BulletinsRepoCtx = {
  db: PluginDatabaseClient;
};

export type CompileStatus =
  | 'pending'
  | 'attempting'
  | 'verified'
  | 'published'
  | 'failed';

export type BulletinRow = {
  cycle_number: number;
  company_id: string;
  next_due_at: string; // ISO
  compiled_at: string | null;
  verified_at: string | null;
  published_at: string | null;
  published_issue_id: string | null;
  compile_status: CompileStatus;
  content_hash: string;
  lineage_thread_json: unknown;
  // W3/W4: the verified structured BulletinDraft. Plan 03-02 writes it on
  // publish; Plan 03-03's bulletin-by-cycle handler returns it as typed props
  // so the UI never re-parses markdown.
  draft_json: unknown;
};

export type ErratumRow = {
  id: number;
  bulletin_cycle_number: number;
  added_at: string; // ISO
  added_by_user_id: string;
  body_md: string;
  applied_to_issue_comment_id: string | null;
};

export type DepartmentMembershipRow = {
  company_id: string;
  employee_user_id: string;
  department: string;
  source: 'reconcile' | 'manual';
  updated_at: string; // ISO
};

export type CompileFailureRow = {
  id: number;
  cycle_number: number;
  failed_at: string; // ISO
  reason: string;
  attempt_n: number;
  next_retry_at: string; // ISO
};

const BULLETIN_COLS =
  'cycle_number, company_id, next_due_at, compiled_at, verified_at, published_at, ' +
  'published_issue_id, compile_status, content_hash, lineage_thread_json, draft_json';

/**
 * Insert a bulletin row. cycle_number is the PK; when omitted (the Wave-1
 * bootstrap path), the next cycle number for the company is derived as
 * `max(cycle_number) + 1` (first ever = 1).
 *
 * The insert carries `ON CONFLICT (next_due_at, content_hash) DO NOTHING`
 * (D-13 idempotency). On a conflict the existing row is returned, so callers
 * always get a row back.
 */
export async function upsertBulletin(
  ctx: BulletinsRepoCtx,
  row: Omit<BulletinRow, 'cycle_number'> & { cycle_number?: number },
): Promise<BulletinRow> {
  let cycleNumber = row.cycle_number;
  if (cycleNumber === undefined || cycleNumber === null) {
    const maxRows = await ctx.db.query<{ max_cycle: number | null }>(
      `SELECT MAX(cycle_number) AS max_cycle
       FROM plugin_clarity_pack_cdd6bda4bd.bulletins
       WHERE company_id = $1`,
      [row.company_id],
    );
    cycleNumber = (maxRows[0]?.max_cycle ?? 0) + 1;
  }

  // HOST CONTRACT (SDK PluginDatabaseClient): ctx.db.query is SELECT-only and
  // ctx.db.execute returns only { rowCount } — no rows, so RETURNING is
  // unavailable. The write therefore goes through execute (no RETURNING) and
  // the row is read back via a SELECT. This is the same shape whether the
  // INSERT landed a new row or hit ON CONFLICT DO NOTHING.
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.bulletins
       (${BULLETIN_COLS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
     ON CONFLICT (next_due_at, content_hash) DO NOTHING`,
    [
      cycleNumber,
      row.company_id,
      row.next_due_at,
      row.compiled_at,
      row.verified_at,
      row.published_at,
      row.published_issue_id,
      row.compile_status,
      row.content_hash,
      JSON.stringify(row.lineage_thread_json ?? []),
      JSON.stringify(row.draft_json ?? {}),
    ],
  );

  // Read the row back (the freshly-inserted row, or the pre-existing one if
  // ON CONFLICT swallowed the insert) so callers always get a row.
  const existing = await ctx.db.query<BulletinRow>(
    `SELECT ${BULLETIN_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.bulletins
     WHERE next_due_at = $1 AND content_hash = $2
     LIMIT 1`,
    [row.next_due_at, row.content_hash],
  );
  return (
    existing[0] ?? {
      ...row,
      cycle_number: cycleNumber,
    }
  );
}

/**
 * Read a single bulletin row for a company. Pass a numeric cycle for an exact
 * lookup, or the literal `'latest'` for the most-recent cycle. Returns null
 * when no matching row exists.
 */
export async function getBulletinByCycle(
  ctx: BulletinsRepoCtx,
  companyId: string,
  cycle: number | 'latest',
): Promise<BulletinRow | null> {
  if (cycle === 'latest') {
    const rows = await ctx.db.query<BulletinRow>(
      `SELECT ${BULLETIN_COLS}
       FROM plugin_clarity_pack_cdd6bda4bd.bulletins
       WHERE company_id = $1
       ORDER BY cycle_number DESC
       LIMIT 1`,
      [companyId],
    );
    return rows[0] ?? null;
  }
  const rows = await ctx.db.query<BulletinRow>(
    `SELECT ${BULLETIN_COLS}
     FROM plugin_clarity_pack_cdd6bda4bd.bulletins
     WHERE company_id = $1 AND cycle_number = $2
     LIMIT 1`,
    [companyId, cycle],
  );
  return rows[0] ?? null;
}

/**
 * Read the most-recent `next_due_at` for a company. Returns null when no
 * bulletin row exists yet — the compile-bulletin job treats null as the
 * "first ever compile" bootstrap signal.
 */
export async function getNextDueAtForCompany(
  ctx: BulletinsRepoCtx,
  companyId: string,
): Promise<string | null> {
  const rows = await ctx.db.query<{ next_due_at: string }>(
    `SELECT next_due_at
     FROM plugin_clarity_pack_cdd6bda4bd.bulletins
     WHERE company_id = $1
     ORDER BY cycle_number DESC
     LIMIT 1`,
    [companyId],
  );
  return rows[0]?.next_due_at ?? null;
}

/**
 * Append an erratum. bulletin_errata is append-only (D-18) — there is no
 * update path. `id` and `added_at` are assigned by Postgres.
 *
 * HOST CONTRACT: the INSERT runs through ctx.db.execute (RETURNING is
 * unavailable through execute). The inserted row is then read back via a
 * SELECT scoped to the just-written (cycle, user, body) — bulletin_errata is
 * append-only so the most-recent matching row IS this insert.
 */
export async function appendErratum(
  ctx: BulletinsRepoCtx,
  row: Omit<ErratumRow, 'id' | 'added_at'>,
): Promise<ErratumRow> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.bulletin_errata
       (bulletin_cycle_number, added_by_user_id, body_md, applied_to_issue_comment_id)
     VALUES ($1, $2, $3, $4)`,
    [
      row.bulletin_cycle_number,
      row.added_by_user_id,
      row.body_md,
      row.applied_to_issue_comment_id,
    ],
  );

  const rows = await ctx.db.query<ErratumRow>(
    `SELECT id, bulletin_cycle_number, added_at, added_by_user_id, body_md,
            applied_to_issue_comment_id
     FROM plugin_clarity_pack_cdd6bda4bd.bulletin_errata
     WHERE bulletin_cycle_number = $1 AND added_by_user_id = $2 AND body_md = $3
     ORDER BY added_at DESC, id DESC
     LIMIT 1`,
    [row.bulletin_cycle_number, row.added_by_user_id, row.body_md],
  );
  return rows[0];
}

/**
 * List every erratum for one bulletin cycle, oldest first. The bulletin UI
 * renders these as the footer block below the main body.
 */
export async function listErrataByCycle(
  ctx: BulletinsRepoCtx,
  companyId: string,
  cycle: number,
): Promise<ErratumRow[]> {
  // company scoping is enforced via the bulletins join — cycle numbers are
  // per-company so a join keeps a cycle number from leaking across companies.
  return ctx.db.query<ErratumRow>(
    `SELECT e.id, e.bulletin_cycle_number, e.added_at, e.added_by_user_id,
            e.body_md, e.applied_to_issue_comment_id
     FROM plugin_clarity_pack_cdd6bda4bd.bulletin_errata e
     JOIN plugin_clarity_pack_cdd6bda4bd.bulletins b
       ON b.cycle_number = e.bulletin_cycle_number
     WHERE b.company_id = $1 AND e.bulletin_cycle_number = $2
     ORDER BY e.added_at ASC`,
    [companyId, cycle],
  );
}

/**
 * Record a compile failure. Append-only — `id` and `failed_at` are assigned
 * by Postgres. The failed-compile banner (D-22) reads the latest row via
 * getLatestCompileFailure, so this writer does not need to return the row.
 *
 * HOST CONTRACT: the INSERT runs through ctx.db.execute (a non-SELECT through
 * ctx.db.query is rejected by the real host). The sole caller
 * (compile-bulletin.ts) only `await`s this for its side effect, so it returns
 * void rather than reading the row back.
 */
export async function recordCompileFailure(
  ctx: BulletinsRepoCtx,
  row: Omit<CompileFailureRow, 'id' | 'failed_at'>,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures
       (cycle_number, reason, attempt_n, next_retry_at)
     VALUES ($1, $2, $3, $4)`,
    [row.cycle_number, row.reason, row.attempt_n, row.next_retry_at],
  );
}

/**
 * Read the most-recent compile failure for a company (joined through the
 * bulletins table so cycle numbers stay company-scoped). Returns null when
 * the company has never had a failed compile.
 */
export async function getLatestCompileFailure(
  ctx: BulletinsRepoCtx,
  companyId: string,
): Promise<CompileFailureRow | null> {
  const rows = await ctx.db.query<CompileFailureRow>(
    `SELECT f.id, f.cycle_number, f.failed_at, f.reason, f.attempt_n, f.next_retry_at
     FROM plugin_clarity_pack_cdd6bda4bd.bulletin_compile_failures f
     JOIN plugin_clarity_pack_cdd6bda4bd.bulletins b
       ON b.cycle_number = f.cycle_number
     WHERE b.company_id = $1
     ORDER BY f.failed_at DESC
     LIMIT 1`,
    [companyId],
  );
  return rows[0] ?? null;
}

/**
 * Upsert a department-membership row. The reconcile pass calls this for every
 * employee; `ON CONFLICT (company_id, employee_user_id) DO NOTHING` means a
 * row that already exists — including a manual-source override — is never
 * clobbered by a reconcile re-run (D-20).
 */
export async function upsertDepartmentMembership(
  ctx: BulletinsRepoCtx,
  row: DepartmentMembershipRow,
): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO plugin_clarity_pack_cdd6bda4bd.clarity_department_membership
       (company_id, employee_user_id, department, source, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, employee_user_id) DO NOTHING`,
    [
      row.company_id,
      row.employee_user_id,
      row.department,
      row.source,
      row.updated_at,
    ],
  );
}
