// test/worker/chat/chat-pin.test.mjs
//
// Plan 04-04 Task C / 04-05 host-contract audit — chat.pin (CHAT-09 / D-13).
//
// GAP 12 audit fix. "Pin a message" is a Clarity Pack concept only — there is
// no host pin primitive (D-13). The pin button sits on AGENT messages, and
// PITFALL #4 says the chat_messages side table is operator-write-only — an
// agent comment has NO chat_messages row. The reworked handler takes
// `commentId` + `topicIssueId` and pinChatMessageByCommentId:
//   - UPDATEs an existing row (the operator-message path), or
//   - when the UPDATE matches 0 rows (an agent comment), UPSERTs a pin-only
//     chat_messages row with sender_kind 'agent' and no body.
//
// The fake db below is host-faithful: it models a chat_messages store keyed by
// comment_id, returns rowCount honestly from UPDATE, and runs the INSERT ...
// ON CONFLICT DO UPDATE branch — so the agent-comment path is exercised exactly
// as it would run live.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatPin } from '../../../src/worker/handlers/chat-pin.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ optedIn = true, seedMessages = [] } = {}) {
  const handlers = new Map();
  const messages = [...seedMessages]; // chat_messages rows
  const calls = [];

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    db: {
      async query(sql, params) {
        calls.push({ kind: 'query', sql, params });
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        // getChatMessageByCommentId — WHERE comment_id = $1 AND company_id = $2
        if (/FROM\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages/i.test(sql)) {
          const [commentId, companyId] = params;
          return messages.filter(
            (m) => m.comment_id === commentId && m.company_id === companyId,
          );
        }
        return [];
      },
      async execute(sql, params) {
        calls.push({ kind: 'execute', sql, params });
        // UPDATE ... SET pinned = $1 WHERE comment_id = $2 AND company_id = $3
        if (/UPDATE\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages/i.test(sql)) {
          const [pinned, commentId, companyId] = params;
          const row = messages.find(
            (m) => m.comment_id === commentId && m.company_id === companyId,
          );
          if (row) row.pinned = pinned;
          return { rowCount: row ? 1 : 0 };
        }
        // INSERT ... ON CONFLICT (message_uuid) DO UPDATE SET pinned = EXCLUDED.pinned
        if (/INSERT\s+INTO\s+plugin_clarity_pack_cdd6bda4bd\.chat_messages/i.test(sql)) {
          const [
            message_uuid,
            company_id,
            topic_issue_id,
            comment_id,
            sender_kind,
            supersedes_uuid,
            pinned,
            sent_at,
          ] = params;
          const existing = messages.find((m) => m.message_uuid === message_uuid);
          if (existing) {
            existing.pinned = pinned; // ON CONFLICT DO UPDATE SET pinned
          } else {
            messages.push({
              message_uuid,
              company_id,
              topic_issue_id,
              comment_id,
              sender_kind,
              supersedes_uuid,
              pinned,
              sent_at,
            });
          }
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      },
    },
    _handlers: handlers,
    _messages: messages,
    _calls: calls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function pinParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    commentId: 'c-1',
    topicIssueId: 'issue-topic-1',
    pinned: true,
    ...overrides,
  };
}

const OPERATOR_MSG = {
  message_uuid: 'uuid-op-1',
  company_id: 'co-1',
  topic_issue_id: 'issue-topic-1',
  comment_id: 'c-op-1',
  sender_kind: 'user',
  supersedes_uuid: null,
  pinned: false,
  sent_at: '2026-01-01T00:00:00.000Z',
};

test('chat.pin: handler registers under key chat.pin', () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  assert.ok(ctx._handlers.has('chat.pin'));
});

// GAP 12 — the message being pinned is an AGENT comment with NO chat_messages
// row. The UPDATE matches 0 rows; pinChatMessageByCommentId must UPSERT a
// pin-only row (sender_kind 'agent') so the pin lands.
test('chat.pin: pins an AGENT comment with no chat_messages row — UPSERTs a pin row (GAP 12)', async () => {
  const ctx = makeCtx({ seedMessages: [] });
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(
    pinParams({ commentId: 'c-agent-1', pinned: true }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.commentId, 'c-agent-1');
  assert.equal(result.pinned, true);
  // a pin-only row now exists for the agent comment
  const row = ctx._messages.find((m) => m.comment_id === 'c-agent-1');
  assert.ok(row, 'a chat_messages row was UPSERTed for the agent comment');
  assert.equal(row.sender_kind, 'agent');
  assert.equal(row.pinned, true);
  assert.equal(row.topic_issue_id, 'issue-topic-1');
});

test('chat.pin: pins an OPERATOR message by updating its existing row', async () => {
  const ctx = makeCtx({ seedMessages: [{ ...OPERATOR_MSG }] });
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(
    pinParams({ commentId: 'c-op-1', pinned: true }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.pinned, true);
  // the existing operator row was updated in place — no new row inserted
  assert.equal(ctx._messages.length, 1);
  assert.equal(ctx._messages[0].pinned, true);
  assert.equal(ctx._messages[0].sender_kind, 'user');
});

test('chat.pin: can un-pin (pinned: false)', async () => {
  const ctx = makeCtx({ seedMessages: [{ ...OPERATOR_MSG, pinned: true }] });
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(
    pinParams({ commentId: 'c-op-1', pinned: false }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.pinned, false);
  assert.equal(ctx._messages[0].pinned, false);
});

test('chat.pin: re-pinning the same agent comment is idempotent (ON CONFLICT DO UPDATE)', async () => {
  const ctx = makeCtx({ seedMessages: [] });
  registerChatPin(ctx);
  await ctx._handlers.get('chat.pin')(pinParams({ commentId: 'c-agent-1', pinned: true }));
  await ctx._handlers.get('chat.pin')(pinParams({ commentId: 'c-agent-1', pinned: true }));
  // still exactly one row for the agent comment
  const rows = ctx._messages.filter((m) => m.comment_id === 'c-agent-1');
  assert.equal(rows.length, 1, 'no duplicate row — the conflict updated in place');
  assert.equal(rows[0].pinned, true);
});

test('chat.pin: missing commentId → throws (action-handler convention)', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.commentId;
  await assert.rejects(() => ctx._handlers.get('chat.pin')(params), /commentId/i);
});

test('chat.pin: missing topicIssueId → throws', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.topicIssueId;
  await assert.rejects(() => ctx._handlers.get('chat.pin')(params), /topicIssueId/i);
});

test('chat.pin: missing companyId → throws', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.companyId;
  await assert.rejects(() => ctx._handlers.get('chat.pin')(params), /companyId/i);
});

test('chat.pin: missing pinned flag → throws', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.pinned;
  await assert.rejects(() => ctx._handlers.get('chat.pin')(params), /pinned/i);
});

test('chat.pin: opted-out caller → OPT_IN_REQUIRED, no UPDATE/INSERT', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(pinParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  const writes = ctx._calls.filter((c) => c.kind === 'execute');
  assert.equal(writes.length, 0, 'no chat_messages write for an opted-out caller');
});
