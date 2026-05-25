// test/ui/deep-link.test.mjs
//
// Plan 05-05 Task 3 (D-10) — buildTopicDeepLink employeeUserId extension +
// caller audit. Closes GAP-PICKER-ROW-DISPATCH (the rc.7 ambiguous-picker
// row click landed on the chat surface's empty `Select an employee` state
// because the URL_HASH deep link carried no `employee` field, so the chat
// dispatch's `setEmployee(matched)` chain matched nothing).
//
// The fix is on the EMITTER side — buildTopicDeepLink now accepts an
// optional third argument `employeeUserId` that threads into the encoded
// payload as `employee`. Chat-surface dispatch (Plan 04.2-04) reads
// link.employee, looks up the matching RosterEmployee, and calls
// setEmployee BEFORE setTopic — the existing consumer path is unchanged.
//
// The audit IS the load-bearing work. `grep -rn 'buildTopicDeepLink(' src/`
// must return EXACTLY THREE lines after this plan:
//   1. The export definition in deep-link.mjs
//   2. The type declaration in deep-link.d.mts
//   3. The fixed caller in reverse-topics-link.tsx (passes t.employeeAgentId)
//
// `node --test` runs against the pure helper (.mjs) — no JSDOM needed.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildTopicDeepLink,
  parseChatDeepLink,
} from '../../src/ui/surfaces/chat/deep-link.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', 'src');

// ---------------------------------------------------------------------------
// Behaviour — buildTopicDeepLink accepts optional 3rd arg
// ---------------------------------------------------------------------------

test('D-10 — buildTopicDeepLink(prefix, topicId) with NO third arg still encodes WITHOUT `employee` (back-compat)', () => {
  const built = buildTopicDeepLink('COU', 'topic-abc');
  assert.ok(built, 'returns navigable link');
  assert.match(built.to, /^\/COU\/chat#h=/, 'fragment carrier');
  // Parse it back and assert link.employee is null (no employee threaded).
  const link = parseChatDeepLink({ hash: extractHash(built.to) });
  assert.ok(link, 'round-trip resolves');
  assert.equal(link.topic, 'topic-abc');
  assert.equal(link.employee, null, 'no employee field when not provided');
});

test('D-10 — buildTopicDeepLink(prefix, topicId, employeeUserId) threads `employee` into encoded payload', () => {
  const built = buildTopicDeepLink('COU', 'topic-abc', 'agent-uuid-77');
  assert.ok(built, 'returns navigable link');
  assert.match(built.to, /^\/COU\/chat#h=/);
  const link = parseChatDeepLink({ hash: extractHash(built.to) });
  assert.ok(link);
  assert.equal(link.topic, 'topic-abc');
  assert.equal(link.employee, 'agent-uuid-77', 'employee threads through the encoded fragment');
});

test('D-10 — empty-string employeeUserId is treated as undefined (str() helper defensiveness)', () => {
  const built = buildTopicDeepLink('COU', 'topic-abc', '');
  assert.ok(built);
  const link = parseChatDeepLink({ hash: extractHash(built.to) });
  assert.ok(link);
  assert.equal(link.employee, null, 'empty string degrades to null (no employee in payload)');
});

test('D-10 — undefined employeeUserId is treated as absent (the back-compat 2-arg path)', () => {
  // eslint-disable-next-line no-undefined
  const built = buildTopicDeepLink('COU', 'topic-abc', undefined);
  assert.ok(built);
  const link = parseChatDeepLink({ hash: extractHash(built.to) });
  assert.ok(link);
  assert.equal(link.employee, null);
});

// ---------------------------------------------------------------------------
// Caller audit — grep-style assertion that closes GAP-PICKER-ROW-DISPATCH
// ---------------------------------------------------------------------------

test('caller audit — every src/ caller of buildTopicDeepLink passes the employeeUserId third arg (or is the export itself)', () => {
  // Read the file system for callers. The audit is the load-bearing work
  // of D-10: ANY caller that doesn't pass employee is a latent
  // GAP-PICKER-ROW-DISPATCH regression.
  const reverseTopics = readFileSync(
    path.join(SRC, 'ui', 'surfaces', 'reader', 'reverse-topics-link.tsx'),
    'utf8',
  );
  // The fix must pass t.employeeAgentId as the third arg. Multi-line form
  // tolerated — `s` flag (dotall) lets . match newlines so the test pins
  // semantics, not exact whitespace.
  assert.match(
    reverseTopics,
    /buildTopicDeepLink\(\s*companyPrefix\s*,\s*t\.topicIssueId\s*,\s*t\.employeeAgentId\s*,?\s*\)/s,
    'reverse-topics-link.tsx passes t.employeeAgentId to buildTopicDeepLink (D-10 fix)',
  );
});

test('caller audit — exactly three buildTopicDeepLink( occurrences in src/ (export + .d.mts + the fixed caller)', () => {
  // Static check: walk the known files (.mjs, .d.mts, .tsx) and count
  // occurrences of `buildTopicDeepLink(`. Anything else is an audit miss.
  const files = [
    path.join(SRC, 'ui', 'surfaces', 'chat', 'deep-link.mjs'),
    path.join(SRC, 'ui', 'surfaces', 'chat', 'deep-link.d.mts'),
    path.join(SRC, 'ui', 'surfaces', 'reader', 'reverse-topics-link.tsx'),
  ];
  let total = 0;
  const perFile = {};
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Strip comments to avoid false positives in JSDoc / `//` headers.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const matches = stripped.match(/buildTopicDeepLink\(/g) ?? [];
    perFile[f] = matches.length;
    total += matches.length;
  }
  assert.equal(
    total,
    3,
    `expected exactly 3 buildTopicDeepLink( occurrences across the export + .d.mts + the fixed caller; got ${total}. Per-file: ${JSON.stringify(perFile)}`,
  );
});

test('caller audit — .d.mts signature mirrors the .mjs change (optional employeeUserId?: string)', () => {
  const dts = readFileSync(path.join(SRC, 'ui', 'surfaces', 'chat', 'deep-link.d.mts'), 'utf8');
  assert.match(
    dts,
    /employeeUserId\?:\s*string/,
    '.d.mts buildTopicDeepLink signature includes optional employeeUserId?: string',
  );
});

// ---------------------------------------------------------------------------
// No version bump — package.json + src/manifest.ts UNTOUCHED by this plan
// ---------------------------------------------------------------------------

test('NO version bump — package.json stays at rc.7 (the phase-wide bump lives in Plan 05-10 only)', () => {
  const pkgPath = path.join(SRC, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.version, '1.0.0-rc.7', 'package.json version unchanged by Plan 05-05');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHash(to) {
  const i = to.indexOf('#');
  return i === -1 ? '' : to.slice(i);
}
