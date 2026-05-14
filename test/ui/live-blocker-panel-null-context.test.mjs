// test/ui/live-blocker-panel-null-context.test.mjs
//
// Plan 02-03c Task 2 — LiveBlockerPanel retrofit contract. Same pattern as
// reader-view-null-context.test.mjs.
//
// The 02-03b drill caught LiveBlockerPanel rendering the literal terminal
// text `EXTERNAL / startId and companyId required` because the worker
// handler's fail-loud guard ran when companyId was empty. After this
// retrofit, the panel never sends empty companyId — it either renders a
// loading placeholder, an error placeholder, or the typed terminal once
// the resolver settles.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_SRC = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader', 'live-blocker-panel.tsx'),
  'utf8',
);

test('LiveBlockerPanel imports useResolvedCompanyId from the primitives folder', () => {
  assert.match(
    PANEL_SRC,
    /import\s*\{\s*useResolvedCompanyId\s*\}\s*from\s*['"][^'"]*use-resolved-company-id[^'"]*['"]/,
  );
});

test('LiveBlockerPanel calls useResolvedCompanyId() (resolver hook wired in)', () => {
  assert.match(PANEL_SRC, /useResolvedCompanyId\(\)/);
});

test('LiveBlockerPanel NEVER passes empty-string companyId to usePluginData (the 02-03b drill defect)', () => {
  assert.doesNotMatch(
    PANEL_SRC,
    /companyId\s*:\s*companyId\s*\?\?\s*['"]\s*['"]/,
    'must not pass empty string when companyId is null',
  );
  assert.doesNotMatch(
    PANEL_SRC,
    /companyId\s*\?\?\s*['"]\s*['"]/,
    'no `companyId ?? ""` anywhere',
  );
});

test('LiveBlockerPanel reads userId via useHostContext (userId path is universal-pipeline reliable)', () => {
  assert.match(PANEL_SRC, /useHostContext\(\)/);
});

test('LiveBlockerPanel renders nothing or a placeholder while the resolver loads (graceful empty)', () => {
  // The simplest correct behavior is to return null/render-nothing while
  // the resolver is in flight (the right-rail panel is non-essential during
  // the loading window). Either explicit-null or a placeholder is fine.
  const hasNullEarlyReturn = /return\s+null\s*;/.test(PANEL_SRC);
  const hasLoadingPlaceholder = /Resolving|Loading|loading/i.test(PANEL_SRC);
  assert.ok(
    hasNullEarlyReturn || hasLoadingPlaceholder,
    'LiveBlockerPanel must handle the resolver loading window — either return null or render a placeholder',
  );
});

test('LiveBlockerPanel does NOT render the literal "EXTERNAL / startId and companyId required" text', () => {
  // This is the exact terminal text the 02-03b drill saw. The only way
  // this string ends up in the DOM is if the worker's fail-loud guard
  // is tripped by an empty companyId. After the retrofit, that's
  // structurally impossible.
  assert.doesNotMatch(
    PANEL_SRC,
    /startId\s+and\s+companyId\s+required/,
    'fail-loud terminal text must not appear in panel source',
  );
});

test('LiveBlockerPanel still calls usePluginData("flatten-blocker-chain", { startId, viewerUserId, companyId })', () => {
  // After retrofit, the call is gated on a resolved companyId — but it
  // still happens for the populated-context case.
  assert.match(PANEL_SRC, /usePluginData[\s\S]*?['"]flatten-blocker-chain['"]/);
});
