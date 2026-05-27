// test/ui/surfaces/situation-room/agent-card-take-responsibility.test.mjs
//
// Plan 06.1-08 + 06.1-09 + 06.1-10 — source-grep invariants for the new
// AgentCard rendering states (idle vs blocked-unclaimed vs claimed) +
// the Take-Responsibility button.
//
// Why source-grep: no jsdom in devDependencies; matches the convention
// established by critical-path-affordances.test.mjs (Plan 06.1-03).

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

test('Plan 06.1-09: AgentCard imports usePluginAction from the SDK', () => {
  assert.match(SOURCE, /import .*usePluginAction.*'@paperclipai\/plugin-sdk\/ui\/hooks'/);
});

test('Plan 06.1-09: AgentCard imports useResolvedUserId for the viewer id', () => {
  assert.match(SOURCE, /import .*useResolvedUserId.*from .*use-resolved-user-id/);
});

test('Plan 06.1-09: AgentCard imports useToast for click feedback', () => {
  assert.match(SOURCE, /import .*useToast.*from .*toast/);
});

test('Plan 06.1-09: AgentCard wires the agent.takeOwnership action handler', () => {
  assert.match(SOURCE, /usePluginAction\(\s*'agent\.takeOwnership'\s*\)/);
});

test('Plan 06.1-10: AgentCard uses chain.pathIds.length to detect degenerate (idle) chains', () => {
  assert.match(SOURCE, /pathIds\?\.length/);
  assert.match(SOURCE, /hasBlockers/);
});

test('Plan 06.1-10: AgentCard renders the literal "No blockers" body on idle state', () => {
  assert.ok(
    SOURCE.includes('No blockers'),
    'agent-card.tsx must render the literal string "No blockers" for idle state',
  );
});

test('Plan 06.1-10: idle terminal block has data-terminal-kind="IDLE" + clarity-agent-terminal-idle class', () => {
  assert.match(SOURCE, /clarity-agent-terminal-idle/);
  assert.match(SOURCE, /data-terminal-kind=["'`]IDLE["'`]/);
});

test('Plan 06.1-08: blocked-unclaimed body renders "Nobody is handling [role]\'s blockers"', () => {
  assert.match(SOURCE, /Nobody is handling \$\{employee\.role\}'s blockers/);
});

test('Plan 06.1-09: Take-Responsibility button conditional on isUnclaimed', () => {
  // Match the conditional render guard.
  assert.match(SOURCE, /isUnclaimed \?[\s\S]*?Take responsibility/);
});

test('Plan 06.1-09: button uses the locked literal "Take responsibility"', () => {
  assert.ok(
    SOURCE.includes('Take responsibility'),
    'agent-card.tsx must render the literal "Take responsibility" button label',
  );
});

test('Plan 06.1-09: button uses shared .clarity-take-ownership-btn CSS class', () => {
  assert.match(SOURCE, /className=["'`]clarity-take-ownership-btn["'`]/);
});

test('Plan 06.1-09: in-flight label "Taking responsibility…" uses an em-ellipsis (not three dots)', () => {
  assert.ok(
    SOURCE.includes('Taking responsibility…'),
    'must use the unicode ellipsis "…" not "..." (matches Plan 06.1-03 button copy convention)',
  );
});

test('Plan 06.1-09: success toast literal "Responsibility taken"', () => {
  assert.ok(
    SOURCE.includes('Responsibility taken'),
    'success toast must use the locked literal "Responsibility taken"',
  );
});

test('Plan 06.1-09: failure toast literal "Could not take responsibility — try again"', () => {
  assert.ok(
    SOURCE.includes('Could not take responsibility — try again'),
    'failure toast must use the locked literal with em-dash separator',
  );
});

test('Plan 06.1-09: dispatch uses employee.agentId (not employee.userId) as the agentId key', () => {
  assert.match(SOURCE, /employee\.agentId\s*\?\?\s*employee\.userId/);
  // The dispatch object should reference agentIdForOwnership, not employee.userId directly.
  assert.match(SOURCE, /agentId:\s*agentIdForOwnership/);
});

test('Plan 06.1-09: disabled state when viewerUserId is null (Plan 02-09 useResolvedUserId gap)', () => {
  assert.match(SOURCE, /takeOwnershipDisabled\s*=\s*!viewerUserId/);
  // Tooltip literal matches the Critical Path convention.
  assert.match(SOURCE, /Sign in to claim ownership/);
});

test('Plan 06.1-09: button click guarded against the UNOWNED_SENTINEL value', () => {
  assert.match(SOURCE, /UNOWNED_SENTINEL\s*=\s*['"`]__unowned__['"`]/);
  assert.match(SOURCE, /agentIdForOwnership\s*===\s*UNOWNED_SENTINEL/);
});

test('Plan 06.1-09: dispatch includes companyId, ownerUserId, userId (T-04-16 viewer-authority shape)', () => {
  assert.match(SOURCE, /companyId:\s*companyId\s*\?\?\s*['"`]['"`]/);
  assert.match(SOURCE, /ownerUserId:\s*viewerUserId/);
  assert.match(SOURCE, /userId:\s*viewerUserId/);
});

test('Plan 06.1-09: onTakeOwnershipSuccess callback called on success only', () => {
  assert.match(SOURCE, /if \(result && result\.ok\)[\s\S]*?onTakeOwnershipSuccess/);
});

test('Plan 06.1-09: EmployeeSnapshot.agentId is optional (backward compat with pre-06.1-09 payloads)', () => {
  assert.match(SOURCE, /agentId\?\s*:\s*string/);
});

test('Plan 06.1-08/10: composition has all three branches (no blockers / unclaimed / default)', () => {
  // Three-way branch detection: idle case, unclaimed case, default case.
  assert.match(SOURCE, /if \(!terminal\)/);
  assert.match(SOURCE, /} else if \(!hasBlockers\)/);
  assert.match(SOURCE, /} else if \(isUnclaimed\)/);
  assert.match(SOURCE, /} else \{/);
});

test('Plan 06.1-08/09/10: NO ctx.issues.update introduced (CTT-07 invariant)', () => {
  // The UI doesn't call ctx.issues.update directly anyway, but defense-in-depth.
  assert.equal(
    (SOURCE.match(/ctx\.issues\.update/g) || []).length,
    0,
    'CTT-07: agent-card.tsx must not introduce any ctx.issues.update calls',
  );
});
