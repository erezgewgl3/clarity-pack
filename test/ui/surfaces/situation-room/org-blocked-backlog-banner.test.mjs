// test/ui/surfaces/situation-room/org-blocked-backlog-banner.test.mjs
//
// Plan 07-03 Task 2 (Phase 7 ITEM 4) — the org-blocked-backlog banner + panel.
//
// The Situation Room shows a top-of-room banner ("N blocked · M need you")
// that expands to a panel of backlog rows; each row renders title + the single
// human action + owner NAME (NEVER a UUID) + age, with TWO affordances per row
// (open issue + open chat with owner via the reused ROOM-09 buildChatDeepLink
// employee-only carrier). The agent grid below is unchanged.
//
// Convention: source-grep (no jsdom in devDependencies). Mirrors
// agent-card-open-chat.test.mjs (Plan 06.1-11).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const BANNER = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/org-blocked-backlog-banner.tsx'),
  'utf8',
);
const INDEX = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/index.tsx'),
  'utf8',
);
const CSS = readFileSync(
  path.join(REPO_ROOT, 'src/ui/primitives/theme.css'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Imports + reused carriers
// ---------------------------------------------------------------------------

test('banner imports buildChatDeepLink from the shared deep-link contract (reuse ROOM-09 carrier)', () => {
  assert.match(BANNER, /import \{ buildChatDeepLink \} from '\.\.\/chat\/deep-link\.mjs'/);
});

test('banner imports extractCompanyPrefixFromPathname + formatAge (reuse)', () => {
  assert.match(
    BANNER,
    /extractCompanyPrefixFromPathname/,
  );
  assert.match(BANNER, /formatAge/);
});

test('banner imports useHostLocation + useHostNavigation from the SDK hooks', () => {
  assert.match(
    BANNER,
    /import \{[\s\S]*?useHostLocation[\s\S]*?useHostNavigation[\s\S]*?\} from '@paperclipai\/plugin-sdk\/ui\/hooks'/,
  );
});

// ---------------------------------------------------------------------------
// Empty / collapsed / expanded behavior
// ---------------------------------------------------------------------------

test('banner renders nothing when backlog is null/empty (blocked_count === 0)', () => {
  // A guard returning null on empty/zero backlog.
  assert.match(BANNER, /blocked_count/);
  assert.match(BANNER, /return null/);
});

test('banner shows the "N blocked · M need you" headline (the two numbers)', () => {
  assert.match(BANNER, /blocked_count/);
  assert.match(BANNER, /need_you_count/);
  // The headline copy carries both numbers.
  assert.match(BANNER, /blocked/);
  assert.match(BANNER, /need you/);
});

test('banner toggles a panel and exposes aria-expanded', () => {
  assert.match(BANNER, /aria-expanded/);
});

test('banner auto-expands when needYouCount > 0 (Claude discretion D-I4)', () => {
  // The component destructures need_you_count → needYouCount, then seeds the
  // expanded state from `needYouCount > 0`.
  assert.match(BANNER, /needYouCount\s*>\s*0/);
});

// ---------------------------------------------------------------------------
// Row content — title + human action + owner NAME + age (NO_UUID_LEAK)
// ---------------------------------------------------------------------------

test('row renders owner via ownerName ?? "Unassigned" (NEVER the raw UUID)', () => {
  assert.match(BANNER, /ownerName\s*\?\?\s*['"`]Unassigned['"`]/);
});

test('row NEVER renders ownerAgentId as visible text (only as the chat-link target)', () => {
  // ownerAgentId may be referenced for the deep-link build, but never as a
  // JSX text child. Assert it is not rendered as `{...ownerAgentId}` text in a
  // visible label position: it must only appear inside buildChatDeepLink args.
  // Heuristic: there is no `>{...ownerAgentId...}<`-style text node.
  assert.equal(
    (BANNER.match(/>\s*\{[^}]*ownerAgentId[^}]*\}\s*</g) || []).length,
    0,
    'ownerAgentId must not appear as a visible JSX text node',
  );
});

test('row renders the human action (terminal label) + title + age via formatAge', () => {
  assert.match(BANNER, /humanAction/);
  assert.match(BANNER, /\.title/);
  // age chip gated on age_ms != null then formatAge(row.age_ms)
  assert.match(BANNER, /age_ms\s*!=\s*null/);
  assert.match(BANNER, /formatAge\(/);
});

// ---------------------------------------------------------------------------
// Two affordances per row
// ---------------------------------------------------------------------------

test('row "open issue" affordance navigates /<prefix>/issues/<identifier>', () => {
  assert.match(BANNER, /\/issues\//);
  assert.match(BANNER, /identifier/);
  assert.match(BANNER, /navigate\(/);
});

test('row "open chat with owner" uses buildChatDeepLink employee-only with ownerAgentId', () => {
  assert.match(BANNER, /buildChatDeepLink\(\{[\s\S]*?route:\s*['"`]employee-only['"`]/);
  assert.match(BANNER, /assigneeAgentId:\s*[\w.]*ownerAgentId/);
  assert.match(BANNER, /navigate\(deepLink\.to\)/);
});

test('chat affordance is gated when ownerAgentId is null/__unowned__', () => {
  assert.match(BANNER, /__unowned__/);
});

// ---------------------------------------------------------------------------
// Overflow footer
// ---------------------------------------------------------------------------

test('panel renders the overflow footer (top X of N) when backlog.overflow', () => {
  assert.match(BANNER, /overflow/);
  assert.match(BANNER, /total/);
});

// ---------------------------------------------------------------------------
// Security — React text only, no UUID leak
// ---------------------------------------------------------------------------

test('banner contains NO dangerouslySetInnerHTML', () => {
  assert.equal(
    (BANNER.match(/dangerouslySetInnerHTML/g) || []).length,
    0,
    'banner must render React text nodes only (T-07-03-XSS)',
  );
});

// ---------------------------------------------------------------------------
// Mount point — above the agent grid, fed from snapshotData.org_blocked_backlog
// ---------------------------------------------------------------------------

test('index.tsx mounts <OrgBlockedBacklogBanner above the room header / agent grid', () => {
  assert.match(INDEX, /import \{[\s\S]*?OrgBlockedBacklogBanner[\s\S]*?\} from '\.\/org-blocked-backlog-banner\.tsx'/);
  assert.match(INDEX, /<OrgBlockedBacklogBanner/);
  // The banner mounts before the room header (TOP of the fragment).
  const bannerIdx = INDEX.indexOf('<OrgBlockedBacklogBanner');
  const headerIdx = INDEX.indexOf('clarity-room-header');
  assert.ok(bannerIdx > 0 && headerIdx > 0 && bannerIdx < headerIdx,
    'OrgBlockedBacklogBanner must mount above the room header');
});

test('index.tsx SituationData carries org_blocked_backlog and feeds it to the banner', () => {
  assert.match(INDEX, /org_blocked_backlog/);
});

// ---------------------------------------------------------------------------
// CSS — scoped under [data-clarity-surface='situation-room']
// ---------------------------------------------------------------------------

test('CSS: .clarity-blocked-banner is scoped under [data-clarity-surface=situation-room]', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-blocked-banner/);
});

test('CSS: .clarity-blocked-panel + .clarity-blocked-row are scoped', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-blocked-panel/);
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-blocked-row/);
});
