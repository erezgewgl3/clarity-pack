// test/ui/surfaces/situation-room/needs-you-banner.test.mjs
//
// Plan 09-02 Task 3 — REWRITE for the un-frozen banner (R5 / R4 / WARNING 1).
//
// The Phase 8 banner had a single urgent variant that opened chat with the
// chain owner and a `disabled={!deepLink}` dead button. Plan 09-02 un-freezes
// it: an UNOWNED case opens the oldest-unowned row's owner picker via
// scrollIntoView + a click on .clarity-owner-pick-trigger (NOT a chat deep-link
// — there is no owner to chat with), the ALL-OWNED case keeps the chat deep-
// link, and the neutral variant only fires at count===0. WARNING 1 / R4: the
// [Assign first] button is NEVER rendered disabled when count > 0.
//
// The old org-backlog mount-order asserts are gone (R6 — the standalone
// OrgBlockedBacklogBanner was deleted; org-backlog + critical-path are now ONE
// expander rendered inside the grouped strip).
//
// Convention: source-grep (no jsdom in devDependencies).

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

// ---------------------------------------------------------------------------
// Exports + carriers
// ---------------------------------------------------------------------------

test('exports NeedsYouBanner', () => {
  assert.match(BANNER, /export function NeedsYouBanner/);
});

test('imports buildChatDeepLink (reuse ROOM-09 carrier for the owned case)', () => {
  assert.match(BANNER, /import \{ buildChatDeepLink \} from '\.\.\/chat\/deep-link\.mjs'/);
});

// ---------------------------------------------------------------------------
// Un-frozen banner — urgent variants
// ---------------------------------------------------------------------------

test('urgent variant carries the ⚠ headline + class clarity-needs-you-urgent', () => {
  assert.match(BANNER, /clarity-needs-you-banner/);
  assert.match(BANNER, /clarity-needs-you-urgent/);
  assert.match(BANNER, /⚠/);
});

test('R5 — urgent UNOWNED variant counts unowned blockers + renders [Assign first]', () => {
  assert.match(BANNER_CODE, /unownedBlocked/);
  assert.match(BANNER, /Assign first/);
  // "N stuck · M unowned" copy.
  assert.match(BANNER, /unowned/);
});

test('WARNING 1 / R4 — the [Assign first] button is NEVER disabled', () => {
  // The old dead-button pattern must be gone, and no disabled= on the
  // assign-first action.
  assert.doesNotMatch(BANNER_CODE, /disabled=\{!deepLink\}/);
  assert.doesNotMatch(BANNER_CODE, /clarity-needs-you-assign-first[\s\S]{0,200}disabled=/);
});

test('R5 — Assign first opens the oldest-unowned row picker (scrollIntoView + trigger click), not a chat deep-link', () => {
  assert.match(BANNER, /scrollIntoView/);
  assert.match(BANNER, /clarity-owner-pick-trigger/);
});

test('all-owned urgent variant keeps the chat deep-link (Phase 8 behavior)', () => {
  assert.match(BANNER_CODE, /ownedBlocked/);
  assert.match(BANNER_CODE, /route: 'employee-only'/);
});

// ---------------------------------------------------------------------------
// Neutral state with derived counts
// ---------------------------------------------------------------------------

test('neutral variant reads ✓ 0 need you — N working · M idle (count===0 only)', () => {
  assert.match(BANNER, /clarity-needs-you-neutral/);
  assert.match(BANNER, /✓ 0 need you/);
  assert.match(BANNER, /working/);
  assert.match(BANNER, /idle/);
  assert.match(BANNER_CODE, /count === 0/);
});

test('neutral counts derived from the worker group field (R2 — verbatim)', () => {
  assert.match(BANNER, /group === 'working'/);
  assert.match(BANNER, /group === 'idle'/);
});

// ---------------------------------------------------------------------------
// B1 owner lookup + AGENT-uuid threading (owned case)
// ---------------------------------------------------------------------------

test('B1 — resolves owner row via employees.find on topAction.agentId', () => {
  // The banner reads needsYou.topAction?.agentId (optional chaining).
  assert.match(BANNER, /topAction\??\.agentId/);
});

test('B1 — assigneeAgentId sourced from ownerRow.blockerChain.ownerAgentId (AGENT uuid)', () => {
  assert.match(BANNER, /ownerAgentId/);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK + security
// ---------------------------------------------------------------------------

test('NO_UUID_LEAK — agentId never rendered as a visible JSX text node', () => {
  assert.equal(
    (BANNER.match(/>\s*\{[^}]*\.agentId[^}]*\}\s*</g) || []).length,
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
// index.tsx mount — NeedsYouBanner + EmployeeRowStrip, NO standalone org banner
// ---------------------------------------------------------------------------

test('index.tsx imports + mounts NeedsYouBanner and EmployeeRowStrip', () => {
  assert.match(INDEX, /import \{ NeedsYouBanner[\s\S]*?\} from '\.\/needs-you-banner\.tsx'/);
  assert.match(INDEX, /import \{ EmployeeRowStrip[\s\S]*?\} from '\.\/employee-row-strip\.tsx'/);
  assert.match(INDEX, /<NeedsYouBanner/);
  assert.match(INDEX, /<EmployeeRowStrip/);
});

test('index.tsx mount order NeedsYouBanner < EmployeeRowStrip (R6 — no standalone org banner)', () => {
  const needs = INDEX.indexOf('<NeedsYouBanner');
  const strip = INDEX.indexOf('<EmployeeRowStrip');
  assert.ok(needs > 0 && strip > 0, 'both mounted');
  assert.ok(needs < strip, 'NeedsYouBanner before EmployeeRowStrip');
});

test('R1/R6 — index.tsx no longer mounts OrgBlockedBacklogBanner / CriticalPathStrip / AwaitingYouPill / AgentCard', () => {
  const code = stripComments(INDEX);
  assert.doesNotMatch(code, /<OrgBlockedBacklogBanner/);
  assert.doesNotMatch(code, /<CriticalPathStrip/);
  assert.doesNotMatch(code, /<AwaitingYouPill/);
  assert.doesNotMatch(code, /<AgentCard/);
});

test('index.tsx threads onAssignSuccess -> forceRefetch into the grouped strip', () => {
  assert.match(INDEX, /onAssignSuccess=\{forceRefetch\}/);
  assert.match(INDEX, /forceRefetch/);
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
