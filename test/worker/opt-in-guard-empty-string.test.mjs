// test/worker/opt-in-guard-empty-string.test.mjs
//
// Plan 02-09 Task 1 — regression test pinning the empty-string handling in
// extractUserId. Plan 02-08 commit f1d911d fixed opt-in-guard to treat
// empty-string userId/viewerUserId as null (so usePluginData's racy bootstrap
// of `userId: ''` doesn't fail-closed for legitimate opted-in users). This
// test pins the contract.
//
// Also pins the negative assertion: get-viewer is NOT in EXEMPT_HANDLER_KEYS.
// The Plan 02-09 text proposed adding it; we deviated structurally (UI-side
// fetch resolver rather than worker handler), so the exempt list MUST NOT
// grow. This negative test locks the decision.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  EXEMPT_HANDLER_KEYS,
  wrapDataHandler,
  wrapActionHandler,
} from '../../src/worker/opt-in-guard.ts';

function makeCtx({ optedInUserIds = new Set() } = {}) {
  const dataRegistry = new Map();
  const actionRegistry = new Map();
  return {
    ctx: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      data: { register(key, fn) { dataRegistry.set(key, fn); } },
      actions: { register(key, fn) { actionRegistry.set(key, fn); } },
      db: {
        namespace: 'plugin_clarity_pack_cdd6bda4bd',
        async query(sql, params) {
          if (/clarity_user_prefs/.test(sql)) {
            const uid = params?.[0];
            if (optedInUserIds.has(uid)) return [{ opted_in_at: '2026-05-14T08:00:00Z' }];
            return [];
          }
          return [];
        },
        async execute() { return { rowCount: 0 }; },
      },
    },
    dataRegistry,
    actionRegistry,
  };
}

// ---------------------------------------------------------------------------
// EXEMPT_HANDLER_KEYS: get-viewer is NOT exempt (Plan 02-09 structural deviation)
// ---------------------------------------------------------------------------

test('EXEMPT_HANDLER_KEYS — get-viewer is NOT exempt (Plan 02-09 deviated to UI-side fetch)', () => {
  assert.equal(
    EXEMPT_HANDLER_KEYS.has('get-viewer'),
    false,
    'get-viewer must NOT be in EXEMPT_HANDLER_KEYS — Plan 02-09 deviated from the original plan text and uses a UI-side /api/auth/get-session fetch instead of a worker handler. If get-viewer ever reappears as a worker handler, the exempt list will need re-evaluation against the threat model.',
  );
});

test('EXEMPT_HANDLER_KEYS — list stays at exactly 3 entries (boot-time + self-prefs)', () => {
  // Locking the size prevents accidental exempt-list growth. Adding to this
  // list is a security-relevant decision and must come with a documented
  // threat-model justification.
  assert.equal(EXEMPT_HANDLER_KEYS.size, 3, 'EXEMPT_HANDLER_KEYS must contain exactly 3 entries');
});

// ---------------------------------------------------------------------------
// extractUserId: empty-string handling
// ---------------------------------------------------------------------------

test('wrapDataHandler — empty-string userId is treated as missing (returns OPT_IN_REQUIRED, opted-in row ignored)', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set(['']) });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'situation.snapshot', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = dataRegistry.get('situation.snapshot');
  // Even though we technically have an "opted-in row" for "", the guard should
  // NOT consider "" a valid identity — it falls through to "unidentified
  // caller" and refuses to serve.
  const result = await handler({ userId: '' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0);
});

test('wrapDataHandler — empty-string viewerUserId is treated as missing', async () => {
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set(['']) });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'flatten-blocker-chain', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = dataRegistry.get('flatten-blocker-chain');
  const result = await handler({ viewerUserId: '' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0);
});

test('wrapActionHandler — empty-string userId is treated as missing', async () => {
  const { ctx, actionRegistry } = makeCtx({ optedInUserIds: new Set(['']) });
  let innerCalls = 0;
  wrapActionHandler(ctx, 'ac-toggle', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = actionRegistry.get('ac-toggle');
  const result = await handler({ userId: '' });
  assert.deepEqual(result, { error: 'OPT_IN_REQUIRED' });
  assert.equal(innerCalls, 0);
});

test('wrapDataHandler — fallback chain: empty userId BUT real viewerUserId → identity recognized', async () => {
  // Confirms the legacy-name fallback path still works when the primary name
  // is empty. The 02-03c flatten-blocker-chain UI threads viewerUserId; the
  // empty-string defense must not break that flow.
  const { ctx, dataRegistry } = makeCtx({ optedInUserIds: new Set(['eric']) });
  let innerCalls = 0;
  wrapDataHandler(ctx, 'flatten-blocker-chain', async () => {
    innerCalls += 1;
    return { ok: true };
  });
  const handler = dataRegistry.get('flatten-blocker-chain');
  const result = await handler({ userId: '', viewerUserId: 'eric' });
  assert.equal(innerCalls, 1, 'inner fn must run when viewerUserId resolves the identity');
  assert.deepEqual(result, { ok: true });
});
