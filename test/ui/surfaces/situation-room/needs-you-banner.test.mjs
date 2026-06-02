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
// WR-01 (12-REVIEW) — [Assign first] target resolution must not silently
// fall through to the wrong row when topAction's representative comes from the
// targeting partition (an AWAITING_HUMAN 'reply' row, not in unownedBlocked).
// ---------------------------------------------------------------------------

test('WR-01 — [Assign first] uses topAction.agentId ONLY when it resolves to an unowned row', () => {
  // The lookup must be scoped to unownedBlocked.find(...) so a topAction whose
  // representative is an owned/targeting row does NOT resolve as the target.
  assert.match(
    BANNER_CODE,
    /unownedBlocked\.find\(\s*\(e\)\s*=>\s*e\.agentId\s*===\s*needsYou\.topAction\?\.agentId\s*\)/,
    'topAction match must be scoped to unownedBlocked',
  );
});

test('WR-01 — [Assign first] falls back to the highest-leverage unowned row (unownedBlocked[0]), not unownedBlocked across the whole set', () => {
  // unownedBlocked is filtered from the worker-leverage-ordered `employees`, so
  // unownedBlocked[0] is the highest-leverage unowned row — the honest fallback
  // when topAction's representative is not an unowned row.
  assert.match(
    BANNER_CODE,
    /\?\?\s*unownedBlocked\[0\]/,
    'the assign-first target must fall back to unownedBlocked[0] via a nullish coalesce',
  );
});

// ---------------------------------------------------------------------------
// WR-03 (12-REVIEW) — banner headline number is the per-leaf deduped `count`
// (the same number every downstream decision uses), not a per-agent row tally.
// ---------------------------------------------------------------------------

test('WR-03 — banner headline renders the deduped count, not a per-agent stuck tally', () => {
  // The urgent copy must read the deduped action count (derived from needsYou.count)
  // rather than a `unownedBlocked.length + ownedBlocked.length` per-agent sum.
  assert.match(BANNER_CODE, /const\s+actions\s*=\s*count\s*;/, 'banner derives `actions` from the deduped count');
  assert.match(BANNER, /action\$\{actions === 1 \? '' : 's'\} needed/, 'urgent copy renders the deduped action count');
  // The old per-agent `stuck` headline tally must be gone from the rendered copy.
  assert.doesNotMatch(BANNER, /\$\{stuck\} stuck/, 'no per-agent `${stuck} stuck` headline copy');
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
// Plan 09-04 — topAction type carries leafIssueUuid; no human key dispatched
// ---------------------------------------------------------------------------

test('09-04 — NeedsYou.topAction type mirror carries leafIssueUuid (in sync with the worker shape)', () => {
  assert.match(
    BANNER,
    /leafIssueUuid:\s*string\s*\|\s*null/,
    'topAction type carries leafIssueUuid: string | null',
  );
});

test('09-04 — the banner [Assign first] stays DOM-driven; it never dispatches a human key as a mutation id', () => {
  // The banner does NOT itself dispatch situation.assignOwner — it opens the
  // target row's picker via scrollIntoView + a .clarity-owner-pick-trigger click.
  assert.match(BANNER_CODE, /scrollIntoView/);
  assert.match(BANNER_CODE, /clarity-owner-pick-trigger/);
  // No assignOwner dispatch in the banner (the row's popover owns the dispatch).
  assert.doesNotMatch(BANNER_CODE, /usePluginAction\(\s*'situation\.assignOwner'\s*\)/);
  // The banner never passes leafIssueId as an action/mutation arg.
  assert.doesNotMatch(BANNER_CODE, /assignOwner\(/);
});

// ---------------------------------------------------------------------------
// index.tsx mount — Plan 15-03 (D-07) SUPERSEDES the Phase-9 mounts.
// ---------------------------------------------------------------------------
// The Phase-9 index body mounted <NeedsYouBanner> + <EmployeeRowStrip>. Plan
// 15-03 (COCK-01/COCK-02 / D-07) folds the banner role INTO the <PulseHeader>
// and replaces the agent-state group strip with the verdict-tier <TierStrip>.
// needs-you-banner.tsx itself stays on disk (superseded, not deleted — the
// component tests above still exercise it); the index no longer MOUNTS it.

test('index.tsx (15-03 D-07) mounts PulseHeader + TierStrip, NOT NeedsYouBanner / EmployeeRowStrip', () => {
  const code = stripComments(INDEX);
  assert.match(code, /<PulseHeader/, 'index mounts the Pulse header (banner folded in)');
  assert.match(code, /<TierStrip/, 'index mounts the verdict-tier strip');
  assert.doesNotMatch(code, /<NeedsYouBanner/, 'index no longer mounts the standalone banner (D-07)');
  assert.doesNotMatch(code, /<EmployeeRowStrip/, 'index no longer mounts the Phase-9 group strip');
});

test('index.tsx mount order PulseHeader < TierStrip (the Pulse is the always-on top status)', () => {
  const code = stripComments(INDEX);
  const pulse = code.indexOf('<PulseHeader');
  const tier = code.indexOf('<TierStrip');
  assert.ok(pulse > 0 && tier > 0, 'both mounted');
  assert.ok(pulse < tier, 'PulseHeader before TierStrip');
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
