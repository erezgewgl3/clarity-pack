// test/ui/topic-strip-d10.test.mjs
//
// Plan 04.2-06 D10 — source-grep contract test. The topic-strip's
// `About <COU-NNNN> ↗` chip must use the SERVER-RESOLVED BEAAA-NNN identifier
// (originIssueIdentifier) for both its visible label AND its click-through
// URL. Pre-D10 the chip rendered `activeTopic.originIssueId` (a raw UUID)
// which (a) leaked the UUID into visible text and (b) navigated to
// `/<prefix>/issues/<UUID>` which 404s per runbook
// paperclip-issue-url-pattern. The fix consumes `originIssueIdentifier`
// from chat.topics' return shape and hides the chip when null.
//
// Same source-grep idiom as chat-url-params.test.mjs (Node's test runner
// does not load .tsx).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(
  HERE,
  '..',
  '..',
  'src',
  'ui',
  'surfaces',
  'chat',
  'topic-strip.tsx',
);

function code() {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('D10 — ChatTopic type exposes optional originIssueIdentifier', () => {
  const src = code();
  assert.match(
    src,
    /originIssueIdentifier\?:\s*string\s*\|\s*null/,
    'expected ChatTopic to carry originIssueIdentifier?: string | null',
  );
});

test('D10 — aboutIssueId derives from originIssueIdentifier, NOT from originIssueId', () => {
  const src = code();
  assert.match(
    src,
    /aboutIssueId\s*=[\s\S]{0,160}activeTopic\.originIssueIdentifier[\s\S]{0,160}activeTopic\.originIssueIdentifier/,
    'aboutIssueId must guard on AND return activeTopic.originIssueIdentifier (the server-resolved BEAAA-NNN string)',
  );
  // The defect form is explicitly forbidden.
  assert.doesNotMatch(
    src,
    /aboutIssueId\s*=[\s\S]{0,80}\?\s*activeTopic\.originIssueId\b\s*$/m,
    'aboutIssueId must NOT return the raw UUID (activeTopic.originIssueId) — D10 drill defect',
  );
});
