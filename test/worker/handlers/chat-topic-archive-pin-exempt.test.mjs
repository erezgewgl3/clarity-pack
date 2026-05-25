// test/worker/handlers/chat-topic-archive-pin-exempt.test.mjs
//
// Plan 05-08 Task 3 -- chat.topic.archive PIN_EXEMPT guard (D-20).
//
// A pinned topic (chat_topics.pinned_at IS NOT NULL) is EXEMPT from archive.
// The handler returns { error: 'PIN_EXEMPT', topicIssueId } and DOES NOT call
// setChatTopicArchived. Un-archive direction (archived=false) is unchanged.
//
// CTT-07 REGRESSION: across all PE-paths, ctx.issues.update is never called.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatTopicArchive } from '../../../src/worker/handlers/chat-topic-archive.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({
  pinnedAt = null,          // value returned by SELECT pinned_at
  topicMissing = false,     // simulate row absence (empty SELECT)
  pinnedReadThrows = false, // isChatTopicPinned SELECT fails
  archiveRepoThrows = false,
} = {}) {
  const handlers = new Map();
  const calls = [];
  const issueUpdateCalls = [];
  const issueClient = {
    async update(issueId, patch, companyId) {
      issueUpdateCalls.push({ issueId, patch, companyId });
      return { id: issueId, ...patch };
    },
  };
  const archiveUpdateCalls = [];

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: issueClient,
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return [{ opted_in_at: '2026-01-01T00:00:00.000Z' }];
        }
        // isChatTopicPinned SELECT pinned_at WHERE issue_id = $1 ...
        if (
          /SELECT\s+pinned_at\s+FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(
            sql,
          )
        ) {
          if (pinnedReadThrows) throw new Error('host db.query 503');
          if (topicMissing) return [];
          return [{ pinned_at: pinnedAt }];
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        if (archiveRepoThrows) throw new Error('host db.execute 503');
        if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_topics/i.test(sql)) {
          archiveUpdateCalls.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _calls: calls,
    _issueUpdateCalls: issueUpdateCalls,
    _archiveUpdateCalls: archiveUpdateCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function archiveParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    topicIssueId: 'issue-topic-1',
    archived: true,
    ...overrides,
  };
}

// ---- PE1 — pinned + archive=true -> PIN_EXEMPT, no setChatTopicArchived ---

test('PE1: archive=true on pinned topic -> { error: PIN_EXEMPT }; setChatTopicArchived NOT called', async () => {
  const ctx = makeCtx({ pinnedAt: '2026-05-25T12:00:00Z' });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  );
  assert.deepEqual(result, { error: 'PIN_EXEMPT', topicIssueId: 'issue-topic-1' });
  assert.equal(
    ctx._archiveUpdateCalls.length,
    0,
    'setChatTopicArchived must not run when PIN_EXEMPT fires',
  );
});

// ---- PE2 — pinned + archive=false -> proceeds normally -------------------

test('PE2: archive=false on pinned topic -> proceeds (un-archive direction unaffected)', async () => {
  const ctx = makeCtx({ pinnedAt: '2026-05-25T12:00:00Z' });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: false }),
  );
  assert.deepEqual(result, {
    ok: true,
    topicIssueId: 'issue-topic-1',
    archived: false,
  });
  assert.equal(ctx._archiveUpdateCalls.length, 1, 'setChatTopicArchived ran once');
});

// ---- PE3 — unpinned + archive=true -> existing happy path ----------------

test('PE3: archive=true on UNPINNED topic -> happy path { ok: true, archived: true }', async () => {
  const ctx = makeCtx({ pinnedAt: null });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  );
  assert.deepEqual(result, {
    ok: true,
    topicIssueId: 'issue-topic-1',
    archived: true,
  });
  assert.equal(ctx._archiveUpdateCalls.length, 1);
});

// ---- PE3b — row missing -> treated as unpinned (false), proceeds ---------

test('PE3b: archive=true on missing topic row -> treated as unpinned, proceeds (defensive)', async () => {
  const ctx = makeCtx({ topicMissing: true });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  );
  // isChatTopicPinned returns false when row is missing, so we proceed.
  assert.equal(result.ok, true);
});

// ---- PE4 — isChatTopicPinned throws -> ARCHIVE_FAILED + warn -------------

test('PE4: isChatTopicPinned throws -> { error: ARCHIVE_FAILED } + setChatTopicArchived NOT called', async () => {
  const ctx = makeCtx({ pinnedReadThrows: true });
  registerChatTopicArchive(ctx);
  const result = await ctx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  );
  assert.equal(result.error, 'ARCHIVE_FAILED');
  assert.equal(
    ctx._archiveUpdateCalls.length,
    0,
    'setChatTopicArchived must not run when pinned-read fails (deny-by-default)',
  );
});

// ---- PE5 — CTT-07 REGRESSION across all PE-paths -------------------------

test('PE5: ctx.issues.update is never called across PE1/PE2/PE3 paths (CTT-07 invariant)', async () => {
  const pinnedCtx = makeCtx({ pinnedAt: '2026-05-25T12:00:00Z' });
  registerChatTopicArchive(pinnedCtx);
  await pinnedCtx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  );  // PE1
  await pinnedCtx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: false }),
  ); // PE2
  assert.equal(pinnedCtx._issueUpdateCalls.length, 0);

  const unpinnedCtx = makeCtx({ pinnedAt: null });
  registerChatTopicArchive(unpinnedCtx);
  await unpinnedCtx._handlers.get('chat.topic.archive')(
    archiveParams({ archived: true }),
  ); // PE3
  assert.equal(unpinnedCtx._issueUpdateCalls.length, 0);
});
