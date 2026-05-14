// test/ui/reader-view-null-context.test.mjs
//
// Plan 02-03c Task 2 — ReaderView retrofit contract. Source-grep based
// (consistent with reader-view.test.mjs convention) because the project
// uses node --test without jsdom. The acceptance bar is "ReaderView never
// passes empty string companyId to a worker handler" — verifiable by
// pattern absence + presence of the resolver hook.
//
// Runtime DOM behavior (loading placeholder rendering, populated re-render)
// is verified end-to-end by the Plan 02-03c Task 4 manual rehearsal drill.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER_SRC = readFileSync(
  path.resolve(HERE, '..', '..', 'src', 'ui', 'surfaces', 'reader', 'index.tsx'),
  'utf8',
);

test('ReaderView imports useResolvedCompanyId from the primitives folder (Task 2 retrofit)', () => {
  assert.match(
    READER_SRC,
    /import\s*\{\s*useResolvedCompanyId\s*\}\s*from\s*['"][^'"]*use-resolved-company-id[^'"]*['"]/,
    'ReaderView must import useResolvedCompanyId from the primitives folder',
  );
});

test('ReaderView calls useResolvedCompanyId() (the resolver hook is wired in)', () => {
  assert.match(READER_SRC, /useResolvedCompanyId\(\)/);
});

test('ReaderView NEVER passes empty-string companyId to usePluginData (the 02-03b drill defect)', () => {
  // Negative grep — the literal `companyId: companyId ?? ''` (or any
  // empty-string fallback) must NOT appear. The retrofit must use the
  // resolved companyId or render a placeholder.
  assert.doesNotMatch(
    READER_SRC,
    /companyId\s*:\s*companyId\s*\?\?\s*['"]\s*['"]/,
    'must not pass empty string when companyId is null — render a placeholder instead',
  );
  assert.doesNotMatch(
    READER_SRC,
    /companyId\s*\?\?\s*['"]\s*['"]/,
    'no `companyId ?? ""` anywhere in the file',
  );
});

test('ReaderView reads userId via useHostContext (userId is reliable per 02-03c-HOST-CONTEXT.md universal rule)', () => {
  // The hook chain: useResolvedCompanyId for companyId, useHostContext for userId
  // (the universal pipeline guarantees userId is non-null when authenticated).
  assert.match(READER_SRC, /useHostContext\(\)/);
});

test('ReaderView renders an explicit "Resolving company context…" placeholder during the resolver loading window', () => {
  // The placeholder is the user-visible signal that we're handling the
  // null-context window correctly (vs the 02-03b case where the panel
  // rendered the literal terminal text from the worker's fail-loud guard).
  assert.match(READER_SRC, /Resolving company context/);
});

test('ReaderView renders an error placeholder when the resolver returns no-company-context', () => {
  // The "no-company-context" error means the URL doesn't have a prefix
  // segment — UI must say something sensible, not silently render empty.
  assert.match(
    READER_SRC,
    /no-company-context|company\s+context\s+unavailable|Unable to resolve|cannot identify/i,
    'ReaderView must render an explicit error message when the resolver fails',
  );
});

test('ReaderView still calls usePluginData("issue.reader", { issueId, companyId }) once it has a resolved companyId', () => {
  // After the retrofit, the issue.reader call still happens — we just gate
  // it behind the resolved companyId.
  assert.match(READER_SRC, /usePluginData[\s\S]*?['"]issue\.reader['"]/);
  assert.match(
    READER_SRC,
    /issue\.reader[\s\S]{0,300}companyId/,
    'issue.reader call still passes companyId once resolved',
  );
});
