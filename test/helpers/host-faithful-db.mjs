// test/helpers/host-faithful-db.mjs
//
// Host-faithful `ctx.db` wrapper for plugin worker tests.
//
// The real Paperclip host's `PluginDatabaseClient` (SDK types.d.ts:369-377)
// enforces two hard rules that a naive in-memory fake does NOT:
//
//   - `ctx.db.query(sql, params)` — SELECT ONLY, and exactly ONE statement.
//     A non-SELECT (or a second statement) throws
//     `JsonRpcCallError: ctx.db.query only allows SELECT statements`.
//   - `ctx.db.execute(sql, params)` — INSERT / UPDATE / DELETE in the plugin
//     namespace ONLY. A SELECT or any DDL statement is rejected. Returns
//     `{ rowCount }` and NEVER rows (so `RETURNING` results are unavailable).
//
// The 2026-05-15 Countermoves drill failed because the bulletin compile path
// ran INSERT statements through `ctx.db.query`. Permissive test fakes never
// caught it — `query` happily ran the INSERT against an in-memory array.
//
// `wrapHostFaithfulDb(fakeDb)` decorates an existing in-memory fake `db` so
// every `query`/`execute` call is classified BEFORE it reaches the fake. A
// write-via-query (or a select-via-execute, or DDL-via-execute) now throws in
// `node --test` — exactly as the live host would — instead of silently
// passing and only failing on a VPS reinstall.
//
// The SQL tokenizer + classifier are ported VERBATIM from
// test/migrations/ddl-prefix-validator.test.mjs, which itself ports the host's
// `server/src/services/plugin-database.ts` logic. Keeping one shared port
// means a host-validator change is fixed in exactly one place.

// --- Verbatim ports from server/src/services/plugin-database.ts -----------

// splitSqlStatements: quote- and comment-aware `;` splitter.
export function splitSqlStatements(input) {
  const statements = [];
  let start = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ';') {
      const statement = input.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }

  const trailing = input.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

// stripSqlForKeywordScan: strips string/identifier literals + comments so the
// leading keyword can be classified without quoted text interfering.
function stripSqlForKeywordScan(input) {
  return input
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function normaliseSql(input) {
  return stripSqlForKeywordScan(input).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Leading-keyword families. WITH (CTE) statements classify by their final verb. */
const DDL_PREFIX = /^(create|alter|drop|truncate|comment)\b/;
const SELECT_PREFIX = /^(select|with)\b/;
const DML_PREFIX = /^(insert|update|delete)\b/;

/**
 * Classify a normalized SQL string into 'select' | 'dml' | 'ddl' | 'other'.
 * A `WITH ... SELECT` CTE counts as 'select'; a `WITH ... INSERT/UPDATE/DELETE`
 * counts as 'dml'.
 */
function classify(normalized) {
  if (DDL_PREFIX.test(normalized)) return 'ddl';
  if (DML_PREFIX.test(normalized)) return 'dml';
  if (SELECT_PREFIX.test(normalized)) {
    // A data-modifying CTE: `WITH x AS (...) INSERT ...`. Look for the verb
    // that follows the CTE definitions.
    if (/\b(insert\s+into|update\s+|delete\s+from)\b/.test(normalized)) {
      return 'dml';
    }
    return 'select';
  }
  return 'other';
}

/**
 * Decorate an in-memory fake `db` so it enforces the real host's query/execute
 * contract. Pass the same fake `db` object the test already builds; the
 * returned object has the identical `query`/`execute`/`namespace` surface but
 * throws host-faithfully on a contract violation.
 *
 * @param {{ query?: Function, execute?: Function, namespace?: string }} fakeDb
 * @returns {{ query: Function, execute: Function, namespace: string }}
 */
export function wrapHostFaithfulDb(fakeDb) {
  if (!fakeDb || typeof fakeDb !== 'object') {
    throw new TypeError('wrapHostFaithfulDb: expected a fake db object');
  }

  return {
    namespace: fakeDb.namespace ?? 'plugin_clarity_pack_cdd6bda4bd',

    async query(sql, params) {
      if (typeof sql !== 'string' || sql.trim() === '') {
        throw new Error('JsonRpcCallError: ctx.db.query requires a SQL string');
      }
      const statements = splitSqlStatements(sql);
      if (statements.length !== 1) {
        throw new Error(
          `JsonRpcCallError: ctx.db.query allows exactly one statement ` +
            `(got ${statements.length})`,
        );
      }
      const kind = classify(normaliseSql(statements[0]));
      if (kind !== 'select') {
        throw new Error(
          `JsonRpcCallError: ctx.db.query only allows SELECT statements ` +
            `(got ${kind}). Use ctx.db.execute for writes.`,
        );
      }
      if (typeof fakeDb.query !== 'function') {
        throw new Error('host-faithful db: underlying fake has no query()');
      }
      return fakeDb.query(sql, params);
    },

    async execute(sql, params) {
      if (typeof sql !== 'string' || sql.trim() === '') {
        throw new Error('JsonRpcCallError: ctx.db.execute requires a SQL string');
      }
      const statements = splitSqlStatements(sql);
      if (statements.length !== 1) {
        throw new Error(
          `JsonRpcCallError: ctx.db.execute allows exactly one statement ` +
            `(got ${statements.length})`,
        );
      }
      const kind = classify(normaliseSql(statements[0]));
      if (kind === 'select') {
        throw new Error(
          'JsonRpcCallError: ctx.db.execute does not allow SELECT statements. ' +
            'Use ctx.db.query for reads.',
        );
      }
      if (kind === 'ddl') {
        throw new Error(
          'JsonRpcCallError: ctx.db.execute does not allow DDL statements. ' +
            'Schema changes belong in migrations/*.sql.',
        );
      }
      if (kind !== 'dml') {
        throw new Error(
          `JsonRpcCallError: ctx.db.execute only allows INSERT/UPDATE/DELETE ` +
            `(got ${kind}).`,
        );
      }
      if (typeof fakeDb.execute !== 'function') {
        throw new Error('host-faithful db: underlying fake has no execute()');
      }
      const result = await fakeDb.execute(sql, params);
      // The host's execute() returns only { rowCount } — never rows. Normalize
      // so a test fake that returns extra fields cannot let a caller depend on
      // RETURNING-style data that the real host would not provide.
      return { rowCount: result?.rowCount ?? 0 };
    },
  };
}
