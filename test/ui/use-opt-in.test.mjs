// test/ui/use-opt-in.test.mjs
//
// Plan 02-04 Task 1 RED — useOptIn() hook source contract. Node 24's native
// strip-types cannot load .tsx via the test runtime, so this is a SOURCE-GREP
// test (same convention as test/ui/reader-view.test.mjs).
//
// Verifies:
//   - useOptIn lives at src/ui/primitives/use-opt-in.ts (TS, not TSX — pure logic)
//   - Calls usePluginData('get-opt-in', {userId}) — passes userId from useHostContext
//   - Calls usePluginAction('set-opt-in')
//   - Exposes optedIn (boolean), loading, toggle
//   - optedIn = data?.optedInAt != null
//   - toggle calls action with {userId, optedInAt: <new value>}

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-opt-in.ts');

test('use-opt-in.ts exists at src/ui/primitives/', () => {
  assert.ok(existsSync(HOOK_PATH), `expected ${HOOK_PATH} to exist`);
});

test('use-opt-in.ts exports useOptIn', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  assert.match(src, /export\s+function\s+useOptIn\b/);
});

test('use-opt-in.ts calls usePluginData with key "get-opt-in"', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  assert.match(src, /usePluginData[\s\S]*['"]get-opt-in['"]/);
});

test('use-opt-in.ts calls usePluginAction with key "set-opt-in"', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  assert.match(src, /usePluginAction[\s\S]*['"]set-opt-in['"]/);
});

test('use-opt-in.ts reads userId from useHostContext (UI-side identity, NOT a fictional ctx.host)', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  assert.match(src, /useHostContext\b/);
});

test('use-opt-in.ts computes optedIn via "optedInAt != null" (or similar non-null check)', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  // Either explicit `optedInAt != null` or `Boolean(optedInAt)` or `!= undefined` patterns
  assert.match(src, /optedInAt\s*!=\s*null|Boolean\([^)]*optedInAt/);
});

test('use-opt-in.ts exposes a toggle function that flips optedInAt between null and ISO string', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  // Toggle should reference both null and new Date().toISOString() (or a static ISO assignment)
  assert.match(src, /toggle\b/);
  assert.match(src, /toISOString\(\)/);
});

test('use-opt-in.ts passes {userId} in the usePluginData params (so the worker handler can identify the caller)', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  // Expect a `usePluginData(..., { userId })` or `userId: <expression>` shape near the get-opt-in call.
  assert.match(src, /usePluginData[\s\S]*get-opt-in[\s\S]*userId/);
});
