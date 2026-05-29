// test/ui/surfaces/bulletin/lineage-footer.test.mjs
//
// Plan 07-05 Task 2 (Phase 7 ITEM 5) — the bulletin LineageFooter render.
//
// The footer reframes the misleading "ONE ARTIFACT, END-TO-END" heading to a
// count-aware label (D-I5-04), renders a one-line gloss per surviving thread (or
// a quiet "gloss pending" note when absent — D-I5-02), and gives each thread TWO
// affordances (open issue + open chat with owner via the reused ROOM-09
// buildChatDeepLink employee-only carrier — D-I5-03). React text nodes only; the
// entityId/ownerAgentId are NEVER rendered as visible text (NO_UUID_LEAK).
//
// Convention: source-grep (no jsdom in devDependencies). Mirrors
// org-blocked-backlog-banner.test.mjs (Plan 07-03).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FOOTER = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/bulletin/lineage-footer.tsx'),
  'utf8',
);
const CSS = readFileSync(path.join(REPO_ROOT, 'src/ui/styles/bulletin.css'), 'utf8');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------
// Imports + reused carriers (mirror the 07-03 banner)
// ---------------------------------------------------------------------------

test('footer imports buildChatDeepLink from the shared deep-link contract (reuse ROOM-09 carrier)', () => {
  assert.match(FOOTER, /import \{ buildChatDeepLink \} from '\.\.\/chat\/deep-link\.mjs'/);
});

test('footer imports useHostLocation + useHostNavigation from the SDK hooks', () => {
  assert.match(
    FOOTER,
    /import \{[\s\S]*?useHostLocation[\s\S]*?useHostNavigation[\s\S]*?\} from '@paperclipai\/plugin-sdk\/ui\/hooks'/,
  );
});

test('footer imports extractCompanyPrefixFromPathname (reuse)', () => {
  assert.match(FOOTER, /extractCompanyPrefixFromPathname/);
});

// ---------------------------------------------------------------------------
// Heading reframe (D-I5-04)
// ---------------------------------------------------------------------------

test('footer reframes the heading away from the false "One artifact, end-to-end" multi-thread claim', () => {
  // The literal one-artifact claim must be gone (it falsely claimed one while
  // showing many). A count-aware / clearer label takes its place.
  assert.ok(
    !/One artifact, end-to-end/.test(FOOTER),
    'the literal "One artifact, end-to-end" heading must be reframed',
  );
  // The new heading references the thread count (count-aware label).
  assert.match(FOOTER, /threads\.length/);
});

// ---------------------------------------------------------------------------
// Gloss render (D-I5-02)
// ---------------------------------------------------------------------------

test('footer renders thread.gloss as a one-line element', () => {
  assert.match(FOOTER, /thread\.gloss/);
  assert.match(FOOTER, /clarity-bulletin-thread-gloss/);
});

test('footer renders a quiet pending note when gloss is null (NOT an error)', () => {
  assert.match(FOOTER, /pending/i);
  assert.match(FOOTER, /clarity-bulletin-thread-gloss--pending/);
});

// ---------------------------------------------------------------------------
// Two affordances per thread (D-I5-03)
// ---------------------------------------------------------------------------

test('footer "open issue" affordance navigates /<prefix>/issues/<identifier>', () => {
  assert.match(FOOTER, /\/issues\//);
  assert.match(FOOTER, /identifier/);
  assert.match(FOOTER, /navigate\(/);
});

test('footer "open chat with owner" uses buildChatDeepLink employee-only with ownerAgentId', () => {
  assert.match(FOOTER, /buildChatDeepLink\(\{[\s\S]*?route:\s*['"`]employee-only['"`]/);
  assert.match(FOOTER, /assigneeAgentId:\s*[\w.]*ownerAgentId/);
  assert.match(FOOTER, /navigate\(deepLink\.to\)/);
});

test('footer gates the chat affordance when ownerAgentId is null', () => {
  // The chat affordance is omitted/disabled when there is no owner agent id.
  assert.match(FOOTER, /ownerAgentId/);
});

// ---------------------------------------------------------------------------
// Security — React text only, NO_UUID_LEAK
// ---------------------------------------------------------------------------

test('footer contains NO dangerouslySetInnerHTML', () => {
  assert.equal(
    (FOOTER.match(/dangerouslySetInnerHTML/g) || []).length,
    0,
    'footer must render React text nodes only (T-07-05-XSS)',
  );
});

test('footer NEVER renders entityId or ownerAgentId as a visible JSX text node', () => {
  assert.equal(
    (FOOTER.match(/>\s*\{[^}]*entityId[^}]*\}\s*</g) || []).length,
    0,
    'entityId must not appear as a visible JSX text node',
  );
  assert.equal(
    (FOOTER.match(/>\s*\{[^}]*ownerAgentId[^}]*\}\s*</g) || []).length,
    0,
    'ownerAgentId must not appear as a visible JSX text node',
  );
});

test('footer source contains no hardcoded raw UUID (NO_UUID_LEAK)', () => {
  assert.ok(!UUID_RE.test(FOOTER), 'no raw UUID literal should appear in the footer source');
});

// ---------------------------------------------------------------------------
// CSS — scoped under [data-clarity-surface="bulletin"]
// ---------------------------------------------------------------------------

test('CSS: .clarity-bulletin-thread-gloss is scoped under [data-clarity-surface="bulletin"]', () => {
  assert.match(CSS, /\[data-clarity-surface="bulletin"\]\s*\.clarity-bulletin-thread-gloss/);
});

test('CSS: .clarity-bulletin-thread-actions + .clarity-bulletin-thread-action are scoped', () => {
  assert.match(CSS, /\[data-clarity-surface="bulletin"\]\s*\.clarity-bulletin-thread-actions/);
  assert.match(CSS, /\[data-clarity-surface="bulletin"\]\s*\.clarity-bulletin-thread-action/);
});
