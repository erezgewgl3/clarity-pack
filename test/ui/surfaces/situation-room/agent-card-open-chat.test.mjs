// test/ui/surfaces/situation-room/agent-card-open-chat.test.mjs
//
// Plan 06.1-11 — engagement entry point on the agent card.
//
// The agent card is the dashboard view; chat is the engagement surface.
// Clicking the "Open chat with [Agent]" button (1) writes the side-table
// ownership row as a fire-and-forget side effect and (2) navigates to
// /<companyPrefix>/chat with a new-topic-needed deep-link payload that
// pre-selects this agent. The two actions decouple "claiming ownership"
// (data layer) from "engaging with this agent" (UX) -- the operator sees
// only the engagement verb.
//
// Convention: source-grep (no jsdom in devDependencies). Mirrors the
// shape of critical-path-affordances.test.mjs (Plan 06.1-03).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SOURCE = readFileSync(
  path.join(REPO_ROOT, 'src/ui/surfaces/situation-room/agent-card.tsx'),
  'utf8',
);
const CSS = readFileSync(
  path.join(REPO_ROOT, 'src/ui/primitives/theme.css'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Imports + dispatch wiring
// ---------------------------------------------------------------------------

test('Plan 06.1-11: agent-card imports usePluginAction + useHostLocation + useHostNavigation', () => {
  assert.match(
    SOURCE,
    /import \{[\s\S]*?usePluginAction[\s\S]*?useHostLocation[\s\S]*?useHostNavigation[\s\S]*?\} from '@paperclipai\/plugin-sdk\/ui\/hooks'/,
  );
});

test('Plan 06.1-11: imports buildChatDeepLink from the shared deep-link contract', () => {
  assert.match(SOURCE, /import \{ buildChatDeepLink \} from '\.\.\/chat\/deep-link\.mjs'/);
});

test('Plan 06.1-11: imports extractCompanyPrefixFromPathname (URL prefix resolution)', () => {
  assert.match(
    SOURCE,
    /import \{ extractCompanyPrefixFromPathname \} from '\.\.\/\.\.\/primitives\/use-resolved-company-id\.ts'/,
  );
});

test('Plan 06.1-11: still uses agent.takeOwnership for the side-table write', () => {
  assert.match(SOURCE, /usePluginAction\(\s*'agent\.takeOwnership'\s*\)/);
});

// ---------------------------------------------------------------------------
// Button shape
// ---------------------------------------------------------------------------

test('Plan 06.1-11: renders the Open-chat button ALWAYS (no isUnclaimed conditional)', () => {
  // The old `{isUnclaimed ? (<button ...>) : null}` pattern is gone.
  assert.equal(
    (SOURCE.match(/isUnclaimed \?\s*\(/g) || []).length,
    0,
    'agent-card.tsx must not gate the button on isUnclaimed -- engagement is always available',
  );
  // The new button has no conditional wrapper.
  assert.match(SOURCE, /<button[\s\S]*?className="clarity-open-chat-btn"/);
});

test('Plan 06.1-11: button label uses the locked literal "Open chat with [role]"', () => {
  assert.match(SOURCE, /Open chat with \$\{roleLabel\}/);
});

test('Plan 06.1-11: in-flight button label is "Opening…" (em-ellipsis, not three dots)', () => {
  assert.ok(
    SOURCE.includes("'Opening…'"),
    'must use the unicode ellipsis "…" not "..." (matches Plan 06.1-03 button copy convention)',
  );
});

test('Plan 06.1-11: button uses dedicated CSS class .clarity-open-chat-btn', () => {
  assert.match(SOURCE, /className="clarity-open-chat-btn"/);
});

test('Plan 06.1-11: button has aria-busy bound to the opening state', () => {
  assert.match(SOURCE, /aria-busy=\{opening \|\| undefined\}/);
});

// ---------------------------------------------------------------------------
// Click semantics
// ---------------------------------------------------------------------------

test('Plan 06.1-11: click writes the side-table row as fire-and-forget (errors swallowed)', () => {
  // The takeOwnership call is NOT awaited and IS chained with .catch() that
  // swallows the error -- chat navigation is the primary action.
  assert.match(SOURCE, /takeOwnership\(\{[\s\S]*?\}\)\.catch\(\(\) => \{[\s\S]*?\}\)/);
});

test('Plan 06.1-11: click dispatches with companyId + agentId + ownerUserId + userId', () => {
  assert.match(SOURCE, /companyId:\s*companyId\s*\?\?\s*['"`]['"`]/);
  assert.match(SOURCE, /agentId:\s*agentIdForOwnership/);
  assert.match(SOURCE, /ownerUserId:\s*viewerUserId/);
  assert.match(SOURCE, /userId:\s*viewerUserId/);
});

test('Plan 06.1-11: agentId for dispatch falls back to employee.agentId ?? employee.userId', () => {
  assert.match(SOURCE, /employee\.agentId\s*\?\?\s*employee\.userId/);
});

test('Plan 06.1-11: click guards against the UNOWNED_SENTINEL value before dispatching', () => {
  assert.match(SOURCE, /UNOWNED_SENTINEL\s*=\s*['"`]__unowned__['"`]/);
  assert.match(SOURCE, /agentIdForOwnership\s*!==\s*UNOWNED_SENTINEL/);
});

test('Plan 06.1-12: click navigates via buildChatDeepLink({route: employee-only, ...})', () => {
  // Plan 06.1-11 originally used `new-topic-needed`; Plan 06.1-12 swapped
  // to `employee-only` so the chat surface lands with the agent selected
  // but does NOT force-open the New Topic dialog (operator critique).
  assert.match(SOURCE, /buildChatDeepLink\(\{[\s\S]*?route:\s*['"`]employee-only['"`]/);
  assert.match(SOURCE, /assigneeAgentId:\s*agentIdForOwnership/);
  // Confirm the OLD `new-topic-needed` literal isn't passed to
  // buildChatDeepLink (it may appear in comments referencing the
  // historical pivot, but not as an active route argument).
  assert.equal(
    (SOURCE.match(/route:\s*['"`]new-topic-needed['"`]/g) || []).length,
    0,
    'agent-card.tsx must not pass route:new-topic-needed (Plan 06.1-12 swap to employee-only)',
  );
});

test('Plan 06.1-11: navigate() is called with deepLink.to (URL_HASH carrier)', () => {
  assert.match(SOURCE, /navigate\(deepLink\.to\)/);
});

test('Plan 06.1-11: deep-link build failure surfaces a contextual toast', () => {
  assert.match(SOURCE, /Could not open chat with \$\{roleLabel\}/);
});

// ---------------------------------------------------------------------------
// Body content
// ---------------------------------------------------------------------------

test('Plan 06.1-10: idle (pathIds.length === 1) renders quiet "No blockers" body', () => {
  assert.match(SOURCE, /pathIds\?\.length/);
  assert.ok(
    SOURCE.includes('No blockers'),
    'agent-card.tsx must render the literal string "No blockers" for idle state',
  );
  assert.match(SOURCE, /clarity-agent-terminal-idle/);
});

test('Plan 06.1-08: blocked-unclaimed renders "Nobody is handling [role]\'s blockers"', () => {
  assert.match(SOURCE, /Nobody is handling \$\{roleLabel\}'s blockers/);
});

// ---------------------------------------------------------------------------
// CSS — alignment fix + button styling
// ---------------------------------------------------------------------------

test('Plan 06.1-11 CSS: .clarity-open-chat-btn uses margin-top:auto for bottom anchor', () => {
  // Find the .clarity-open-chat-btn rule and assert it contains margin-top: auto
  const rule = CSS.match(
    /\[data-clarity-surface='situation-room'\]\s*\.clarity-open-chat-btn\s*\{[^}]*\}/,
  );
  assert.ok(rule, 'must define a .clarity-open-chat-btn rule under [data-clarity-surface=situation-room]');
  assert.match(rule[0], /margin-top:\s*auto/);
});

test('Plan 06.1-11 CSS: agent card is flex-column (required for margin-top:auto to anchor button)', () => {
  const rule = CSS.match(
    /\[data-clarity-surface='situation-room'\]\s*\.clarity-agent-card\s*\{[^}]*\}/,
  );
  assert.ok(rule, 'must define .clarity-agent-card under [data-clarity-surface=situation-room]');
  assert.match(rule[0], /display:\s*flex/);
  assert.match(rule[0], /flex-direction:\s*column/);
});

test('Plan 06.1-11 CSS: .clarity-open-chat-btn rule is scoped under [data-clarity-surface=situation-room]', () => {
  assert.match(CSS, /\[data-clarity-surface='situation-room'\]\s*\.clarity-open-chat-btn/);
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

test('Plan 06.1-11: NO ctx.issues.update introduced (CTT-07)', () => {
  assert.equal(
    (SOURCE.match(/ctx\.issues\.update/g) || []).length,
    0,
    'CTT-07: agent-card.tsx must not introduce any ctx.issues.update calls',
  );
});

test('Plan 06.1-11: no "Take responsibility" literal remains (the verb was wrong per operator)', () => {
  assert.equal(
    (SOURCE.match(/Take responsibility/g) || []).length,
    0,
    'the "Take responsibility" verb was retired -- engagement is the primary action; ownership is implicit',
  );
});
