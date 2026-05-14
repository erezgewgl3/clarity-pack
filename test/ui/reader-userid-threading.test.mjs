// test/ui/reader-userid-threading.test.mjs
//
// Plan 02-09 Task 2 — DEV-15-STRUCTURAL threading contract. Source-grep based
// (same convention as test/ui/reader-view-null-context.test.mjs +
// live-blocker-panel-null-context.test.mjs).
//
// Background: Plan 02-04/02-08 drill caught useHostContext().userId returning
// null in detail-tab slots, which made every opt-in-guard-wrapped UI call
// fail-closed with {error:'OPT_IN_REQUIRED'}. Task 1 introduced
// useResolvedUserId() as the fix; this test pins the threading at every
// wrapped-handler call site.
//
// Files that MUST thread the resolver:
//   - src/ui/surfaces/reader/index.tsx       (issue.reader)
//   - src/ui/surfaces/reader/pause-banner.tsx (editor.pause-status)
//   - src/ui/surfaces/reader/live-blocker-panel.tsx (flatten-blocker-chain)
//   - src/ui/primitives/ref-chip.tsx         (resolve-refs)
//
// All four handlers are wrapped by opt-in-guard (see EXEMPT_HANDLER_KEYS —
// they are NOT in the exempt list, so they require a viewer identity in
// params).
//
// Runtime DOM behavior is verified end-to-end by the Plan 02-09 Task 4
// manual re-drill against Countermoves.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, '..', '..', 'src', 'ui');

function readSrc(rel) {
  return readFileSync(path.join(SRC_ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Reader (issue.reader) — src/ui/surfaces/reader/index.tsx
// ---------------------------------------------------------------------------

test('ReaderView imports useResolvedUserId (DEV-15-STRUCTURAL closure)', () => {
  const src = readSrc('surfaces/reader/index.tsx');
  assert.match(
    src,
    /import\s*\{\s*useResolvedUserId\s*\}\s*from\s*['"][^'"]*use-resolved-user-id[^'"]*['"]/,
    'ReaderView must import useResolvedUserId',
  );
});

test('ReaderView calls useResolvedUserId() (resolver hook wired in)', () => {
  const src = readSrc('surfaces/reader/index.tsx');
  assert.match(src, /useResolvedUserId\(\)/);
});

test('ReaderView does NOT thread `context.userId` directly to usePluginData("issue.reader") — must use resolver', () => {
  const src = readSrc('surfaces/reader/index.tsx');
  // Negative grep: the old buggy pattern was `userId: userId ?? ''` where
  // userId came from context.userId. The resolver wraps that null window so
  // we should not be passing `context.userId` or a `?? ''` fallback into
  // issue.reader anymore.
  // Look for the issue.reader call block (200 chars after the literal).
  const issueReaderCall = src.match(/usePluginData[^(]*\([^)]*['"]issue\.reader['"][\s\S]{0,300}/);
  assert.ok(issueReaderCall, 'issue.reader call exists');
  assert.doesNotMatch(
    issueReaderCall[0],
    /userId\s*:\s*userId\s*\?\?\s*['"]\s*['"]/,
    'must not pass `userId ?? ""` to issue.reader — use the resolver',
  );
});

test('ReaderView gates rendering on resolver-pending state (loading placeholder, no crash)', () => {
  const src = readSrc('surfaces/reader/index.tsx');
  // The component must check the resolver's loading flag before issuing the
  // worker call. Look for a userIdLoading or similar guarded branch.
  const hasLoadingGate =
    /userIdLoading|userIdLoading\b/.test(src) ||
    /loading\s*:\s*userIdLoading/.test(src) ||
    /useResolvedUserId\(\)[\s\S]{0,500}loading/.test(src);
  assert.ok(hasLoadingGate, 'ReaderView must gate on the resolver loading flag');
});

test('ReaderView issue.reader call passes a real userId from the resolver, not from context', () => {
  const src = readSrc('surfaces/reader/index.tsx');
  // The issue.reader call must include `userId` in its params, sourced from
  // the resolver (not from context.userId or `??''`).
  assert.match(src, /usePluginData[\s\S]*?['"]issue\.reader['"][\s\S]{0,300}userId/);
});

// ---------------------------------------------------------------------------
// PauseBanner (editor.pause-status) — src/ui/surfaces/reader/pause-banner.tsx
// ---------------------------------------------------------------------------

test('PauseBanner imports useResolvedUserId', () => {
  const src = readSrc('surfaces/reader/pause-banner.tsx');
  assert.match(
    src,
    /import\s*\{\s*useResolvedUserId\s*\}\s*from\s*['"][^'"]*use-resolved-user-id[^'"]*['"]/,
  );
});

test('PauseBanner calls useResolvedUserId()', () => {
  const src = readSrc('surfaces/reader/pause-banner.tsx');
  assert.match(src, /useResolvedUserId\(\)/);
});

test('PauseBanner does NOT use useHostContext().userId directly (must come from resolver)', () => {
  const src = readSrc('surfaces/reader/pause-banner.tsx');
  // The pre-02-09 pattern read userId from useHostContext directly. The fix
  // routes through the resolver. The literal `useHostContext` may still
  // appear for other fields (companyId etc), but we should not see
  // `userId` destructured from useHostContext.
  assert.doesNotMatch(
    src,
    /\{\s*userId[^}]*\}\s*=\s*useHostContext\(\)/,
    'PauseBanner must not destructure userId from useHostContext — use the resolver',
  );
});

test('PauseBanner editor.pause-status call passes a resolver-sourced userId', () => {
  const src = readSrc('surfaces/reader/pause-banner.tsx');
  assert.match(src, /usePluginData[\s\S]*?['"]editor\.pause-status['"][\s\S]{0,300}userId/);
});

// ---------------------------------------------------------------------------
// LiveBlockerPanel (flatten-blocker-chain) — src/ui/surfaces/reader/live-blocker-panel.tsx
// ---------------------------------------------------------------------------

test('LiveBlockerPanel imports useResolvedUserId', () => {
  const src = readSrc('surfaces/reader/live-blocker-panel.tsx');
  assert.match(
    src,
    /import\s*\{\s*useResolvedUserId\s*\}\s*from\s*['"][^'"]*use-resolved-user-id[^'"]*['"]/,
  );
});

test('LiveBlockerPanel calls useResolvedUserId()', () => {
  const src = readSrc('surfaces/reader/live-blocker-panel.tsx');
  assert.match(src, /useResolvedUserId\(\)/);
});

test('LiveBlockerPanel does NOT destructure userId from useHostContext (must come from resolver)', () => {
  const src = readSrc('surfaces/reader/live-blocker-panel.tsx');
  assert.doesNotMatch(
    src,
    /\{\s*userId[^}]*\}\s*=\s*useHostContext\(\)/,
    'LiveBlockerPanel must not destructure userId from useHostContext — use the resolver',
  );
});

test('LiveBlockerPanel flatten-blocker-chain call still passes viewerUserId (the wrapped handler legacy name)', () => {
  const src = readSrc('surfaces/reader/live-blocker-panel.tsx');
  // The 02-03c thread name is viewerUserId — opt-in-guard.extractUserId
  // accepts both userId and viewerUserId, but the flatten-blocker-chain call
  // site uses viewerUserId historically. Keep that name; just source the
  // value from the resolver.
  assert.match(
    src,
    /usePluginData[\s\S]*?['"]flatten-blocker-chain['"][\s\S]{0,400}viewerUserId/,
  );
});

// ---------------------------------------------------------------------------
// RefChip (resolve-refs) — src/ui/primitives/ref-chip.tsx
// ---------------------------------------------------------------------------

test('RefChip imports useResolvedUserId', () => {
  const src = readSrc('primitives/ref-chip.tsx');
  assert.match(
    src,
    /import\s*\{\s*useResolvedUserId\s*\}\s*from\s*['"][^'"]*use-resolved-user-id[^'"]*['"]/,
  );
});

test('RefChip calls useResolvedUserId()', () => {
  const src = readSrc('primitives/ref-chip.tsx');
  assert.match(src, /useResolvedUserId\(\)/);
});

test('RefChip does NOT destructure userId from useHostContext (must come from resolver)', () => {
  const src = readSrc('primitives/ref-chip.tsx');
  assert.doesNotMatch(
    src,
    /\{\s*userId[^}]*\}\s*=\s*useHostContext\(\)/,
    'RefChip must not destructure userId from useHostContext — use the resolver',
  );
});

test('RefChip resolve-refs call passes a resolver-sourced userId', () => {
  const src = readSrc('primitives/ref-chip.tsx');
  assert.match(src, /usePluginData[\s\S]*?['"]resolve-refs['"][\s\S]{0,300}userId/);
});

// ---------------------------------------------------------------------------
// Cross-cutting: no `userId: '' || userId ?? ''` antipattern in wrapped-handler call sites
// ---------------------------------------------------------------------------

test('no wrapped-handler call site silently passes empty-string userId (the DEV-15 defect class)', () => {
  const files = [
    'surfaces/reader/index.tsx',
    'surfaces/reader/pause-banner.tsx',
    'surfaces/reader/live-blocker-panel.tsx',
    'primitives/ref-chip.tsx',
  ];
  for (const f of files) {
    const src = readSrc(f);
    // The bug class was `userId: userId ?? ''` — defending it here. Allow
    // empty-string fallback for OTHER fields (only userId/viewerUserId are
    // the load-bearing identity fields opt-in-guard reads).
    assert.doesNotMatch(
      src,
      /userId\s*:\s*\w*userId\w*\s*\?\?\s*['"]\s*['"]/,
      `${f} must not pass userId fallback "" anywhere`,
    );
    assert.doesNotMatch(
      src,
      /viewerUserId\s*:\s*\w*userId\w*\s*\?\?\s*['"]\s*['"]/,
      `${f} must not pass viewerUserId fallback "" anywhere`,
    );
  }
});
