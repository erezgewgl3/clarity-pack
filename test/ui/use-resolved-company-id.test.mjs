// test/ui/use-resolved-company-id.test.mjs
//
// Plan 02-03c Task 2 — coverage for the useResolvedCompanyId hook.
//
// Two halves:
//   1. Pure-function unit tests for `extractCompanyPrefixFromPathname` —
//      runs under `node --test` (the helper is a plain TS export, no JSX).
//   2. Source-grep tests for the React hook's structural contract — same
//      pattern as test/ui/reader-view.test.mjs because the project doesn't
//      ship a jsdom/vitest runner. Runtime behavior is exercised end-to-end
//      by the Plan 02-03c Task 4 manual rehearsal drill.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { extractCompanyPrefixFromPathname } from '../../src/ui/primitives/use-resolved-company-id.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SRC = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'primitives', 'use-resolved-company-id.ts'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Pure-function: extractCompanyPrefixFromPathname
// ---------------------------------------------------------------------------

test('extracts COU from /COU/issues/COU-4 (the canonical detail-tab URL)', () => {
  assert.equal(extractCompanyPrefixFromPathname('/COU/issues/COU-4'), 'COU');
});

test('extracts BEAAA from /BEAAA (root company URL, no trailing slash)', () => {
  assert.equal(extractCompanyPrefixFromPathname('/BEAAA'), 'BEAAA');
});

test('extracts BEAAA from /BEAAA/ (trailing slash variant)', () => {
  assert.equal(extractCompanyPrefixFromPathname('/BEAAA/'), 'BEAAA');
});

test('extracts COU from /COU/plugins/clarity-pack/situation-room (page slot URL)', () => {
  assert.equal(
    extractCompanyPrefixFromPathname('/COU/plugins/clarity-pack/situation-room'),
    'COU',
  );
});

test('returns null for the root path "/"', () => {
  assert.equal(extractCompanyPrefixFromPathname('/'), null);
});

test('returns null for an empty string', () => {
  assert.equal(extractCompanyPrefixFromPathname(''), null);
});

test('returns null for whitespace-only', () => {
  assert.equal(extractCompanyPrefixFromPathname('   '), null);
});

test('returns null for null/undefined input (defensive — useHostLocation may return either)', () => {
  assert.equal(extractCompanyPrefixFromPathname(null), null);
  assert.equal(extractCompanyPrefixFromPathname(undefined), null);
});

test('extracts segment correctly even if it starts with a number', () => {
  assert.equal(extractCompanyPrefixFromPathname('/123co/issues/123co-1'), '123co');
});

test('case-preserving — does NOT lowercase or normalize', () => {
  assert.equal(extractCompanyPrefixFromPathname('/MixedCase/issues/X-1'), 'MixedCase');
});

// ---------------------------------------------------------------------------
// Hook source-grep: structural contract enforcement
// ---------------------------------------------------------------------------

test('hook exports useResolvedCompanyId as a named export', () => {
  assert.match(HOOK_SRC, /export function useResolvedCompanyId\b/);
});

test('hook exports the ResolvedCompanyId result type', () => {
  assert.match(HOOK_SRC, /export type ResolvedCompanyId/);
});

test('hook reads useHostContext for the primary companyId path', () => {
  assert.match(HOOK_SRC, /useHostContext\(\)/);
});

test('hook reads useHostLocation for the URL-parse fallback', () => {
  assert.match(HOOK_SRC, /useHostLocation\(\)/);
});

test('hook calls usePluginData with the companies.resolve-prefix key', () => {
  assert.match(HOOK_SRC, /usePluginData[\s\S]*?['"]companies\.resolve-prefix['"]/);
});

test('hook returns "no-company-context" error literal when no prefix is available', () => {
  assert.match(HOOK_SRC, /['"]no-company-context['"]/);
});

test('hook short-circuits when host context already has a UUID (no waste round-trip)', () => {
  // Look for the early-return guard: if (hostCompanyId) ... return { companyId: hostCompanyId
  assert.match(HOOK_SRC, /if\s*\(\s*hostCompanyId\s*\)/);
});

test('hook never silently passes empty string to a usePluginData params field (the 02-03b defect class)', () => {
  // The defect class: literal `companyId ?? ''` patterns. The hook may
  // pass {} or {companyPrefix: derivedPrefix}, but never pretend an empty
  // string is a real value.
  assert.doesNotMatch(HOOK_SRC, /companyId\s*\?\?\s*['"]\s*['"]/);
});

test('hook is hook-rules compliant — usePluginData is called unconditionally (no `if (...) usePluginData`)', () => {
  // Negative grep: usePluginData should NOT appear after an if-statement opener
  // on the same logical line. This is conservative; we accept manual review.
  assert.doesNotMatch(HOOK_SRC, /\bif\s*\([^)]*\)\s*\{?\s*[^}]*usePluginData\(/);
});
