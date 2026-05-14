// test/ui/use-leader-election.test.mjs
//
// Plan 02-04 Task 2 RED — useLeaderElection({channelName}). Source-grep contract
// + pure helper tests (the React-state lifecycle is covered by the
// use-poll-with-leader two-tab integration test).
//
// Verifies:
//   - file exists at src/ui/primitives/use-leader-election.ts
//   - imports BroadcastChannel (referenced by name in the file)
//   - exports useLeaderElection
//   - file contains explicit fallback for "typeof BroadcastChannel === 'undefined'"
//   - Returns shape includes `isLeader` (boolean) and `available` (boolean)
//   - Re-announces leader periodically (literal setInterval call)

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-leader-election.ts');

test('use-leader-election.ts exists', () => {
  assert.ok(existsSync(HOOK), `expected ${HOOK} to exist`);
});

test('use-leader-election.ts exports useLeaderElection', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /export\s+function\s+useLeaderElection\b/);
});

test('use-leader-election.ts uses BroadcastChannel', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /\bnew\s+BroadcastChannel\b/);
});

test('use-leader-election.ts has explicit fallback for missing BroadcastChannel', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /typeof\s+BroadcastChannel\s*===\s*['"]undefined['"]|typeof\s+BroadcastChannel\s*!==\s*['"]undefined['"]/);
});

test('use-leader-election.ts re-announces leader periodically (setInterval)', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /setInterval/);
});

test('use-leader-election.ts returns {isLeader, available} shape', () => {
  const src = readFileSync(HOOK, 'utf8');
  // The TypeScript declaration includes both field names.
  assert.match(src, /isLeader/);
  assert.match(src, /available/);
});
