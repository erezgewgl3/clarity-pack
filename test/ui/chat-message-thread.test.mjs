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

test('Chat thread: message-thread.tsx keeps usePluginStream as a dormant bonus', () => {
  const src = readChat('message-thread.tsx');
  assert.match(src, /usePluginStream/);
  assert.match(src, /chat:\$\{companyId\}/, 'must still subscribe the chat:<companyId> channel');
});

// --- GAP 8: the host 501s the plugin-streams endpoint — polling is PRIMARY ---
//
// The live re-drill confirmed the Paperclip host returns HTTP 501 for the
// plugin-streams endpoint, so usePluginStream is a NO-PATH. The old code set
// `degraded = stream.error != null` (permanently true) which kept an alarming
// "Reconnecting — live updates paused" banner on screen forever and gated
// usePoll behind it. Polling must now be the calm always-on PRIMARY refresh.

test('Chat thread: message-thread.tsx runs usePoll as the always-on primary refresh (GAP 8)', () => {
  const code = readChatCode('message-thread.tsx');
  assert.match(code, /usePoll\b/, 'usePoll must drive the ongoing refresh');
  // The poll must NOT be gated on a `degraded` stream-error flag — that was the
  // permanently-true condition. The fetcher always calls refresh().
  assert.doesNotMatch(
    code,
    /degraded/,
    'the poll must not be gated on a `degraded` stream-error flag (GAP 8)',
  );
  // The poll key must be the always-on per-topic key, not an idle sentinel.
  assert.match(
    code,
    /key:\s*`chat\.messages\.refresh:\$\{topicIssueId\}`/,
    'the poll key must be the always-on per-topic refresh key',
  );
});

test('Chat thread: message-thread.tsx shows a calm STATIC live indicator, not an alarm banner or a ticking countdown (GAP 8)', () => {
  const src = readChat('message-thread.tsx');
  const code = readChatCode('message-thread.tsx');
  // The alarming "Reconnecting — live updates paused" banner must be gone.
  assert.doesNotMatch(
    src,
    /Reconnecting/,
    'the alarming "Reconnecting" banner must be replaced',
  );
  assert.doesNotMatch(src, /className="reconnecting"/, 'the .reconnecting element must be gone');
  // A calm STATIC indicator must render with role="status" for a11y.
  assert.match(src, /auto-refresh/, 'the indicator uses the .auto-refresh class');
  assert.match(
    src,
    /className="auto-refresh"\s+role="status"/,
    'the auto-refresh indicator keeps role="status"',
  );
  // The perpetually-looping countdown must be gone — no visible "next in Ns"
  // number, no countdown state, no decrementing interval. The label is static.
  assert.doesNotMatch(code, /next in/, 'the visible "next in Ns" countdown text must be removed');
  assert.doesNotMatch(
    code,
    /secondsToRefresh/,
    'the countdown state (secondsToRefresh) must be removed',
  );
  assert.doesNotMatch(
    code,
    /setInterval/,
    'the 1s countdown interval must be removed — the poll runs silently',
  );
});

test('Chat thread: message-thread.tsx documents the host streams NO-PATH (GAP 8)', () => {
  const src = readChat('message-thread.tsx');
  // A NO-PATH comment near usePluginStream marks the future re-enable point,
  // mirroring composer.tsx's ATTACHMENTS_AVAILABLE comment style.
  assert.match(src, /STREAMS_AVAILABLE/, 'a STREAMS_AVAILABLE NO-PATH comment must document the 501');
  assert.match(src, /501/, 'the comment must cite the host HTTP 501');
});

test('Chat thread: chat.css replaces the alarm banner with a calm auto-refresh style (GAP 8)', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  assert.match(css, /\.auto-refresh\s*\{/, '.auto-refresh must be styled');
  // The old .reconnecting alarm rule must be gone.
  assert.doesNotMatch(css, /\.reconnecting\s*\{/, 'the .reconnecting alarm rule must be removed');
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

// --- GAP 9: a successful send confirms immediately, not at the next poll ----
//
// The old composer did nothing to the optimistic bubble on a { ok } result —
// it lingered on "sending…" until MessageThread's body-match reconciliation
// dropped it on the next 15s poll. A 'sent' status now gives instant feedback.

test('Chat thread: OptimisticMessage has a three-state status incl. "sent" (GAP 9)', () => {
  const src = readChat('message-thread.tsx');
  assert.match(
    src,
    /status:\s*'pending'\s*\|\s*'sent'\s*\|\s*'failed'/,
    "OptimisticMessage.status must be 'pending' | 'sent' | 'failed'",
  );
});

test('Chat thread: composer.tsx flips the bubble to "sent" on a successful send (GAP 9)', () => {
  const code = readChatCode('composer.tsx');
  // On the success path (not { error }) the optimistic entry's status is set
  // to 'sent'. The old code left it 'pending'.
  assert.match(
    code,
    /status:\s*'sent'/,
    'a successful chat.send must set the optimistic bubble status to sent',
  );
});

test('Chat thread: OptimisticBubble renders a "sent" confirmation affordance (GAP 9)', () => {
  const src = readChat('message-thread.tsx');
  // A clear "✓ sent" / "✓ Sent" affordance renders for the 'sent' status.
  assert.match(src, /send-confirmed/, 'a .send-confirmed affordance must render for sent');
  assert.match(
    src,
    /optimistic\.status === 'sent'/,
    'OptimisticBubble must branch on the sent status',
  );
});

// --- composer keybinding: plain Enter sends, Shift+Enter inserts a newline --
//
// Standard chat convention. The old composer sent only on ⌘/Ctrl+Enter and let
// a plain Enter fall through as a newline — the opposite of what operators
// expect. handleKeyDown now: on Enter without Shift → preventDefault + send;
// on Shift+Enter → return early so the textarea's default newline happens.

test('Chat thread: composer.tsx sends on plain Enter (no Shift)', () => {
  const code = readChatCode('composer.tsx');
  // The handler must branch on Enter and call handleSend for the no-Shift path.
  assert.match(code, /e\.key\s*!==\s*'Enter'/, 'handleKeyDown must gate on the Enter key');
  assert.match(code, /handleSend\(\)/, 'plain Enter must call handleSend()');
  assert.match(code, /e\.preventDefault\(\)/, 'plain Enter must preventDefault the newline');
});

test('Chat thread: composer.tsx lets Shift+Enter insert a newline (does NOT send)', () => {
  const code = readChatCode('composer.tsx');
  // Shift+Enter must return early — no preventDefault, no handleSend — so the
  // textarea inserts its default newline.
  assert.match(
    code,
    /e\.shiftKey\)\s*return/,
    'Shift+Enter must return early so the default newline happens (no send)',
  );
  // The old ⌘/Ctrl+Enter-ONLY send gate must be gone as the primary path.
  assert.doesNotMatch(
    code,
    /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'Enter'/,
    'the old ⌘/Ctrl+Enter-only send gate must be replaced by the Enter-to-send convention',
  );
});

test('Chat thread: composer.tsx copy reflects Enter-to-send / Shift+Enter-for-newline', () => {
  const src = readChat('composer.tsx');
  // The placeholder and the .composer-hint foot text must describe the new
  // behaviour — no lingering "⌘+Enter to send" operator-facing copy.
  assert.match(src, /Enter to send/, 'the placeholder must say "Enter to send"');
  assert.match(src, /Shift\+Enter for newline/, 'the placeholder must mention Shift+Enter for newline');
  assert.doesNotMatch(
    src,
    /⌘\+Enter to send/,
    'the stale "⌘+Enter to send" placeholder copy must be gone',
  );
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

// --- GAP 10: operator messages render as "Eric · You", not "AGENT" ---------
//
// PITFALL #3 — ctx.issues.createComment posts the comment as the plugin worker,
// so an operator-sent message comes back from listComments with an EMPTY
// authorUserId. The old `isMine={!!msg.authorUserId}` therefore rendered every
// operator message as "Agent". isMine must derive from senderKind === 'user'.

test('Chat thread: isMine derives from senderKind === "user", not authorUserId (GAP 10)', () => {
  const code = readChatCode('message-thread.tsx');
  // The fixed test: senderKind === 'user'.
  assert.match(
    code,
    /isMine=\{msg\.senderKind === 'user'\}/,
    'isMine must be derived from senderKind, not authorUserId (PITFALL #3)',
  );
  // The old authorUserId-based test must be gone.
  assert.doesNotMatch(
    code,
    /isMine=\{!!msg\.authorUserId\}/,
    'the !!authorUserId isMine test mislabels operator messages as Agent',
  );
});

// --- GAP 12: Promote / Pin wire contract + confirmation UX -----------------
//
// PITFALL #4 — chat_messages is operator-write-only; an agent comment has NO
// row. The reworked chat.promote / chat.pin resolve the message by commentId +
// topicIssueId. The UI's PromoteActions MUST pass exactly those keys (the old
// code passed `messageUuid: commentId` — a comment id under the wrong key).

/** Extract the keys required via reqStr(params,'KEY') in a worker handler. */
function handlerRequiredKeys(file) {
  const src = readFileSync(path.join(WORKER_DIR, file), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/reqStr\(\s*params\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
    keys.add(m[1]);
  }
  return keys;
}

test('Chat thread: PromoteActions promote({...}) passes commentId + topicIssueId (GAP 12)', () => {
  const code = readChatCode('message-thread.tsx');
  const call = code.match(/await\s+promote\(\{([\s\S]*?)\}\)/);
  assert.ok(call, 'message-thread.tsx must contain an `await promote({ ... })` call');
  const body = call[1];
  assert.match(body, /commentId/, 'promote must pass commentId');
  assert.match(body, /topicIssueId/, 'promote must pass topicIssueId');
  // The GAP 12 drift: a comment id passed under a `messageUuid` key.
  assert.doesNotMatch(
    body,
    /messageUuid/,
    'promote must not pass a `messageUuid` — chat.promote resolves by commentId now',
  );
});

test('Chat thread: chat.promote handler requires commentId + topicIssueId (GAP 12)', () => {
  const required = handlerRequiredKeys('chat-promote.ts');
  assert.deepEqual(
    [...required].sort(),
    ['commentId', 'companyId', 'topicIssueId', 'userId'],
    'chat-promote.ts must require commentId + topicIssueId (not messageUuid)',
  );
});

test('Chat thread: PromoteActions pin({...}) passes commentId + topicIssueId (GAP 12)', () => {
  const code = readChatCode('message-thread.tsx');
  const call = code.match(/await\s+pin\(\{([\s\S]*?)\}\)/);
  assert.ok(call, 'message-thread.tsx must contain an `await pin({ ... })` call');
  const body = call[1];
  assert.match(body, /commentId/, 'pin must pass commentId');
  assert.match(body, /topicIssueId/, 'pin must pass topicIssueId');
  assert.doesNotMatch(
    body,
    /messageUuid/,
    'pin must not pass a `messageUuid` — chat.pin resolves by commentId now',
  );
});

test('Chat thread: chat.pin handler reads commentId + topicIssueId, not messageUuid (GAP 12)', () => {
  const src = readFileSync(path.join(WORKER_DIR, 'chat-pin.ts'), 'utf8');
  assert.match(src, /params\?\.commentId/, 'chat-pin.ts must read commentId');
  assert.match(src, /params\?\.topicIssueId/, 'chat-pin.ts must read topicIssueId');
  assert.doesNotMatch(
    src,
    /params\?\.messageUuid/,
    'chat-pin.ts must not read messageUuid — it resolves by commentId now',
  );
});

test('Chat thread: PromoteActions surfaces visible promote/pin feedback (GAP 12)', () => {
  const code = readChatCode('message-thread.tsx');
  // The old empty catch swallowed success AND failure — now there is visible
  // feedback state surfaced through a .pa-feedback element.
  assert.match(code, /pa-feedback/, 'a .pa-feedback element must render the action outcome');
  assert.match(code, /Task created/, 'a successful promote shows a "Task created" confirmation');
  assert.match(code, /setFeedback\(/, 'the action result must drive a visible feedback state');
});

test('Chat thread: chat.css styles the .pa-feedback confirmation (GAP 12)', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  assert.match(css, /\.pa-feedback\s*\{/, '.pa-feedback must be styled');
});

// --- GAP 8: the auto-refresh indicator is static, not a looping ticker -----
//
// Earlier builds rendered a live "Auto-refreshing · next in Ns" countdown that
// decremented 15→0 and WRAPPED back to 15, looping forever. Operators read the
// perpetual loop as a stuck spinner; it drew UX complaints three times. The
// countdown number, its state (secondsToRefresh), and its 1s decrementing
// interval are removed entirely — the 15s poll runs silently underneath and
// the indicator is now a single motionless "● Live" badge.

test('Chat thread: the auto-refresh indicator carries no countdown state or interval (GAP 8)', () => {
  const code = readChatCode('message-thread.tsx');
  // No countdown state, no decrementing interval, no wrap logic.
  assert.doesNotMatch(code, /secondsToRefresh/, 'the countdown state must be gone');
  assert.doesNotMatch(code, /POLL_SECONDS/, 'the POLL_SECONDS countdown constant must be gone');
  assert.doesNotMatch(code, /setInterval/, 'the 1s countdown interval must be gone');
  assert.doesNotMatch(
    code,
    /s > 1 \? s - 1/,
    'the countdown decrement/wrap expression must be gone',
  );
});

test('Chat thread: the auto-refresh indicator is a legible, static, muted style (GAP 8)', () => {
  const css = readFileSync(
    path.resolve(HERE, '..', '..', 'src', 'ui', 'styles', 'chat.css'),
    'utf8',
  );
  const block = css.match(/\.auto-refresh\s*\{([^}]*)\}/);
  assert.ok(block, '.auto-refresh must be styled');
  // --ink-4 (#52503f) was illegibly dim; the indicator must use a brighter ink.
  assert.doesNotMatch(
    block[1],
    /color:\s*var\(--ink-4\)/,
    'the auto-refresh indicator must not use the illegibly-dim --ink-4',
  );
  assert.match(
    block[1],
    /color:\s*var\(--ink-3\)/,
    'the static indicator uses the legible-but-muted --ink-3',
  );
  // The indicator must carry no animation — a calm, motionless badge.
  assert.doesNotMatch(block[1], /animation/, 'the indicator must not animate');
  assert.doesNotMatch(block[1], /transition/, 'the indicator must not transition');
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
