// test/worker/agents/editor-heartbeat-recursion.test.mjs
//
// Regression tests for the v0.6.5 fix of debug session
// .planning/debug/tldr-heartbeat-recursion.md — Bug 1.
//
// THE BUG. `handleEditorHeartbeat` buckets `issue.created` / `issue.updated`
// events and `compileTldr`s EVERY issue. `compileTldr` → `deliveryLlmAdapter`
// → `deliverAgentTask` CREATES a `tldr-compile` OPERATION ISSUE. That operation
// issue is itself an `issue.created` event → the next heartbeat TL;DR-compiles
// IT → creates another `tldr-compile` operation issue → unbounded. The live
// 2026-05-17 v0.6.4 cycle-2 drill produced 17+ concurrent Editor-Agent runs and
// `originId=tldr-<prev-operation-issue-id>` chains in the worker log; halted
// only by uninstalling the plugin.
//
// It was LATENT pre-v0.6.4 — the heartbeat crashed instantly on a `ctx.issue`
// typo, an accidental circuit breaker. The v0.6.4 typo fix un-crashed the path
// without adding a guard and unleashed the recursion.
//
// THE FIX. `handleEditorHeartbeat` skips any issue whose `originKind` is in the
// `plugin:clarity-pack:operation:` namespace — the plugin must never
// TL;DR-compile its own operation plumbing.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  handleEditorHeartbeat,
  isOwnOperationIssue,
} from '../../../src/worker/agents/editor.ts';
import {
  OPERATION_ORIGIN_KIND_PREFIX,
  operationOriginKind,
} from '../../../src/worker/agents/agent-task-delivery.ts';
import { resetCircuitBreakerState } from '../../../src/worker/agents/circuit-breaker.ts';

const EDITOR_UUID = '22222222-2222-4222-8222-222222222222';

/**
 * A heartbeat ctx whose `issues.get` returns whatever issue the test seeds.
 * `issues.create` is tracked AND throws — if the recursion guard fails, the
 * test sees a `create` call (the operation-issue spawn) AND a fast failure
 * instead of a hung 300s delivery poll.
 *
 * A minimal `db` is wired: `query` always returns `[]` (no cached TL;DR — so
 * `compileTldr`'s EDITOR-03 cache check never short-circuits before the LLM /
 * operation-issue handoff), `execute` is a no-op.
 */
function makeCtx(issuesById) {
  const infoLogs = [];
  const createCalls = [];
  const ctx = {
    logger: {
      info: (msg, meta) => infoLogs.push({ msg, meta }),
      warn() {},
      error() {},
    },
    db: {
      namespace: 'plugin_clarity_pack_cdd6bda4bd',
      async query() {
        return []; // no cached TL;DR — compileTldr proceeds to the LLM call
      },
      async execute() {
        return { rowCount: 0 };
      },
    },
    issues: {
      async get(id) {
        return issuesById[id] ?? null;
      },
      async listComments() {
        return [];
      },
      async create(input) {
        createCalls.push(input);
        // A spawned operation issue would be created here. Throw so a guard
        // miss fails fast instead of entering the 300s readback poll.
        throw new Error('operation-issue create reached — recursion guard MISSED');
      },
      async list() {
        return [];
      },
      async requestWakeup() {
        return { queued: true };
      },
    },
  };
  return { ctx, infoLogs, createCalls };
}

test('Bug 1: isOwnOperationIssue is true for a plugin operation issue, false otherwise', () => {
  assert.equal(
    isOwnOperationIssue({ originKind: operationOriginKind('tldr-compile') }),
    true,
    'a tldr-compile operation issue is recognised as the plugin\'s own',
  );
  assert.equal(
    isOwnOperationIssue({ originKind: operationOriginKind('bulletin-compile') }),
    true,
    'a bulletin-compile operation issue is recognised as the plugin\'s own',
  );
  assert.equal(
    isOwnOperationIssue({ originKind: `${OPERATION_ORIGIN_KIND_PREFIX}anything` }),
    true,
    'any plugin:clarity-pack:operation:* originKind matches',
  );
  assert.equal(
    isOwnOperationIssue({ originKind: 'user' }),
    false,
    'an ordinary human-board issue is NOT a plugin operation issue',
  );
  assert.equal(
    isOwnOperationIssue({ originKind: null }),
    false,
    'a null originKind is not a plugin operation issue',
  );
  assert.equal(
    isOwnOperationIssue({}),
    false,
    'a missing originKind is not a plugin operation issue',
  );
});

test('Bug 1: handleEditorHeartbeat SKIPS a tldr-compile operation issue — no compileTldr, no operation-issue spawn', async () => {
  resetCircuitBreakerState();
  const opIssueId = 'op-issue-tldr-1';
  const { ctx, infoLogs, createCalls } = makeCtx({
    [opIssueId]: {
      id: opIssueId,
      description: 'irrelevant — this is the plugin\'s own plumbing',
      originKind: operationOriginKind('tldr-compile'),
    },
  });

  await handleEditorHeartbeat(ctx, {
    companyId: 'company-1',
    agentId: EDITOR_UUID,
    events: [{ entity_type: 'issue', entity_id: opIssueId, author_id: 'someone-else' }],
  });

  // The decisive assertion: NO operation issue was spawned. A guard miss would
  // reach `issues.create` and the recursion would be live.
  assert.equal(
    createCalls.length,
    0,
    'a tldr-compile operation issue must NOT spawn another operation issue',
  );

  const skipLine = infoLogs.find((l) => /skipped own operation issue/i.test(l.msg));
  assert.ok(skipLine, 'the skip is logged as a recursion-guard skip');
  assert.equal(skipLine.meta.issueId, opIssueId, 'the skip line names the operation issue');
});

test('Bug 1: handleEditorHeartbeat SKIPS any plugin:clarity-pack:operation:* issue (bulletin-compile too)', async () => {
  resetCircuitBreakerState();
  const bulletinOpId = 'op-issue-bulletin-1';
  const { ctx, createCalls } = makeCtx({
    [bulletinOpId]: {
      id: bulletinOpId,
      description: 'a bulletin-compile operation issue',
      originKind: operationOriginKind('bulletin-compile'),
    },
  });

  await handleEditorHeartbeat(ctx, {
    companyId: 'company-1',
    agentId: EDITOR_UUID,
    events: [{ entity_type: 'issue', entity_id: bulletinOpId, author_id: 'someone-else' }],
  });

  assert.equal(
    createCalls.length,
    0,
    'a bulletin-compile operation issue must not be TL;DR-compiled either',
  );
});

test('Bug 1: an ORDINARY issue is NOT skipped — the heartbeat still compiles real work', async () => {
  resetCircuitBreakerState();
  const realIssueId = 'BEAAA-901';
  const { ctx, infoLogs, createCalls } = makeCtx({
    [realIssueId]: {
      id: realIssueId,
      description: 'a genuine human-board issue that needs a TL;DR',
      originKind: 'user',
    },
  });

  await handleEditorHeartbeat(ctx, {
    companyId: 'company-1',
    agentId: EDITOR_UUID,
    events: [{ entity_type: 'issue', entity_id: realIssueId, author_id: 'someone-else' }],
  });

  // The ordinary issue is NOT recursion-skipped — it proceeds into compileTldr,
  // which reaches `issues.create` (the operation-issue handoff) and the seeded
  // `create` throws. The per-issue catch logs a benign "skipped TL;DR compile".
  const recursionSkip = infoLogs.find((l) => /skipped own operation issue/i.test(l.msg));
  assert.ok(!recursionSkip, 'an ordinary issue must NOT hit the recursion guard');
  assert.equal(
    createCalls.length,
    1,
    'an ordinary issue DOES proceed into the compile path (one operation-issue handoff)',
  );
});

test('Bug 1: a chain of operation issues never cascades — every one is skipped', async () => {
  resetCircuitBreakerState();
  // Model the exact live failure: a batch of `tldr-<id>` operation issues all
  // arriving as issue.created events in one heartbeat. NONE may spawn more.
  const ids = ['op-1', 'op-2', 'op-3', 'op-4', 'op-5'];
  const issuesById = {};
  for (const id of ids) {
    issuesById[id] = {
      id,
      description: `operation issue ${id}`,
      originKind: operationOriginKind('tldr-compile'),
    };
  }
  const { ctx, createCalls } = makeCtx(issuesById);

  await handleEditorHeartbeat(ctx, {
    companyId: 'company-1',
    agentId: EDITOR_UUID,
    events: ids.map((id) => ({
      entity_type: 'issue',
      entity_id: id,
      author_id: 'someone-else',
    })),
  });

  assert.equal(
    createCalls.length,
    0,
    'a batch of operation issues spawns ZERO new operation issues — the cascade is dead',
  );
});
