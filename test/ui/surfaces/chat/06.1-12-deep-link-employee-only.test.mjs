// test/ui/surfaces/chat/06.1-12-deep-link-employee-only.test.mjs
//
// Plan 06.1-12 — `employee-only` deep-link route. The Situation Room
// "Open chat with [Agent]" engagement entry uses this route so the
// chat surface lands with the agent selected on the roster but does
// NOT auto-open the New Topic dialog or auto-switch to a specific
// topic. Operator picks from the topic strip what to engage with.
//
// Why this exists: Plan 06.1-11 initially used `new-topic-needed`
// which forced the dialog on every click. Operator critique during
// closure drill: "is it functionally correct that I continue the
// chat and it always wants to open a new topic? Shouldn't it bring
// me to the topic that I'm trying to unblock?" Plan 06.1-12 swapped
// the route + added the new dispatch branch on chat/index.tsx.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildChatDeepLink } from '../../../../src/ui/surfaces/chat/deep-link.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

const CEO_AGENT_ID = 'b2a22e50-d772-4b70-bb50-4f4e93c2e984';
const COMPANY_PREFIX = 'COU';

// Helper: decode the URL_HASH carrier back to the payload object.
function decodeHash(url) {
  const m = url.match(/#h=(.+)$/);
  if (!m) return null;
  const decoded = atob(decodeURIComponent(m[1]));
  return JSON.parse(decoded);
}

test('Plan 06.1-12: employee-only route builds a deep-link with only the employee field', () => {
  const result = buildChatDeepLink({
    route: 'employee-only',
    companyPrefix: COMPANY_PREFIX,
    assigneeAgentId: CEO_AGENT_ID,
  });
  assert.ok(result, 'employee-only with valid assigneeAgentId returns a non-null nav object');
  assert.equal(result.state, undefined, 'state is intentionally undefined (URL_HASH carrier)');
  assert.match(result.to, /^\/COU\/chat#h=/, 'navigates to the chat surface with hash payload');

  const payload = decodeHash(result.to);
  assert.deepEqual(
    payload,
    { employee: CEO_AGENT_ID },
    'payload carries ONLY the employee field — no newTopic, no topic, no seeds',
  );
});

test('Plan 06.1-12: employee-only WITHOUT assigneeAgentId returns null (not navigable)', () => {
  const result = buildChatDeepLink({
    route: 'employee-only',
    companyPrefix: COMPANY_PREFIX,
    // assigneeAgentId omitted
  });
  assert.equal(result, null);
});

test('Plan 06.1-12: employee-only with empty-string assigneeAgentId returns null', () => {
  const result = buildChatDeepLink({
    route: 'employee-only',
    companyPrefix: COMPANY_PREFIX,
    assigneeAgentId: '',
  });
  assert.equal(result, null);
});

test('Plan 06.1-12: pre-existing routes still work (regression baseline)', () => {
  // existing-topic route
  const existing = buildChatDeepLink({
    route: 'existing-topic',
    companyPrefix: COMPANY_PREFIX,
    topicIssueId: '78e495ca-6c0e-4e7d-ac33-2f5e57c223be',
    assigneeAgentId: CEO_AGENT_ID,
  });
  assert.ok(existing);
  const existingPayload = decodeHash(existing.to);
  assert.equal(existingPayload.topic, '78e495ca-6c0e-4e7d-ac33-2f5e57c223be');
  assert.equal(existingPayload.employee, CEO_AGENT_ID);
  assert.equal(existingPayload.newTopic, undefined);

  // new-topic-needed route
  const newTopic = buildChatDeepLink({
    route: 'new-topic-needed',
    companyPrefix: COMPANY_PREFIX,
    assigneeAgentId: CEO_AGENT_ID,
  });
  assert.ok(newTopic);
  const newTopicPayload = decodeHash(newTopic.to);
  assert.equal(newTopicPayload.newTopic, true);
  assert.equal(newTopicPayload.employee, CEO_AGENT_ID);
});

test('Plan 06.1-12: chat/index.tsx has a dispatch branch for employee-only deep-links', () => {
  // Source-grep verification that the chat surface consumes the new route.
  const SOURCE = readFileSync(
    path.join(REPO_ROOT, 'src/ui/surfaces/chat/index.tsx'),
    'utf8',
  );
  // The new branch fires when link.employee is set but neither newTopic
  // nor topic is set. Must call setEmployee after matching against roster.
  assert.match(SOURCE, /} else if \(link\.employee && roster\)/);
  assert.match(SOURCE, /roster\.find\(\(e\) => e\.id === link\.employee\)/);
  assert.match(SOURCE, /if \(matched\) setEmployee\(matched\)/);
});
