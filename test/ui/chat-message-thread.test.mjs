// test/ui/chat-message-thread.test.mjs
//
// Plan 04-05 Task 2 — message thread / composer / reasoning-panel source
// contract + a runnable test of the pure parseReasoning parser.
//
// SOURCE-GREP tests (Node doesn't load .tsx). Verifies:
//   - message-thread.tsx, composer.tsx, reasoning-panel.tsx exist;
//   - message-thread.tsx subscribes usePluginStream and references usePoll as
//     the fallback, and sorts by SERVER created_at (no client-time sort);
//   - composer.tsx contains the literal "Attachments are temporarily
//     unavailable" string, disables the attach button, generates a
//     message_uuid via crypto.randomUUID, and a failed send keeps a Retry;
//   - reasoning-panel.tsx renders a <details> element;
//   - no chat surface file uses dangerouslySetInnerHTML.
//
// The parseReasoning import below is a real behavioural test — parseReasoning
// is a pure function with no React / SDK imports, so it loads fine in Node.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat');

function readChat(rel) {
  return readFileSync(path.join(CHAT_DIR, rel), 'utf8');
}

/** Read source with // and /* *​/ comments stripped — grep the CODE only. */
function readChatCode(rel) {
  return readChat(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FILES = ['message-thread.tsx', 'composer.tsx', 'reasoning-panel.tsx'];
for (const f of FILES) {
  test(`Chat thread: ${f} exists`, () => {
    assert.ok(existsSync(path.join(CHAT_DIR, f)), `expected src/ui/surfaces/chat/${f}`);
  });
}

test('Chat thread: message-thread.tsx subscribes usePluginStream', () => {
  const src = readChat('message-thread.tsx');
  assert.match(src, /usePluginStream/);
  assert.match(src, /chat:\$\{companyId\}/, 'must subscribe the chat:<companyId> channel');
});

test('Chat thread: message-thread.tsx references usePoll as the fallback', () => {
  const src = readChat('message-thread.tsx');
  assert.match(src, /usePoll\b/);
  assert.match(src, /reconnecting/i, 'a reconnecting indicator must show while degraded');
});

test('Chat thread: message-thread.tsx orders by server created_at, not client time', () => {
  const src = readChat('message-thread.tsx');
  // The sort must key off createdAt (the server field). It must NOT sort by
  // a client send clock such as Date.now() inside the comparator.
  assert.match(src, /\.sort\(\([^)]*\)\s*=>[\s\S]*createdAt/);
});

test('Chat thread: composer.tsx contains the explicit attachment-degrade message', () => {
  const src = readChat('composer.tsx');
  assert.match(src, /Attachments are temporarily unavailable/);
});

test('Chat thread: composer.tsx disables the attach button (OQ-1 NO-PATH)', () => {
  const src = readChat('composer.tsx');
  assert.match(src, /ATTACHMENTS_AVAILABLE\s*=\s*false/);
  assert.match(src, /disabled=\{!ATTACHMENTS_AVAILABLE\}/);
});

test('Chat thread: composer.tsx generates a message_uuid via crypto.randomUUID', () => {
  const src = readChat('composer.tsx');
  assert.match(src, /crypto\.randomUUID/);
  assert.match(src, /message_uuid/);
});

test('Chat thread: composer.tsx keeps a Retry affordance on a failed send', () => {
  const src = readChat('composer.tsx');
  assert.match(src, /onRetry/);
  assert.match(src, /status:\s*'failed'/);
});

test('Chat thread: reasoning-panel.tsx renders a <details> element', () => {
  const src = readChat('reasoning-panel.tsx');
  assert.match(src, /<details/);
  assert.match(src, /Show reasoning/);
});

test('Chat thread: no chat surface file uses dangerouslySetInnerHTML', () => {
  for (const f of FILES) {
    assert.doesNotMatch(readChatCode(f), /dangerouslySetInnerHTML/, `${f}`);
  }
});

test('Chat thread: no chat surface file calls raw fetch()', () => {
  for (const f of FILES) {
    assert.doesNotMatch(readChatCode(f), /(?<![A-Za-z.])fetch\(/, `${f}`);
  }
});

// --- GAP 6: composer ↔ chat-send.ts param-name wire contract --------------
//
// The live re-drill saw chat.send fail on EVERY send: composer.tsx passed
// `message_uuid` (snake_case) in its send({...}) call, but the chat.send
// handler reads `messageUuid` (camelCase) via reqStr — params.messageUuid was
// undefined, so reqStr threw `chat.send: messageUuid required`. The per-side
// TDD tests never caught it because each side was tested in isolation. This
// is a cross-file WIRE-CONTRACT test: the exact set of param keys the
// composer's send({...}) call passes MUST equal the exact set of keys the
// chat-send.ts handler requires via reqStr.

const WORKER_DIR = path.resolve(HERE, '..', '..', 'src', 'worker', 'handlers');

/** Extract every key required by `reqStr(params, 'KEY')` in chat-send.ts. */
function chatSendRequiredKeys() {
  const src = readFileSync(path.join(WORKER_DIR, 'chat-send.ts'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/reqStr\(\s*params\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
    keys.add(m[1]);
  }
  return keys;
}

/** Extract the param keys passed in the composer's `send({ ... })` call. */
function composerSendKeys() {
  const code = readChatCode('composer.tsx');
  // Match `await send({ ... })` and pull the object body.
  const call = code.match(/await\s+send\(\{([\s\S]*?)\}\)/);
  assert.ok(call, 'composer.tsx must contain an `await send({ ... })` call');
  const body = call[1];
  const keys = new Set();
  // Object keys appear at the start of a line (the call object is
  // pretty-printed one key per line): optional leading whitespace, the
  // identifier, then `,` `:` or end-of-line. Comment lines were already
  // stripped by readChatCode.
  for (const m of body.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[,:}\r\n]|$)/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

test('Chat thread: composer send({...}) uses exactly the keys chat-send.ts requires (GAP 6)', () => {
  const required = chatSendRequiredKeys();
  const passed = composerSendKeys();

  // The handler's reqStr set is the contract.
  assert.deepEqual(
    [...required].sort(),
    ['body', 'companyId', 'messageUuid', 'topicIssueId', 'userId'],
    'chat-send.ts must require exactly these five params',
  );

  // Every required key must be passed by the composer.
  for (const key of required) {
    assert.ok(
      passed.has(key),
      `composer send({...}) is missing required param "${key}" — ` +
        `the handler's reqStr will throw "chat.send: ${key} required"`,
    );
  }

  // And the composer must not pass a snake_case `message_uuid` — the exact
  // GAP 6 drift. The handler reads camelCase `messageUuid`.
  assert.ok(
    !passed.has('message_uuid'),
    'composer send({...}) must not pass snake_case `message_uuid` — ' +
      'chat-send.ts reads camelCase `messageUuid`',
  );
  assert.ok(passed.has('messageUuid'), 'composer send({...}) must pass `messageUuid`');
});

// --- runnable behavioural test of the pure parseReasoning parser ----------
test('parseReasoning: a body with no block returns it unchanged', async () => {
  const { parseReasoning } = await import(
    '../../src/ui/surfaces/chat/reasoning-block-parser.mjs'
  );
  const r = parseReasoning('Just a plain message.');
  assert.equal(r.visible, 'Just a plain message.');
  assert.equal(r.reasoning, null);
});

test('parseReasoning: splits the D-14 fenced reasoning block out of the body', async () => {
  const { parseReasoning } = await import(
    '../../src/ui/surfaces/chat/reasoning-block-parser.mjs'
  );
  const body =
    'Here is my answer.<!-- clarity:reasoning -->step one\nstep two<!-- /clarity:reasoning -->';
  const r = parseReasoning(body);
  assert.equal(r.visible, 'Here is my answer.');
  assert.equal(r.reasoning, 'step one\nstep two');
});

test('parseReasoning: a missing closing fence treats the rest as reasoning', async () => {
  const { parseReasoning } = await import(
    '../../src/ui/surfaces/chat/reasoning-block-parser.mjs'
  );
  const r = parseReasoning('Answer.<!-- clarity:reasoning -->dangling reasoning');
  assert.equal(r.visible, 'Answer.');
  assert.equal(r.reasoning, 'dangling reasoning');
});
