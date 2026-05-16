// test/worker/agents/compile-result-tool.test.mjs
//
// Plan 03-07 Task 1 RED — failing spec for the submit-compile-result plugin
// tool (Option C — the canonical plugin-llm-wiki result-readback channel).
//
// The 2026-05-16 Countermoves re-drill PROVED Plan 03-06's scoped-issue
// task-delivery architecture but found an output-channel mismatch: the
// Editor-Agent filed the BulletinDraft JSON as an issue DOCUMENT and posted
// prose as the COMMENT — `deliverAgentTask` polled `listComments` for a JSON
// comment, found prose, timed out, nothing published.
//
// Option C replaces the comment poll with a typed tool boundary: the agent
// delivers its result by CALLING a declared plugin tool, `submit-compile-result`,
// with `{operationIssueId, result}`. The tool handler — running synchronously
// inside the worker — looks up the in-flight `deliverAgentTask` promise in a
// shared `PENDING_DELIVERIES` Map and resolves it directly.
//
// RED expectation: `src/worker/agents/compile-result-tool.ts` does not exist
// yet — the import fails with ERR_MODULE_NOT_FOUND.

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  registerCompileResultTool,
  PENDING_DELIVERIES,
  SUBMIT_COMPILE_RESULT_TOOL,
  SUBMIT_COMPILE_RESULT_TOOL_NAME,
} from '../../../src/worker/agents/compile-result-tool.ts';
import manifest from '../../../src/manifest.ts';

/**
 * Build a fake `ctx` whose `tools.register` captures `(name, declaration, fn)`.
 * After `registerCompileResultTool(fakeCtx)` the captured `fn` IS the handler
 * under test.
 */
function makeFakeCtx() {
  const registered = { name: null, declaration: null, fn: null };
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    tools: {
      register(name, declaration, fn) {
        registered.name = name;
        registered.declaration = declaration;
        registered.fn = fn;
      },
    },
  };
  return { ctx, registered };
}

const RUN_CTX = {
  agentId: 'editor-agent-uuid',
  runId: 'run-1',
  companyId: 'COU',
  projectId: 'proj-1',
};

// ---- Test 1 — registration ------------------------------------------------

test('registerCompileResultTool registers a tool named submit-compile-result', () => {
  PENDING_DELIVERIES.clear();
  const { ctx, registered } = makeFakeCtx();
  registerCompileResultTool(ctx);
  assert.equal(registered.name, 'submit-compile-result');
  assert.equal(registered.name, SUBMIT_COMPILE_RESULT_TOOL_NAME);
  assert.equal(typeof registered.fn, 'function', 'a handler function is registered');
});

// ---- Test 2 — happy path: resolves a pending delivery ---------------------

test('handler resolves a pre-registered PENDING_DELIVERIES entry with params.result', async () => {
  PENDING_DELIVERIES.clear();
  const { ctx, registered } = makeFakeCtx();
  registerCompileResultTool(ctx);

  let captured;
  PENDING_DELIVERIES.set('op-1', {
    resolve: (r) => {
      captured = r;
    },
    reject: () => {},
  });

  const RAW = '{"masthead":{}}';
  const result = await registered.fn({ operationIssueId: 'op-1', result: RAW }, RUN_CTX);

  assert.deepEqual(result, { content: 'received' }, 'handler returns {content:"received"}');
  assert.equal(captured, RAW, 'the pending promise resolve() received the raw result string');
});

// ---- Test 3 — no pending entry: returns an error, does not throw ----------

test('handler with an operationIssueId that has no pending entry returns a ToolResult error', async () => {
  PENDING_DELIVERIES.clear();
  const { ctx, registered } = makeFakeCtx();
  registerCompileResultTool(ctx);

  const result = await registered.fn(
    { operationIssueId: 'op-missing', result: '{}' },
    RUN_CTX,
  );
  assert.ok(
    typeof result.error === 'string' && result.error.length > 0,
    'a missing pending entry yields a non-empty error field',
  );
});

// ---- Test 4 — bad params: returns an error, does not throw ----------------

test('handler with missing operationIssueId or missing result returns a ToolResult error', async () => {
  PENDING_DELIVERIES.clear();
  const { ctx, registered } = makeFakeCtx();
  registerCompileResultTool(ctx);

  const noIssue = await registered.fn({}, RUN_CTX);
  assert.ok(
    typeof noIssue.error === 'string' && noIssue.error.length > 0,
    'missing operationIssueId yields an error field',
  );

  const noResult = await registered.fn({ operationIssueId: 'op-1' }, RUN_CTX);
  assert.ok(
    typeof noResult.error === 'string' && noResult.error.length > 0,
    'missing result yields an error field',
  );
});

// ---- Test 5 — declaration shape -------------------------------------------

test('SUBMIT_COMPILE_RESULT_TOOL declaration has the required parametersSchema', () => {
  assert.equal(SUBMIT_COMPILE_RESULT_TOOL.name, 'submit-compile-result');
  const schema = SUBMIT_COMPILE_RESULT_TOOL.parametersSchema;
  assert.equal(typeof schema, 'object', 'parametersSchema is an object');
  assert.ok(Array.isArray(schema.required), 'parametersSchema.required is an array');
  assert.ok(schema.required.includes('operationIssueId'), 'operationIssueId is required');
  assert.ok(schema.required.includes('result'), 'result is required');
  assert.equal(
    schema.properties.operationIssueId.type,
    'string',
    'operationIssueId is typed string',
  );
  assert.equal(schema.properties.result.type, 'string', 'result is typed string');
});

// ---- Task 3 — manifest contract tests (drift guard) -----------------------
// The manifest tool[] declaration must stay locked to the worker's
// SUBMIT_COMPILE_RESULT_TOOL so they cannot drift apart silently.

test('manifest: capabilities include agent.tools.register', () => {
  assert.ok(
    manifest.capabilities.includes('agent.tools.register'),
    'agent.tools.register is required for ctx.tools.register',
  );
});

test('manifest: tools[] declares exactly the submit-compile-result tool', () => {
  assert.ok(Array.isArray(manifest.tools), 'manifest carries a tools[] array');
  assert.equal(manifest.tools.length, 1, 'exactly one tool declared');
  assert.equal(
    manifest.tools[0].name,
    SUBMIT_COMPILE_RESULT_TOOL_NAME,
    'the manifest tool name matches the worker declaration',
  );
  const schema = manifest.tools[0].parametersSchema;
  assert.ok(schema.required.includes('operationIssueId'), 'manifest tool requires operationIssueId');
  assert.ok(schema.required.includes('result'), 'manifest tool requires result');
});

test('manifest: Editor-Agent instructions are tool-directed, not comment-directed', () => {
  const editor = manifest.agents.find((a) => a.agentKey === 'editor-agent');
  assert.ok(editor, 'the Editor-Agent is declared in the manifest');
  assert.ok(
    editor.instructions.content.includes('submit-compile-result'),
    'the instructions reference the submit-compile-result tool',
  );
  assert.ok(
    !editor.instructions.content.includes('as a comment'),
    'the old comment-delivery instruction is removed',
  );
});

test('manifest: version is 0.3.0', () => {
  assert.equal(manifest.version, '0.3.0');
});
