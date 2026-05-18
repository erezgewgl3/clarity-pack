// test/worker/chat/chat-search.test.mjs
//
// Plan 04-04 Task B RED — chat.search data handler (CHAT-08).
//
// chat.search ILIKE-matches a free-text term over public.issue_comments JOINed
// THROUGH plugin_clarity_pack_cdd6bda4bd.chat_topics — so only comments on
// chat-topic issues are searchable (T-04-17 — non-chat comments are
// structurally excluded), and the JOIN is company-scoped via t.company_id = $1
// (T-04-14 — no cross-company leak).
//
// Security domain (T-04-13): the user term is a $N bound parameter, AND it is
// passed through escapeLike(), which backslash-escapes %, _ and \ — so a term
// containing a % or _ matches that character LITERALLY, not as a wildcard.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatSearch } from '../../../src/worker/handlers/chat-search.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ optedIn = true, queryThrows = false } = {}) {
  const handlers = new Map();
  const searchCalls = [];

  const ctx = {
    logger: { warn() {}, info() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    db: {
      async query(sql, params) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        if (/issue_comments/i.test(sql)) {
          searchCalls.push({ sql, params });
          if (queryThrows) throw new Error('host query 503');
          return [
            {
              id: 'c-1',
              issue_id: 'i-1',
              body: 'matched comment body',
              created_at: '2026-01-02T00:00:00.000Z',
            },
          ];
        }
        return [];
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _searchCalls: searchCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function searchParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    term: 'pricing',
    ...overrides,
  };
}

test('chat.search: handler registers under key chat.search', () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  assert.ok(ctx._handlers.has('chat.search'));
});

test('chat.search: returns ILIKE-matched chat comments', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  const result = await ctx._handlers.get('chat.search')(searchParams());

  assert.equal(result.kind, 'search-results');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].commentId, 'c-1');
  assert.equal(result.results[0].issueId, 'i-1');
});

test('chat.search: query uses ILIKE and JOINs through chat_topics company-scoped', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  await ctx._handlers.get('chat.search')(searchParams());

  const call = ctx._searchCalls[0];
  assert.match(call.sql, /ILIKE/i, 'the query must use ILIKE');
  assert.match(call.sql, /chat_topics/i, 'the query must JOIN through chat_topics');
  assert.match(call.sql, /company_id = \$1/i, 'the JOIN must be company-scoped');
  // companyId is the first bound param, the escaped term the second.
  assert.equal(call.params[0], 'co-1');
});

test('chat.search: the term is wrapped %term% as a bound parameter', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  await ctx._handlers.get('chat.search')(searchParams({ term: 'pricing' }));
  const call = ctx._searchCalls[0];
  assert.equal(call.params[1], '%pricing%');
});

test('chat.search: a term containing % matches it literally (escapeLike)', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  await ctx._handlers.get('chat.search')(searchParams({ term: '50%' }));
  const call = ctx._searchCalls[0];
  // the % in the user term is backslash-escaped so it is a literal, not a
  // wildcard; the surrounding %...% are the real wildcards.
  assert.equal(call.params[1], '%50\\%%');
});

test('chat.search: a term containing _ matches it literally (escapeLike)', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  await ctx._handlers.get('chat.search')(searchParams({ term: 'a_b' }));
  const call = ctx._searchCalls[0];
  assert.equal(call.params[1], '%a\\_b%');
});

test('chat.search: a term containing a backslash escapes it too', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  await ctx._handlers.get('chat.search')(searchParams({ term: 'a\\b' }));
  const call = ctx._searchCalls[0];
  assert.equal(call.params[1], '%a\\\\b%');
});

test('chat.search: missing companyId → { error: COMPANY_ID_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  const params = searchParams();
  delete params.companyId;
  const result = await ctx._handlers.get('chat.search')(params);
  assert.equal(result.error, 'COMPANY_ID_REQUIRED');
});

test('chat.search: missing or empty term → { error: TERM_REQUIRED }', async () => {
  const ctx = makeCtx();
  registerChatSearch(ctx);
  const r1 = await ctx._handlers.get('chat.search')(searchParams({ term: '' }));
  assert.equal(r1.error, 'TERM_REQUIRED');
  const params = searchParams();
  delete params.term;
  const r2 = await ctx._handlers.get('chat.search')(params);
  assert.equal(r2.error, 'TERM_REQUIRED');
});

test('chat.search: opted-out caller → OPT_IN_REQUIRED', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatSearch(ctx);
  const result = await ctx._handlers.get('chat.search')(searchParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
});

test('chat.search: query failure → { error: SEARCH_FAILED }', async () => {
  const ctx = makeCtx({ queryThrows: true });
  registerChatSearch(ctx);
  const result = await ctx._handlers.get('chat.search')(searchParams());
  assert.equal(result.error, 'SEARCH_FAILED');
});
