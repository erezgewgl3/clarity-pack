// test/worker/agents/agent-task-delivery.test.mjs
//
// Plan 03-06 Task 1 — spec for the operation-issue task-delivery layer.
// Plan 03-08 — the readback (steps 4-5) re-pointed at Option B: a PRIMARY
// issue-document poll via `ctx.issues.documents.get/.list`.
//
// Plan 03-05's `sessionLlmAdapter` drove the Editor-Agent via
// `ctx.agents.sessions.sendMessage({prompt})` — but the host silently discards
// the `prompt` (upstream PR #3106). Plan 03-06's scoped-issue handoff puts the
// compile prompt in the operation-issue BODY; the agent's heartbeat finds the
// assigned issue, reads the prompt, and produces the result.
//
// Plan 03-07 tried Option C (the agent calls a declared plugin tool) — the
// 2026-05-16 closure re-drill LIVE-DISPROVED it (a `claude_local` managed
// agent's session never receives a plugin-declared tool). Plan 03-08 adopts
// Option B: the agent files the result as an issue DOCUMENT keyed
// `compile-result`; `deliverAgentTask` reads it back via
// `ctx.issues.documents.get`. The "store the result as a document keyed
// compile-result" instruction is carried in the operation-issue DESCRIPTION
// (the channel that propagates — the static manifest instructions do NOT).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  deliverAgentTask,
  deliveryLlmAdapter,
  AGENT_TASK_DELIVERY_TIMEOUT,
  RESULT_DOCUMENT_KEY,
  RESULT_DELIVERY_INSTRUCTION,
  RESULT_POLL_INTERVAL_MS,
  OPERATION_ORIGIN_KIND_PREFIX,
  operationOriginKind,
} from '../../../src/worker/agents/agent-task-delivery.ts';
import { makeHostFaithfulCompileCtx } from '../../helpers/host-faithful-ctx.mjs';
import manifest from '../../../src/manifest.ts';

const AGENT_ID = 'editor-agent-uuid';
const COMPANY_ID = 'COU';

/**
 * A real minimal BulletinDraft — masthead/actionInbox/departments/
 * standingNumbers/lineageThreads — so it genuinely passes `validateDraftSchema`
 * (the schema-valid vs schema-invalid distinction is a real one, not a brace
 * count).
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
 * and the Plan 03-08 PRIMARY readback surface `documents.list` / `documents.get`.
 *
 * @param {object}  opts
 * @param {Array}   opts.existing          — rows `ctx.issues.list` returns (idempotency).
 * @param {Array}   opts.commentScript     — array-of-arrays; one entry per poll
 *                                           (the IssueComment[] that poll returns).
 * @param {object}  opts.documentScript    — { delayPolls, summaries, bodies } — the
 *                                           document fixture appears only AFTER
 *                                           `delayPolls` document polls, so the
 *                                           poll loop is genuinely exercised.
 */
function makeFakeCtx({ existing = [], commentScript = [], documentScript = null } = {}) {
  const calls = {
    list: [],
    create: [],
    requestWakeup: [],
    listComments: [],
    documentsGet: [],
    documentsList: [],
  };
  let createdSeq = 0;
  let commentPollIndex = 0;
  let documentGetPolls = 0;
  let documentListPolls = 0;

  const docDelay = documentScript?.delayPolls ?? 0;
  const docSummaries = documentScript?.summaries ?? [];
  const docBodies = documentScript?.bodies ?? {};

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
        const entry = commentScript[commentPollIndex] ?? [];
        if (commentPollIndex < commentScript.length - 1) commentPollIndex += 1;
        return entry;
      },
      documents: {
        async list(issueId, companyId) {
          calls.documentsList.push({ issueId, companyId });
          documentListPolls += 1;
          if (documentListPolls <= docDelay) return [];
          return docSummaries;
        },
        async get(issueId, key, companyId) {
          calls.documentsGet.push({ issueId, key, companyId });
          documentGetPolls += 1;
          if (documentGetPolls <= docDelay) return null;
          if (!(key in docBodies)) return null;
          const summary = docSummaries.find((s) => s.key === key) ?? { key };
          return { ...summary, issueId, body: docBodies[key] };
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

/** A document summary as the SDK's IssueDocumentSummary shape. */
function docSummary({ key = RESULT_DOCUMENT_KEY, id = 'doc-1' } = {}) {
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

const BASE_OPTS = {
  agentId: AGENT_ID,
  companyId: COMPANY_ID,
  operationKind: 'bulletin-compile',
  operationId: 'cycle-1',
  title: 'Compile Daily Bulletin — cycle 1',
  prompt: 'You are the Editorial Desk. Compile a bulletin.',
  timeoutMs: 400,
  pollIntervalMs: 20,
};

// ---- Test 1 — happy path: PRIMARY document poll ---------------------------

test('deliverAgentTask: happy path — create + wakeup + result document at key compile-result on poll 2 → resolves raw JSON', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    // the document appears only after the FIRST document poll — exercises the loop.
    documentScript: {
      delayPolls: 1,
      summaries: [docSummary({ key: RESULT_DOCUMENT_KEY })],
      bodies: { [RESULT_DOCUMENT_KEY]: draft },
    },
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);

  assert.equal(result, draft, 'resolves the raw JSON string from the result document');
  assert.equal(calls.create.length, 1, 'one operation issue created');
  assert.equal(calls.requestWakeup.length, 1, 'the agent is woken once');
  assert.ok(calls.documentsGet.length >= 2, 'documents.get polled at least twice');
  // the PRIMARY get keys EXACTLY on compile-result.
  assert.equal(
    calls.documentsGet[0].key,
    RESULT_DOCUMENT_KEY,
    'the PRIMARY readback calls documents.get with key "compile-result"',
  );
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
    documentScript: {
      delayPolls: 0,
      summaries: [docSummary({ key: RESULT_DOCUMENT_KEY })],
      bodies: { [RESULT_DOCUMENT_KEY]: draft },
    },
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

test('deliverAgentTask: timeout — no document or comment ever appears → rejects with a timeout-tagged error', async () => {
  const { ctx } = makeFakeCtx({
    existing: [],
    commentScript: [[]], // every comment poll returns nothing
    documentScript: null, // documents.list/get always empty
  });

  await assert.rejects(
    () => deliverAgentTask(ctx, { ...BASE_OPTS, timeoutMs: 120, pollIntervalMs: 20 }),
    /timeout/i,
    'rejects with a timeout-tagged error after timeoutMs',
  );
});

// ---- Test 4 — off-key document fallback scan ------------------------------

test('deliverAgentTask: a document filed at a DIFFERENT key still resolves via the documents.list off-key scan', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    // the agent picked key "bulletin", not "compile-result".
    documentScript: {
      delayPolls: 0,
      summaries: [docSummary({ key: 'bulletin' })],
      bodies: { bulletin: draft },
    },
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);
  assert.equal(result, draft, 'the off-key documents.list scan resolves the result');
  // the PRIMARY get (compile-result) missed, the list scan found "bulletin".
  assert.ok(
    calls.documentsList.length >= 1,
    'documents.list was scanned when the primary key missed',
  );
});

// ---- Test 5 — non-result document skipped ---------------------------------

test('deliverAgentTask: a progress-note document is skipped; the schema-valid document resolves', async () => {
  const draft = validDraftJson();
  const { ctx } = makeFakeCtx({
    existing: [],
    // poll 1 — a progress note at the result key (stray brace, NOT schema-valid);
    // the document fixture is delayed so the genuine draft is the one resolved.
    documentScript: {
      delayPolls: 0,
      summaries: [
        docSummary({ key: RESULT_DOCUMENT_KEY, id: 'doc-progress' }),
        docSummary({ key: 'notes', id: 'doc-notes' }),
      ],
      bodies: {
        // the result key holds a non-schema-valid progress note...
        [RESULT_DOCUMENT_KEY]: 'working on it {step 1} — almost done',
        // ...the genuine draft is filed under a different key.
        notes: draft,
      },
    },
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);
  assert.equal(
    result,
    draft,
    'resolves the schema-valid document, not the stray-brace progress note at the result key',
  );
});

// ---- Test 6 — operation-issue shape: description carries the instruction --

test('deliverAgentTask: the created issue carries assigneeAgentId, originKind, surfaceVisibility, and a description with the compile-result delivery instruction', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    documentScript: {
      delayPolls: 0,
      summaries: [docSummary()],
      bodies: { [RESULT_DOCUMENT_KEY]: draft },
    },
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
  assert.equal(created.originId, 'cycle-1', 'originId is the dedupe key');
  // Plan 03-08 — the description is the prompt PLUS the result-delivery instruction.
  assert.ok(
    created.description.startsWith(BASE_OPTS.prompt),
    'the description begins with the compile prompt',
  );
  assert.ok(
    created.description.includes('compile-result'),
    'the description carries the "compile-result" document-key delivery instruction',
  );
  assert.ok(
    created.description.includes(RESULT_DELIVERY_INSTRUCTION),
    'the description appends the exact RESULT_DELIVERY_INSTRUCTION constant',
  );
  assert.equal(
    calls.requestWakeup[0].issueId,
    'op-1',
    'requestWakeup is called with the created issue id',
  );
});

// ---- Test 7 — comment fallback (lowest priority, belt-and-suspenders) ------

test('deliverAgentTask: comment fallback — a future agent that posts raw JSON as a comment still resolves', async () => {
  const draft = validDraftJson();
  const { ctx } = makeFakeCtx({
    existing: [],
    commentScript: [
      [], // poll 1 — no comment yet
      [comment({ body: draft })], // poll 2 — the JSON result comment
    ],
    documentScript: null, // no document is ever filed
  });

  const result = await deliverAgentTask(ctx, BASE_OPTS);
  assert.equal(result, draft, 'the comment-scan fallback resolves the result');
});

// ---- Test 8 — deliveryLlmAdapter ------------------------------------------

test('deliveryLlmAdapter.complete() forwards the prompt into the issue description and returns the result', async () => {
  const draft = validDraftJson();
  const { ctx, calls } = makeFakeCtx({
    existing: [],
    documentScript: {
      delayPolls: 0,
      summaries: [docSummary()],
      bodies: { [RESULT_DOCUMENT_KEY]: draft },
    },
  });

  const adapter = deliveryLlmAdapter(ctx, {
    agentId: AGENT_ID,
    companyId: COMPANY_ID,
    operationKind: 'bulletin-compile',
    operationId: 'cycle-1',
    timeoutMs: 400,
    pollIntervalMs: 20,
  });

  const prompt = 'compile the bulletin now';
  const result = await adapter.complete({ maxTokens: 6000, prompt });

  assert.equal(result, draft, 'complete() resolves the agent result string');
  assert.ok(
    calls.create[0].description.startsWith(prompt),
    'complete() forwards prompt as the head of the issue description',
  );
});

// ---- Test 9 — constants ---------------------------------------------------

test('AGENT_TASK_DELIVERY_TIMEOUT and RESULT_POLL_INTERVAL_MS are positive numbers', () => {
  assert.equal(typeof AGENT_TASK_DELIVERY_TIMEOUT, 'number');
  assert.ok(AGENT_TASK_DELIVERY_TIMEOUT > 0);
  assert.equal(typeof RESULT_POLL_INTERVAL_MS, 'number');
  assert.ok(RESULT_POLL_INTERVAL_MS > 0);
});

test('RESULT_DOCUMENT_KEY is the exact contract key "compile-result"', () => {
  assert.equal(RESULT_DOCUMENT_KEY, 'compile-result');
});

// ===========================================================================
// Plan 03-08 Task 3 — host-faithful e2e: the document-poll-primary readback.
//
// IMPORTANT — these e2e tests assert host CONSTRAINTS (the ctx.issues.documents
// API shape), NOT agent BEHAVIOUR. A host-faithful fake CANNOT prove the real
// `claude_local` Editor-Agent files the BulletinDraft as a document at key
// `compile-result` — only the live Countermoves closure drill (Plan 03-08
// Task 4) proves that. A green suite here is necessary but NOT sufficient to
// close Phase 3 (the phase advisory anti-pattern: a green local suite does not
// prove the live agent).
// ===========================================================================

test('e2e (host-faithful): deliverAgentTask resolves via a document filed at key compile-result (no comment required)', async () => {
  const draft = validDraftJson();
  const harness = makeHostFaithfulCompileCtx({
    companies: [{ id: COMPANY_ID }],
    // suppress the canned result COMMENT so this test PROVES the document poll
    // — not the comment fallback — is the channel that resolved.
    noResultComment: true,
    // seed the agent's filed document at the exact contract key.
    resultDocuments: { [RESULT_DOCUMENT_KEY]: draft },
  });
  const { ctx, issuesCreated } = harness;

  const result = await deliverAgentTask(ctx, {
    ...BASE_OPTS,
    timeoutMs: 4000,
    pollIntervalMs: 30,
  });

  assert.equal(result, draft, 'deliverAgentTask resolves the document-delivered result string');
  assert.equal(issuesCreated.length, 1, 'one operation issue was created');
  assert.ok(
    issuesCreated[0].description.includes('compile-result'),
    'the operation-issue description carries the compile-result delivery instruction',
  );
});

test('e2e (host-faithful): a document filed at a DIFFERENT key still resolves via the off-key documents.list scan', async () => {
  const draft = validDraftJson();
  const harness = makeHostFaithfulCompileCtx({
    companies: [{ id: COMPANY_ID }],
    noResultComment: true,
    // the agent filed it under "bulletin", not the contract key.
    resultDocuments: { bulletin: draft },
  });
  const { ctx } = harness;

  const result = await deliverAgentTask(ctx, {
    ...BASE_OPTS,
    timeoutMs: 4000,
    pollIntervalMs: 30,
  });
  assert.equal(result, draft, 'the off-key documents.list scan (host-faithful) resolves the result');
});

// ---- manifest contract tests (drift guards) -------------------------------

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

test('manifest: Option C is stripped — no agent.tools.register capability, no tools[], no agent permissions', () => {
  assert.ok(
    !manifest.capabilities.includes('agent.tools.register'),
    'the dead Option C agent.tools.register capability is removed',
  );
  assert.equal(manifest.tools, undefined, 'the dead Option C tools[] array is removed');
  const editor = manifest.agents.find((a) => a.agentKey === 'editor-agent');
  assert.equal(
    editor.permissions,
    undefined,
    'the dead Option C agents[].permissions.pluginTools block is removed',
  );
});

test('manifest: Editor-Agent instructions deliver via a compile-result document, not the dead submit-compile-result tool', () => {
  const editor = manifest.agents.find((a) => a.agentKey === 'editor-agent');
  assert.ok(
    editor.instructions.content.includes('compile-result'),
    'the instructions name the compile-result document key',
  );
  assert.ok(
    !editor.instructions.content.includes('submit-compile-result'),
    'the instructions no longer mention the dead submit-compile-result tool',
  );
});
