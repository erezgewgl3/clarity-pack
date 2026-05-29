// test/ui/chat-seed-first-message.test.mjs
//
// Bug (2026-05-29, live BEAAA): the Reader→"Continue in chat" seeded New-Topic
// dialog has a "First message" field (seedDialog.body), but handleSeededCreate
// only called chat.topic.create (which has NO first-message param) and dropped
// the body — the topic was created EMPTY ("No messages yet") and the operator's
// first message vanished (no chat.send, no comment in the worker log).
//
// Fix: after chat.topic.create succeeds, handleSeededCreate posts seedDialog.body
// as the first message via the chat.send action (the same path the composer
// uses) to the newly-created topic's issueId. Source-grep idiom (Node strip-types
// loads .ts but not .tsx; runtime behaviour is verified on the live drill).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'chat', 'index.tsx');
const raw = readFileSync(INDEX, 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('chat/index wires a chat.send action (to post the seeded first message)', () => {
  assert.match(code, /usePluginAction\(\s*['"]chat\.send['"]\s*\)/, 'expected usePluginAction(\'chat.send\') in chat/index.tsx');
});

test('handleSeededCreate captures the seed dialog body as the first message', () => {
  // The body is captured into a named const (not just bound to the textarea).
  assert.match(code, /seedFirstMessage\s*=\s*seedDialog\.body\.trim\(\)/, 'expected the seed body captured as seedFirstMessage');
});

test('the seeded first message is POSTED to the newly-created topic via chat.send', () => {
  // Must target the freshly created topic issue (created.issueId), not a stale one,
  // and carry the captured body. This is what was missing — the message had no
  // transport after chat.topic.create.
  assert.match(code, /topicIssueId:\s*created\.issueId/, 'expected the send to target the new topic created.issueId');
  assert.match(code, /body:\s*seedFirstMessage/, 'expected the captured seed body sent as the message body');
});

test('the seed first-message send is guarded on a non-empty body (empty body => no send)', () => {
  assert.match(code, /if\s*\(\s*seedFirstMessage\s*\)/, 'expected the post to be guarded on a non-empty seedFirstMessage');
});
