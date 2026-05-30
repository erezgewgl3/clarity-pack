// test/worker/handlers/resolve-refs-hide-operation.test.mjs
//
// Plan 250530 v1.1.5 — resolve-refs flags clarity-pack internal operation
// issues with `hiddenAsRef: true` so the Reader's RefChip degrades them to
// plain text. The operator's BEAAA-1000 feedback (2026-05-30): the TL;DR was
// full of references to BEAAA-1168 / BEAAA-1086 / BEAAA-1103 whose host titles
// are agent-generated bookkeeping strings (e.g. "Compile TL;DR — <UUID>") —
// chipping these polluted the prose with noise. Filtering them out at the
// resolver level is the structural fix.
//
// The originKind check: `i.originKind` starts with the shared constant
// `OPERATION_ORIGIN_KIND_PREFIX = "plugin:clarity-pack:operation:"`. Every
// operation kind (tldr-compile, bulletin-compile, bulletin-gloss, sign-off,
// etc.) carries this prefix per agent-task-delivery.ts.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { registerResolveRefs } from '../../../src/worker/handlers/resolve-refs.ts';
import { OPERATION_ORIGIN_KIND_PREFIX } from '../../../src/worker/agents/agent-task-delivery.ts';

/** Build a minimal ctx that wires resolve-refs with two stub Issues — one a
 *  normal user/agent-authored task, one a clarity-pack operation issue. The
 *  resolver fetches each via ctx.issues.get(identifier, companyId). */
function makeCtx({ optedIn = true } = {}) {
  const handlers = new Map();
  const ctx = {
    logger: { warn() {}, info() {}, debug() {} },
    data: {
      register(key, fn) {
        handlers.set(key, fn);
      },
    },
    issues: {
      async get(id /*, companyId */) {
        if (id === 'BEAAA-200') {
          // A normal task issue — no plugin operation originKind.
          return {
            id: 'uuid-200',
            identifier: 'BEAAA-200',
            title: 'Reconcile cents-per-action ladder',
            status: 'in_progress',
            assigneeUserId: 'user-uuid-actuary',
            description: 'A real task body.',
            originKind: 'user_created',
          };
        }
        if (id === 'BEAAA-1168') {
          // The exact pattern that motivated this fix: an Editor-Agent compile-
          // tracking operation issue whose title contains a UUID.
          return {
            id: 'uuid-1168',
            identifier: 'BEAAA-1168',
            title: 'Compile TL;DR — a119b8e7-d79e-404e-9e66-105a47e4d3b7',
            status: 'done',
            assigneeUserId: 'editor-agent-uuid',
            description: 'compile-result document storage',
            originKind: `${OPERATION_ORIGIN_KIND_PREFIX}tldr-compile`,
          };
        }
        return null;
      },
      async list() {
        // No fallback needed — every requested id resolves via `get` above.
        return [];
      },
    },
    db: {
      async query(sql /*, params */) {
        if (/clarity_user_prefs/i.test(sql)) {
          return optedIn ? [{ opted_in_at: '2026-01-01T00:00:00.000Z' }] : [];
        }
        return [];
      },
      async execute() {
        return { rowCount: 1 };
      },
    },
    _handlers: handlers,
  };
  return ctx;
}

test('resolve-refs: a NORMAL task issue gets hiddenAsRef:false (chip renders normally)', async () => {
  const ctx = makeCtx();
  registerResolveRefs(ctx);
  const handler = ctx._handlers.get('resolve-refs');
  assert.ok(handler, 'resolve-refs handler must be registered');
  const result = await handler({
    ids: ['BEAAA-200'],
    userId: 'user-eric',
    companyId: 'co-1',
  });
  assert.ok(Array.isArray(result), 'result is an array');
  const card = result.find((r) => r.id === 'BEAAA-200');
  assert.ok(card, 'BEAAA-200 card is returned');
  assert.equal(card.title, 'Reconcile cents-per-action ladder');
  assert.notEqual(card.hiddenAsRef, true, 'a normal task is NOT hidden — chip renders normally');
});

test('resolve-refs: a clarity-pack OPERATION issue gets hiddenAsRef:true (chip degrades to plain text)', async () => {
  const ctx = makeCtx();
  registerResolveRefs(ctx);
  const handler = ctx._handlers.get('resolve-refs');
  const result = await handler({
    ids: ['BEAAA-1168'],
    userId: 'user-eric',
    companyId: 'co-1',
  });
  const card = result.find((r) => r.id === 'BEAAA-1168');
  assert.ok(card, 'BEAAA-1168 card is returned');
  assert.equal(card.hiddenAsRef, true, 'an operation issue is flagged hiddenAsRef:true');
});

test('resolve-refs: mixed ids — normal AND operation in one batch are flagged correctly', async () => {
  const ctx = makeCtx();
  registerResolveRefs(ctx);
  const handler = ctx._handlers.get('resolve-refs');
  const result = await handler({
    ids: ['BEAAA-200', 'BEAAA-1168'],
    userId: 'user-eric',
    companyId: 'co-1',
  });
  const byId = new Map(result.map((r) => [r.id, r]));
  assert.notEqual(byId.get('BEAAA-200').hiddenAsRef, true, 'normal stays visible');
  assert.equal(byId.get('BEAAA-1168').hiddenAsRef, true, 'operation stays hidden');
});

test('resolve-refs: hiddenAsRef is opt-IN per card; absent ownerName / null originKind do NOT trip it', async () => {
  // An issue with originKind=null (or missing) is treated as a normal user
  // task — NOT hidden. This protects host issues that omit the field.
  const ctx = makeCtx();
  ctx.issues.get = async (id) => {
    if (id !== 'BEAAA-300') return null;
    return {
      id: 'uuid-300',
      identifier: 'BEAAA-300',
      title: 'Some real task',
      status: 'todo',
      assigneeUserId: null,
      description: 'body',
      originKind: null,
    };
  };
  registerResolveRefs(ctx);
  const handler = ctx._handlers.get('resolve-refs');
  const result = await handler({
    ids: ['BEAAA-300'],
    userId: 'user-eric',
    companyId: 'co-1',
  });
  const card = result.find((r) => r.id === 'BEAAA-300');
  assert.ok(card);
  assert.notEqual(card.hiddenAsRef, true, 'a null originKind is NOT treated as an operation issue');
});

test('resolve-refs: hiddenAsRef matches ANY operation kind (tldr-compile, bulletin-compile, sign-off, etc.) — prefix check, not exact match', async () => {
  const ctx = makeCtx();
  ctx.issues.get = async (id) => {
    const kindByIdent = {
      'BEAAA-401': `${OPERATION_ORIGIN_KIND_PREFIX}tldr-compile`,
      'BEAAA-402': `${OPERATION_ORIGIN_KIND_PREFIX}bulletin-compile`,
      'BEAAA-403': `${OPERATION_ORIGIN_KIND_PREFIX}bulletin-gloss`,
      'BEAAA-404': `${OPERATION_ORIGIN_KIND_PREFIX}sign-off`,
      'BEAAA-405': `${OPERATION_ORIGIN_KIND_PREFIX}future-kind-not-yet-shipped`,
    };
    if (!(id in kindByIdent)) return null;
    return {
      id: `uuid-${id}`,
      identifier: id,
      title: `${id} stub title`,
      status: 'done',
      assigneeUserId: null,
      description: '',
      originKind: kindByIdent[id],
    };
  };
  registerResolveRefs(ctx);
  const handler = ctx._handlers.get('resolve-refs');
  const result = await handler({
    ids: ['BEAAA-401', 'BEAAA-402', 'BEAAA-403', 'BEAAA-404', 'BEAAA-405'],
    userId: 'user-eric',
    companyId: 'co-1',
  });
  for (const card of result) {
    assert.equal(card.hiddenAsRef, true, `${card.id} (originKind under the operation prefix) must be hidden`);
  }
});
