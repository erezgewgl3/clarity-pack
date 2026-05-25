// test/ui/context-rail-storage-pin.test.mjs
//
// Plan 05-08 (D-20) — Storage pin live wiring + ChatTopic type extension.
//
// SP-A: context-rail.tsx renders the Storage pin as a <button> with onClick
//        dispatching chat.topic.pin.
// SP-B: pinned visual state shown when topic.pinnedAt is non-null.
// SP-C: onPinChanged callback wired so chat.topics refetches.
// SP-D: showToast fires 'Topic pinned' / 'Topic unpinned'.
// SP-E: ChatTopic type (topic-strip.tsx) grows pinnedAt?: string | null.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CONTEXT_RAIL = path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'context-rail.tsx');
const TOPIC_STRIP = path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'topic-strip.tsx');
const INDEX_TSX = path.join(ROOT, 'src', 'ui', 'surfaces', 'chat', 'index.tsx');

const RAIL_SRC = readFileSync(CONTEXT_RAIL, 'utf8');
const STRIP_SRC = readFileSync(TOPIC_STRIP, 'utf8');
const INDEX_SRC = readFileSync(INDEX_TSX, 'utf8');

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const RAIL_CODE = code(RAIL_SRC);

test('Storage-pin-files-exist', () => {
  assert.ok(existsSync(CONTEXT_RAIL));
  assert.ok(existsSync(TOPIC_STRIP));
});

// ---- SP-A — Storage pin is a <button> dispatching chat.topic.pin --------

test('SP-A: storage-pin renders as a <button type="button"> with chat.topic.pin dispatch', () => {
  // Look at the Storage pin block specifically.
  const block = RAIL_CODE.match(
    /<h3>Storage pin<\/h3>[\s\S]*?<button[\s\S]*?storage-pin-toggle/,
  );
  assert.ok(block, 'Storage pin block uses a <button> with the toggle data-attr');
  assert.match(RAIL_CODE, /usePluginAction\(\s*['"]chat\.topic\.pin['"]\s*\)/);
  // pinAction is invoked inside the click handler.
  assert.match(RAIL_CODE, /pinAction\(/);
  // dispatch payload includes topicIssueId + pinned + companyId + userId.
  const payload = RAIL_CODE.match(/pinAction\(\s*\{[\s\S]{0,200}?\}/);
  assert.ok(payload);
  assert.match(payload[0], /topicIssueId/);
  assert.match(payload[0], /pinned/);
});

// ---- SP-B — visual state reflects topic.pinnedAt ------------------------

test('SP-B: card visual state reflects topic.pinnedAt (pinned vs unpinned)', () => {
  // `topic.pinnedAt` consulted to decide the icon + byline.
  assert.match(RAIL_CODE, /topic\.pinnedAt/);
  assert.match(RAIL_SRC, /Pinned — exempt from archive/);
  // The 📌 icon is used in the pinned branch.
  assert.match(RAIL_SRC, /📌/);
});

// ---- SP-C — onPinChanged callback threaded from parent ------------------

test('SP-C: ContextRail accepts onPinChanged prop AND parent threads it (chat/index.tsx)', () => {
  assert.match(RAIL_SRC, /onPinChanged\?:\s*\(\)\s*=>\s*void/);
  // Parent ChatPageBody passes onPinChanged so the chat.topics refetches.
  assert.match(INDEX_SRC, /onPinChanged=\{/);
});

// ---- SP-D — success toast fires 'Topic pinned' / 'Topic unpinned' -------

test('SP-D: success path fires showToast with Topic pinned / Topic unpinned copy', () => {
  assert.match(RAIL_CODE, /showToast/);
  assert.match(RAIL_SRC, /Topic pinned/);
  assert.match(RAIL_SRC, /Topic unpinned/);
});

// ---- SP-E — ChatTopic type carries pinnedAt? -----------------------------

test('SP-E: topic-strip.tsx ChatTopic type carries pinnedAt?: string | null', () => {
  // Match across whitespace for the pinnedAt field declaration on ChatTopic.
  assert.match(STRIP_SRC, /pinnedAt\?:\s*string\s*\|\s*null/);
});

// ---- SP-no-host-mutation: the rail itself doesn't call ctx.issues.update

test('SP-no-host-issue: context-rail.tsx never calls ctx.issues.update (CTT-07 UI-tier sanity)', () => {
  // The UI tier should never directly hit issues.update — all writes flow
  // via plugin actions. (The plugin action chat.topic.pin is plugin-side
  // only — CTT-07 by construction in chat-topic-pin.ts.)
  assert.doesNotMatch(RAIL_CODE, /ctx\.issues\.update/);
});
