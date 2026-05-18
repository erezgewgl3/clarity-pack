// test/worker/chat/chat-pin.test.mjs
//
// Plan 04-04 Task C RED — chat.pin action handler (CHAT-09 / D-13).
//
// chat.pin toggles the chat-metadata `pinned` flag on a chat_messages row via
// updateChatMessagePinned. Pin is purely a Clarity Pack concept — there is no
// host pin primitive (D-13). The handler is the minimal action-handler shape:
// validate params, ctx.db.execute the UPDATE, return { ok: true }.
//
// updateChatMessagePinned is company-scoped (WHERE message_uuid=$2 AND
// company_id=$3) — a pin never crosses companies (T-04-16).
//
// Wrapped via opt-in-guard's wrapActionHandler.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerChatPin } from '../../../src/worker/handlers/chat-pin.ts';
import { wrapHostFaithfulDb } from '../../helpers/host-faithful-db.mjs';

function makeCtx({ optedIn = true } = {}) {
  const handlers = new Map();
  const updateCalls = [];

  const ctx = {
    logger: { warn() {}, info() {} },
    actions: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    db: {
      async query(sql) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute(sql, params) {
        if (/UPDATE .*chat_messages/i.test(sql) && /pinned/i.test(sql)) {
          updateCalls.push({ sql, params });
        }
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
    _updateCalls: updateCalls,
  };
  ctx.db = wrapHostFaithfulDb(ctx.db);
  return ctx;
}

function pinParams(overrides = {}) {
  return {
    companyId: 'co-1',
    userId: 'user-eric',
    messageUuid: 'uuid-msg-1',
    pinned: true,
    ...overrides,
  };
}

test('chat.pin: handler registers under key chat.pin', () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  assert.ok(ctx._handlers.has('chat.pin'));
});

test('chat.pin: toggles chat_messages.pinned and returns { ok: true }', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(pinParams({ pinned: true }));

  assert.equal(ctx._updateCalls.length, 1);
  // updateChatMessagePinned binds [pinned, messageUuid, companyId].
  assert.equal(ctx._updateCalls[0].params[0], true);
  assert.equal(ctx._updateCalls[0].params[1], 'uuid-msg-1');
  assert.equal(ctx._updateCalls[0].params[2], 'co-1');
  assert.equal(result.ok, true);
});

test('chat.pin: can un-pin (pinned: false)', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(pinParams({ pinned: false }));
  assert.equal(ctx._updateCalls[0].params[0], false);
  assert.equal(result.ok, true);
});

test('chat.pin: missing messageUuid → throws (action-handler convention)', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.messageUuid;
  await assert.rejects(
    () => ctx._handlers.get('chat.pin')(params),
    /messageUuid/i,
  );
});

test('chat.pin: missing companyId → throws', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.companyId;
  await assert.rejects(
    () => ctx._handlers.get('chat.pin')(params),
    /companyId/i,
  );
});

test('chat.pin: missing pinned flag → throws', async () => {
  const ctx = makeCtx();
  registerChatPin(ctx);
  const params = pinParams();
  delete params.pinned;
  await assert.rejects(
    () => ctx._handlers.get('chat.pin')(params),
    /pinned/i,
  );
});

test('chat.pin: opted-out caller → OPT_IN_REQUIRED, no UPDATE', async () => {
  const ctx = makeCtx({ optedIn: false });
  registerChatPin(ctx);
  const result = await ctx._handlers.get('chat.pin')(pinParams());
  assert.equal(result.error, 'OPT_IN_REQUIRED');
  assert.equal(ctx._updateCalls.length, 0);
});
