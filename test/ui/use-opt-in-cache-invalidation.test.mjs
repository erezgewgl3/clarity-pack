// test/ui/use-opt-in-cache-invalidation.test.mjs
//
// Plan 02-08 Task 3 RED — DEV-10 closure. useOptIn().toggle() must invalidate
// the get-opt-in cache so the UI flips from CTA to data-bound view without a
// hard refresh.
//
// SOURCE-GREP convention (Node 24 can't load .tsx through the test runtime).
// We verify the source contains EITHER:
//   - usePluginData(...).refresh() call after setOptIn resolves (Path A — SDK
//     exposes `refresh` per PluginDataResult.d.ts:328), OR
//   - a setState/invalidationKey bump threaded through usePluginData params
//     (Path B fallback if Path A is unavailable).
//
// Plan 02-08 prefers Path A — verified `refresh()` exists on the SDK's
// PluginDataResult shape via grep on hooks.d.ts:11 + types.d.ts:328.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-opt-in.ts');

function readSrc() {
  return readFileSync(HOOK_PATH, 'utf8');
}

// Path A: destructure refresh from usePluginData, call as refresh() (no dot).
// Path B: bump an invalidationKey React state and thread through usePluginData params.
function detectPathA(src) {
  // Must destructure `refresh` from usePluginData AND call it (either as
  // `refresh()` or `.refresh()`).
  const destructures = /const\s*\{[^}]*\brefresh\b[^}]*\}\s*=\s*usePluginData/.test(src);
  const calls = /(^|[^.\w])refresh\(\)/m.test(src) || /\.refresh\(\)/.test(src);
  return destructures && calls;
}

function detectPathB(src) {
  return /invalidationKey/.test(src) && /setVersion|setInvalidationKey|setKey/.test(src);
}

test('use-opt-in.ts toggle invalidates get-opt-in cache via refresh() (Path A) OR an invalidationKey bump (Path B) (DEV-10)', () => {
  const src = readSrc();
  assert.ok(
    detectPathA(src) || detectPathB(src),
    'expected useOptIn to call refresh() (Path A) or bump an invalidationKey state (Path B) after setOptIn resolves',
  );
});

test('use-opt-in.ts destructures refresh from usePluginData (Path A wiring)', () => {
  const src = readSrc();
  // Only assert if Path A is used; otherwise Path B's params-bump is fine.
  if (detectPathA(src)) {
    assert.match(
      src,
      /const\s*\{[^}]*\brefresh\b[^}]*\}\s*=\s*usePluginData/,
      'expected `const { ..., refresh } = usePluginData(...)` destructure',
    );
  } else {
    // Path B: usePluginData params include the invalidationKey.
    assert.match(
      src,
      /usePluginData[\s\S]*invalidationKey/,
      'expected invalidationKey threaded through usePluginData params (Path B)',
    );
  }
});

test('use-opt-in.ts toggle awaits setOptIn and then calls refresh / bumps key (sequence contract)', () => {
  const src = readSrc();
  // Find the toggle function body. Support both forms:
  //   const toggle = async (): Promise<void> => { ... };
  //   async function toggle() { ... }
  const toggleMatch = src.match(/toggle\s*=\s*async[\s\S]*?\}\s*;/) || src.match(/async\s+function\s+toggle[\s\S]*?\n\}/);
  assert.ok(toggleMatch, 'expected toggle to be an async function');
  const body = toggleMatch[0];
  const setOptInIdx = body.search(/setOptIn\(/);
  // Either refresh() call (with or without dot prefix) or a setVersion bump
  const refreshIdx = body.search(/(^|[^.\w])refresh\(\)|\.refresh\(\)|setVersion\(|setInvalidationKey\(/m);
  assert.ok(setOptInIdx >= 0, 'toggle body must call setOptIn');
  assert.ok(refreshIdx >= 0, `toggle body must call refresh or bump invalidation key. Body:\n${body}`);
  assert.ok(setOptInIdx < refreshIdx, 'toggle must await setOptIn BEFORE invalidating');
});
