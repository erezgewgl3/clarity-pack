// test/worker/agents/agent-task-delivery.test.mjs
//
// Plan 03-06 Task 1 RED — failing spec for the operation-issue task-delivery
// layer.
//
// Plan 03-05's `sessionLlmAdapter` drove the Editor-Agent via
// `ctx.agents.sessions.sendMessage({prompt})` — but the host silently discards
// the `prompt` before it reaches the agent (upstream PR #3106). The agent runs
// its ordinary org-chart heartbeat, finds an empty inbox, and emits prose.
//
// Path (d) — the scoped-issue handoff: the compile prompt becomes the BODY of
// an operation issue ASSIGNED to the Editor-Agent. The agent's heartbeat finds
// the assigned issue ("Step 3 — Get Assignments", which PR #3106 leaves
// unchanged), reads the prompt from the issue body, and posts the BulletinDraft
// JSON as a comment. The worker polls for that comment.
//
// `deliverAgentTask(ctx, opts)` creates (or reuses) the operation issue, wakes
// the agent, polls `ctx.issues.listComments` for a schema-valid JSON result
// comment, and returns the raw result string. `deliveryLlmAdapter` wraps it
// behind the byte-identical `LlmAdapter` interface.
//
// RED expectation: `src/worker/agents/agent-task-delivery.ts` does not exist
// yet — the import fails with ERR_MODULE_NOT_FOUND.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  deliverAgentTask,
  deliveryLlmAdapter,
  AGENT_TASK_DELIVERY_TIMEOUT,
  OPERATION_ORIGIN_KIND_PREFIX,
  operationOriginKind,
} from '../../../src/worker/agents/agent-task-delivery.ts';
import {
  PENDING_DELIVERIES,
  registerCompileResultTool,
} from '../../../src/worker/agents/compile-result-tool.ts';
import { makeHostFaithfulCompileCtx } from '../../helpers/host-faithful-ctx.mjs';
import manifest from '../../../src/manifest.ts';

const AGENT_ID = 'editor-agent-uuid';
const COMPANY_ID = 'COU';

/**
 * A real minimal BulletinDraft — masthead/actionInbox/departments/
 * standingNumbers/lineageThreads — so it genuinely passes `validateDraftSchema`
 * (Test 4 depends on a real schema-valid vs schema-invalid distinction, not a
 * brace count).
 */
function validDraftJson() {
  return JSON.stringify({
    masthead: {
      volume: 'I',
      number: 1,
      weekday: 'Thursday',
      dateText: '2026-05-07',
      prepareForName: 'Eric G.',
      cycleNumber: 1,
    },
    actionInbox: [],
    departments: [{ name: 'Sales', items: [], editorialSummary: '' }],
    standingNumbers: [{ key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' }],
    lineageThreads: [],
  });
}

/**
 * Build a fake `ctx.issues` with `create`/`list`/`listComments`/`requestWakeup`
 * and (Plan 03-07) `documents.list` / `documents.get`.
 *
 * @param {object}  opts
 * @param {Array}   opts.existing       — rows `ctx.issues.list` returns (idempotency).
 * @param {Array}   opts.commentScript  — array-of-arrays; one entry per poll.
 *                                        Each entry is the IssueComment[] that
 *                                        poll returns. The polling loop is
 *                                        genuinely exercised across ≥2 polls.
 * @param {Array}   opts.documentSummaries — IssueDocumentSummary[] returned by
 *                                        `documents.list` (default []).
 * @param {object}  opts.documentBodies — key → body string; `documents.get`
 *                                        returns `{...summary, body}` for a key.
 */
function makeFakeCtx({
  existing = [],
  commentScript = [],
  documentSummaries = [],
  documentBodies = {},
} = {}) {
  const calls = { list: [], create: [], requestWakeup: [], listComments: [] };
  let createdSeq = 0;
  let pollIndex = 0;

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    issues: {
      async list(input) {
        calls.list.push(input);
        return existing;
      },
      async create(input) {
        createdSeq += 1;
        const issue = {
          id: `op-${createdSeq}`,
          identifier: `COU-OP-${createdSeq}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...input,
        };
        calls.create.push(input);
        return issue;
      },
      async requestWakeup(issueId, companyId, options) {
        calls.requestWakeup.push({ issueId, companyId, options });
        return { queued: true, runId: 'run-1' };
      },
      async listComments(issueId, companyId) {
        calls.listComments.push({ issueId, companyId });
        const entry = commentScript[pollIndex] ?? [];
        if (pollIndex < commentScript.length - 1) pollIndex += 1;
        return entry;
      },
      documents: {
        async list() {
          return documentSummaries;
        },
        async get(issueId, key) {
          if (!(key in documentBodies)) return null;
          const summary = documentSummaries.find((s) => s.key === key) ?? { key };
          return { ...summary, issueId, body: documentBodies[key] };
        },
      },
    },
  };
  return { ctx, calls };
}

/** A comment object as the SDK's IssueComment shape (Date objects, non-optional authorAgentId). */
function comment({ id = 'c1', authorAgentId = AGENT_ID, body = '' } = {}) {
  return {
    id,
    companyId: COMPANY_ID,
    issueId: 'op-1',
    authorType: 'agent',
    authorAgentId,
    authorUserId: null,
    body,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const BASE_OPTS = {
  agentId: AGENT_ID,
  companyId: COMPANY_ID,
  operationKind: 'bulletin-compile',
  operationId: 'cycle-1',
  title: 'Compile Daily Bulletin — cycle 1',
  prompt: 'You are the Editorial Desk. Compile a bulletin.',
  timeoutMs: 200,
  pollIntervalMs: 20,
};

// ---- Test 1 — happy path --------------------------------------------------

test('deliverAgentTask: happy path — create + wakeup + JSON comment on poll 2 → resolves raw JSON', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    commentScript: [
      [], // poll 1 — no comment yet
      [comment({ body: draft })], // poll 2 — the result
    ],
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);

  assert.equal(result, draft, 'resolves the raw JSON string from the result comment');
  assert.equal(calls.create.length, 1, 'one operation issue created');
  assert.equal(calls.requestWakeup.length, 1, 'the agent is woken once');
  assert.ok(calls.listComments.length >= 2, 'polled at least twice');
});

// ---- Test 2 — idempotency -------------------------------------------------

test('deliverAgentTask: idempotency — an existing operation issue with the same originId is REUSED', async () => {
  const draft = validDraftJson();
  const existingIssue = {
    id: 'op-existing',
    title: 'Compile Daily Bulletin — cycle 1',
    status: 'in_progress',
    assigneeAgentId: AGENT_ID,
    originKind: operationOriginKind('bulletin-compile'),
    originId: 'cycle-1',
    surfaceVisibility: 'plugin_operation',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { ctx, calls } = makeFakeCtx({
    existing: [existingIssue],
    commentScript: [[comment({ issueId: 'op-existing', body: draft })]],
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);

  assert.equal(result, draft, 'reuses the existing issue and still resolves the result');
  assert.equal(calls.create.length, 0, 'ctx.issues.create is NEVER called when an issue is reused');
  // B-1 regression guard — without includePluginOperations the off-board
  // operation issue is invisible and a duplicate is created on every re-fire.
  assert.equal(
    calls.list[0].includePluginOperations,
    true,
    'the idempotency list() carries includePluginOperations: true',
  );
  assert.equal(
    calls.list[0].originKindPrefix,
    OPERATION_ORIGIN_KIND_PREFIX,
    'the idempotency list() searches by the operation originKind prefix',
  );
});

// ---- Test 3 — timeout -----------------------------------------------------

test('deliverAgentTask: timeout — no JSON comment ever appears → rejects with a timeout-tagged error', async () => {
  const { ctx } = makeFakeCtx({
    existing: [],
    commentScript: [[]], // every poll returns no comment
  });

  await assert.rejects(
    () => deliverAgentTask(ctx, { ...BASE_OPTS, timeoutMs: 120, pollIntervalMs: 20 }),
    /timeout/i,
    'rejects with a timeout-tagged error after timeoutMs',
  );
});

// ---- Test 4 — non-result comments skipped ---------------------------------

test('deliverAgentTask: a stray-brace progress comment is skipped; the schema-valid comment resolves', async () => {
  const draft = validDraftJson();
  const { ctx } = makeFakeCtx({
    existing: [],
    commentScript: [
      // poll 1 — a progress note with a stray `{` but NOT a schema-valid draft
      [comment({ id: 'c-progress', body: 'working on it {step 1} — almost done' })],
      // poll 2 — the genuine schema-valid BulletinDraft JSON
      [
        comment({ id: 'c-progress', body: 'working on it {step 1} — almost done' }),
        comment({ id: 'c-result', body: draft }),
      ],
    ],
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);
  assert.equal(result, draft, 'resolves the poll-2 schema-valid comment, not the stray-brace one');
});

// ---- Test 5 — operation-issue shape ---------------------------------------

test('deliverAgentTask: the created issue carries assigneeAgentId, originKind, surfaceVisibility, description', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    commentScript: [[comment({ body: draft })]],
  });

  await deliverAgentTask(ctx, BASE_OPTS);

  const created = calls.create[0];
  assert.equal(created.assigneeAgentId, AGENT_ID, 'assigned to the resolved Editor-Agent');
  assert.equal(
    created.originKind,
    'plugin:clarity-pack:operation:bulletin-compile',
    'originKind is the operation kind',
  );
  assert.equal(created.surfaceVisibility, 'plugin_operation', 'off the human board');
  assert.equal(created.description, BASE_OPTS.prompt, 'the compile prompt is the issue description');
  assert.equal(created.originId, 'cycle-1', 'originId is the dedupe key');
  assert.equal(calls.requestWakeup[0].issueId, 'op-1', 'requestWakeup is called with the created issue id');
});

// ---- Test 6 — deliveryLlmAdapter ------------------------------------------

test('deliveryLlmAdapter.complete() forwards the prompt as the issue description and returns the result', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    commentScript: [[comment({ body: draft })]],
  });

  const adapter = deliveryLlmAdapter(ctx, {
    agentId: AGENT_ID,
    companyId: COMPANY_ID,
    operationKind: 'bulletin-compile',
    operationId: 'cycle-1',
    timeoutMs: 200,
    pollIntervalMs: 20,
  });

  const prompt = 'compile the bulletin now';
  const result = await adapter.complete({ maxTokens: 6000, prompt });

  assert.equal(result, draft, 'complete() resolves the agent result string');
  assert.equal(calls.create[0].description, prompt, 'complete() forwards prompt as the issue description');
});

test('AGENT_TASK_DELIVERY_TIMEOUT is a positive number (default result-readback ceiling)', () => {
  assert.equal(typeof AGENT_TASK_DELIVERY_TIMEOUT, 'number');
  assert.ok(AGENT_TASK_DELIVERY_TIMEOUT > 0);
});

// ===========================================================================
// Plan 03-07 Task 1 RED — the promise-registry readback (Option C).
// `deliverAgentTask` registers a PENDING_DELIVERIES entry keyed by issue.id
// BEFORE requestWakeup, then Promise.race's that pending promise against a slow
// comment+document fallback poll and the timeout. The submit-compile-result
// tool handler resolves the pending promise directly — no comment-poll race on
// the designed path.
// ===========================================================================

/** A document summary as the SDK's IssueDocumentSummary shape. */
function docSummary({ key = 'bulletin', id = 'doc-1' } = {}) {
  return {
    id,
    issueId: 'op-1',
    key,
    title: 'Compiled draft',
    format: 'markdown',
    latestRevisionNumber: 1,
    createdByAgentId: AGENT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---- Test A — the tool channel resolves the delivery ----------------------

test('deliverAgentTask: Test A — a submit-compile-result tool call resolves the delivery (no comment, no document)', async () => {
  PENDING_DELIVERIES.clear();
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    commentScript: [[]], // listComments always empty — the tool wins
  });

  const pending = deliverAgentTask(ctx, {
    ...BASE_OPTS,
    timeoutMs: 2000,
    fallbackPollIntervalMs: 1000,
  });

  // Wait a tick so deliverAgentTask creates the issue and registers its entry.
  await new Promise((r) => setTimeout(r, 30));
  const createdId = calls.create.length ? 'op-1' : null;
  assert.ok(createdId, 'an operation issue was created');
  const entry = PENDING_DELIVERIES.get(createdId);
  assert.ok(entry, 'deliverAgentTask registered a PENDING_DELIVERIES entry keyed by issue.id');

  // The simulated agent calls the tool — resolve directly.
  entry.resolve(draft);

  const result = await pending;
  assert.equal(result, draft, 'deliverAgentTask resolves the tool-delivered result string');
});

// ---- Test B — the comment fallback poll still works -----------------------

test('deliverAgentTask: Test B — fallback comment poll resolves when the agent never calls the tool', async () => {
  PENDING_DELIVERIES.clear();
  const draft = validDraftJson();
  const { ctx } = makeFakeCtx({
    existing: [],
    commentScript: [
      [], // poll 1 — no result yet
      [comment({ body: draft })], // poll 2 — the JSON result comment (Option A)
    ],
  });

  const result = await deliverAgentTask(ctx, {
    ...BASE_OPTS,
    timeoutMs: 2000,
    fallbackPollIntervalMs: 30,
  });
  assert.equal(result, draft, 'the comment-scan fallback resolves the result');
});

// ---- Test C — the document fallback scan works ----------------------------

test('deliverAgentTask: Test C — fallback document scan resolves a BulletinDraft filed as a document', async () => {
  PENDING_DELIVERIES.clear();
  const draft = validDraftJson();
  const { ctx } = makeFakeCtx({
    existing: [],
    commentScript: [[]], // no result comment ever
    documentSummaries: [docSummary({ key: 'bulletin' })],
    documentBodies: { bulletin: draft },
  });

  const result = await deliverAgentTask(ctx, {
    ...BASE_OPTS,
    timeoutMs: 2000,
    fallbackPollIntervalMs: 30,
  });
  assert.equal(result, draft, 'the document-scan fallback (Option B) resolves the result');
});

// ---- Test D — timeout cleans up the Map entry -----------------------------

test('deliverAgentTask: Test D — timeout rejects AND cleans up the PENDING_DELIVERIES entry', async () => {
  PENDING_DELIVERIES.clear();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    commentScript: [[]], // nothing ever resolves on any channel
  });

  await assert.rejects(
    () =>
      deliverAgentTask(ctx, {
        ...BASE_OPTS,
        timeoutMs: 120,
        fallbackPollIntervalMs: 40,
      }),
    /timeout/i,
    'rejects with a timeout-tagged error',
  );

  const createdId = calls.create.length ? 'op-1' : null;
  assert.ok(createdId, 'an operation issue was created');
  assert.equal(
    PENDING_DELIVERIES.has(createdId),
    false,
    'the finally cleanup deleted the Map entry — no leak',
  );
});

// ===========================================================================
// Plan 03-07 Task 4 — host-faithful e2e: the tool channel end-to-end.
// `deliverAgentTask` resolves when the SIMULATED agent calls
// submit-compile-result via the host-faithful ctx's `callTool` helper — with
// no comment and no document posted (the tool channel wins, not the fallback).
// ===========================================================================

test('e2e (host-faithful): deliverAgentTask resolves via the submit-compile-result tool channel', async () => {
  PENDING_DELIVERIES.clear();
  const draft = validDraftJson();
  const harness = makeHostFaithfulCompileCtx({
    companies: [{ id: COMPANY_ID }],
    // listComments returns the canned draft by default — to PROVE the tool
    // channel won (not the fallback comment scan), suppress the result comment.
    noResultComment: true,
  });
  const { ctx, callTool, issuesCreated } = harness;

  // Register the real submit-compile-result tool against the host-faithful ctx.
  registerCompileResultTool(ctx);

  const pending = deliverAgentTask(ctx, {
    ...BASE_OPTS,
    timeoutMs: 4000,
    fallbackPollIntervalMs: 2000,
  });

  // Wait a tick so deliverAgentTask creates the operation issue and registers
  // its PENDING_DELIVERIES entry.
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(issuesCreated.length, 1, 'one operation issue was created');
  // The host-faithful issues.create assigns ids `issue-${n}`.
  const operationIssueId = 'issue-1';
  assert.ok(
    PENDING_DELIVERIES.has(operationIssueId),
    'deliverAgentTask registered a PENDING_DELIVERIES entry for the created operation issue',
  );

  // SIMULATE the agent calling the tool.
  const toolResult = await callTool('submit-compile-result', {
    operationIssueId,
    result: draft,
  });
  assert.deepEqual(toolResult, { content: 'received' }, 'the tool handler returned {content:"received"}');

  const result = await pending;
  assert.equal(result, draft, 'deliverAgentTask resolves the tool-delivered result string');
});

// ---- Task 4 — manifest contract test (drift guard) ------------------------
// Added in Task 4: the Editor-Agent manifest instructions must reference the
// operation originKind prefix so the agent instructions and the worker's
// originKind cannot drift apart silently; the capabilities must include
// issues.wakeup so ctx.issues.requestWakeup is permitted.

test('manifest: Editor-Agent instructions reference the operation originKind prefix', () => {
  const editor = manifest.agents.find((a) => a.agentKey === 'editor-agent');
  assert.ok(editor, 'the Editor-Agent is declared in the manifest');
  assert.ok(
    editor.instructions.content.includes(OPERATION_ORIGIN_KIND_PREFIX),
    'the instructions reference plugin:clarity-pack:operation: so they cannot drift from agent-task-delivery.ts',
  );
});

test('manifest: capabilities include issues.wakeup', () => {
  assert.ok(
    manifest.capabilities.includes('issues.wakeup'),
    'issues.wakeup is required for ctx.issues.requestWakeup',
  );
});
