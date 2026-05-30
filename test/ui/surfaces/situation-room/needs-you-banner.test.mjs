// test/ui/surfaces/situation-room/needs-you-banner.test.mjs
//
// Plan 08-02 Task 2 (Phase 8 people-first cockpit) — ROOM-18.
//
// NeedsYouBanner is the ALWAYS-VISIBLE top strip. Urgent state (count>0) reads
// "⚠ N things need you → <action>" + an action button that opens chat with the
// chain OWNER (B1 — the owner's AGENT uuid, resolved by looking up the row that
// matches topAction.agentId then reading row.blockerChain.ownerAgentId — NEVER
// topAction.agentId itself, NEVER a USER uuid). Neutral state (count===0) reads
// "✓ 0 need you — N moving · M idle · K stuck" with counts from the employees
// prop. No expand/collapse state (always-visible).
//
// Convention: source-grep (no jsdom in devDependencies). Mirrors
// org-blocked-backlog-banner.test.mjs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

/** Strip // line comments and block comments so forbidden-substring asserts
 *  evaluate the CODE, not the prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const BANNER = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/needs-you-banner.tsx'),
  'utf8',
);
const BANNER_CODE = stripComments(BANNER);
const INDEX = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/index.tsx'),
  'utf8',
);
const ORG = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Exports + carriers
// ---------------------------------------------------------------------------

test('exports NeedsYouBanner', () => {
  assert.match(BANNER, /export function NeedsYouBanner/);
});

test('imports buildChatDeepLink (reuse ROOM-09 carrier)', () => {
  assert.match(BANNER, /import \{ buildChatDeepLink \} from '\.\.\/chat\/deep-link\.mjs'/);
});

// ---------------------------------------------------------------------------
// Test 1 + 2 — urgent state + pluralization
// ---------------------------------------------------------------------------

test('urgent variant carries the ⚠ headline + class clarity-needs-you-urgent', () => {
  assert.match(BANNER, /clarity-needs-you-banner/);
  assert.match(BANNER, /clarity-needs-you-urgent/);
  assert.match(BANNER, /⚠/);
});

test('pluralizes thing(s) / need(s) on count', () => {
  // count===1 → 'thing needs', else 'things need'
  assert.match(BANNER, /count === 1/);
  assert.match(BANNER, /things?/);
});

// ---------------------------------------------------------------------------
// Test 3 — neutral state with derived counts
// ---------------------------------------------------------------------------

test('neutral variant reads ✓ 0 need you — N moving · M idle · K stuck', () => {
  assert.match(BANNER, /clarity-needs-you-neutral/);
  assert.match(BANNER, /✓ 0 need you/);
  assert.match(BANNER, /moving/);
  assert.match(BANNER, /idle/);
  assert.match(BANNER, /stuck/);
});

test('neutral counts derived from employees prop by state', () => {
  assert.match(BANNER, /e\.state === 'running'/);
  assert.match(BANNER, /e\.state === 'blocked'/);
  assert.match(BANNER, /e\.state === 'idle'/);
});

// ---------------------------------------------------------------------------
// Test 4 + 4b — B1 owner lookup + AGENT-uuid threading
// ---------------------------------------------------------------------------

test('B1 — resolves owner row via employees.find on topAction.agentId', () => {
  assert.match(BANNER, /employees\.find\(/);
  assert.match(BANNER, /topAction\.agentId/);
});

test('B1 — assigneeAgentId sourced from ownerRow.blockerChain.ownerAgentId (AGENT uuid)', () => {
  assert.match(BANNER, /ownerRow/);
  assert.match(BANNER, /blockerChain\?\.ownerAgentId/);
});

test('builds exactly one employee-only deep link', () => {
  assert.equal(
    (BANNER_CODE.match(/route: 'employee-only'/g) || []).length,
    1,
  );
});

test('action button disabled when the deep link is null (stale/unresolvable)', () => {
  assert.match(BANNER, /disabled=\{!deepLink\}/);
});

// ---------------------------------------------------------------------------
// Test 5 — always-visible, no toggle state
// ---------------------------------------------------------------------------

test('NeedsYouBanner has NO useState (always-visible, no expand/collapse)', () => {
  assert.equal(
    (BANNER_CODE.match(/useState/g) || []).length,
    0,
    'banner must be always-visible — no toggle state',
  );
});

// ---------------------------------------------------------------------------
// Test 6 — NO_UUID_LEAK
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — topAction.agentId never rendered as a visible JSX text node', () => {
  assert.equal(
    (BANNER.match(/>\s*\{[^}]*topAction\.agentId[^}]*\}\s*</g) || []).length,
    0,
  );
});

test('banner contains NO dangerouslySetInnerHTML', () => {
  assert.equal(
    (BANNER_CODE.match(/dangerouslySetInnerHTML/g) || []).length,
    0,
  );
});

// ---------------------------------------------------------------------------
// Test 7 — index.tsx mount order: NeedsYou → Strip → OrgBacklog
// ---------------------------------------------------------------------------

test('index.tsx imports + mounts NeedsYouBanner and EmployeeRowStrip', () => {
  assert.match(INDEX, /import \{ NeedsYouBanner \} from '\.\/needs-you-banner\.tsx'/);
  assert.match(INDEX, /import \{ EmployeeRowStrip \} from '\.\/employee-row-strip\.tsx'/);
  assert.match(INDEX, /<NeedsYouBanner/);
  assert.match(INDEX, /<EmployeeRowStrip/);
});

test('index.tsx mount order NeedsYouBanner < EmployeeRowStrip < OrgBlockedBacklogBanner', () => {
  const needs = INDEX.indexOf('<NeedsYouBanner');
  const strip = INDEX.indexOf('<EmployeeRowStrip');
  const org = INDEX.indexOf('<OrgBlockedBacklogBanner');
  assert.ok(needs > 0 && strip > 0 && org > 0, 'all three mounted');
  assert.ok(needs < strip, 'NeedsYouBanner before EmployeeRowStrip');
  assert.ok(strip < org, 'EmployeeRowStrip before OrgBlockedBacklogBanner');
});

test('index.tsx passes defaultExpanded={false} to OrgBlockedBacklogBanner', () => {
  assert.match(INDEX, /defaultExpanded=\{false\}/);
});

test('index.tsx SituationData widened with employees + needsYou', () => {
  assert.match(INDEX, /employees\?: SituationEmployeeRow\[\]/);
  assert.match(INDEX, /needsYou\?: NeedsYou/);
});

// ---------------------------------------------------------------------------
// Test 8 — OrgBlockedBacklogBanner respects defaultExpanded=false
// ---------------------------------------------------------------------------

test('OrgBlockedBacklogBanner accepts a defaultExpanded prop', () => {
  assert.match(ORG, /defaultExpanded/);
});

test('OrgBlockedBacklogBanner seeds expanded from defaultExpanded (collapse override)', () => {
  // defaultExpanded === false must win over need_you_count > 0.
  assert.match(ORG, /defaultExpanded\s*===\s*false/);
});

// ---------------------------------------------------------------------------
// CSS — banner chrome scoped
// ---------------------------------------------------------------------------

test('CSS: .clarity-needs-you-banner is scoped under [data-clarity-surface=situation-room]', () => {
  const CSS = readFileSync(
    path.join(REPO_ROOT, 'src/ui/primitives/theme.css'),
    'utf8',
  );
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-needs-you-banner/);
});
