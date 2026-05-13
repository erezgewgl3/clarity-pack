// test/worker/issue-reader-integration.test.mjs
//
// Plan 02-03b Task 1 — integration test stubs that fake the ACTUAL SDK 2026.512.0
// ctx shape (per .planning/phases/02-scaffold-and-surfaces/02-03b-API-SHAPES.md),
// NOT the spec-assumed shape that Plan 02-03 was authored against.
//
// Status: TODO blocks only. Task 2 GREEN will populate them and confirm each
// handler renders the right data slice when fed the real ctx surface.
//
// Why: the existing test/worker/issue-reader.test.mjs mocks `host.currentCompanyId`,
// `ctx.issue.documents.read`, `ctx.activity.log.read`, `ctx.issues.ancestry`, and
// `{rows: T[]}` return shapes — none of which exist on the actual SDK. Tests
// passed locally because mocks matched the (incorrect) handler. On Countermoves
// the handler hit the real SDK and the data slices fell out empty.
//
// These integration tests will RED-fail until Task 2 rewrites the handlers
// against the real shapes documented in 02-03b-API-SHAPES.md.

import test from 'node:test';

import { registerIssueReader } from '../../src/worker/handlers/issue-reader.ts';
import { registerFlattenBlockerChain } from '../../src/worker/handlers/flatten-blocker-chain.ts';
import { registerEditorPauseStatus } from '../../src/worker/handlers/editor-pause-status.ts';

void registerIssueReader;
void registerFlattenBlockerChain;
void registerEditorPauseStatus;

// ---------------------------------------------------------------------------
// Real SDK ctx fake — matches @paperclipai/plugin-sdk@2026.512.0 PluginContext.
// Each handler is supposed to read companyId from PARAMS (UI passes it), not
// from a fictional ctx.host. ctx.db.query returns T[] directly (NOT {rows: T[]}).
// ctx.issues.get takes (issueId, companyId). ctx.issues.documents.list returns
// IssueDocumentSummary[]. ctx.issues.relations.get returns {blockedBy, blocks}.
// ---------------------------------------------------------------------------

test('issue.reader — handler reads issue.description (NOT issue.body)', { todo: 'Task 2: rewrite handler to use real SDK Issue.description field; assert returned issueBody === fakeIssue.description' });

test('issue.reader — handler passes companyId to ctx.issues.get', { todo: 'Task 2: handler must call ctx.issues.get(issueId, companyId); spy and assert both args' });

test('issue.reader — handler derives ancestry by walking parentId chain (NOT ctx.issues.ancestry)', { todo: 'Task 2: fake ctx with no ancestry method; assert handler calls ctx.issues.get for parent, ctx.projects.get for project, ctx.goals.get for goal' });

test('issue.reader — handler calls ctx.issues.documents.list (NOT ctx.issue.documents.read)', { todo: 'Task 2: fake returns IssueDocumentSummary[]; assert handler picks most recent and maps to DeliverablePreview shape' });

test('issue.reader — handler derives activity from ctx.issues.listComments (NOT ctx.activity.log.read)', { todo: 'Task 2: fake returns IssueComment[]; assert handler maps each to {kind:"comment", actor, at, detail} and caps at 8' });

test('issue.reader — handler reads companyId from params (NOT ctx.host)', { todo: 'Task 2: invoke handler with {issueId, companyId}; assert every downstream SDK call carries that companyId' });

test('issue.reader — handler unwraps ctx.db.query result as T[] (NOT {rows: T[]})', { todo: 'Task 2: ctx.db.query returns array directly; assert acItems populated from that array' });

test('issue.reader — handler throws loudly when companyId missing', { todo: 'Task 2: invoke with {issueId} but no companyId; assert handler throws "companyId required"' });

test('issue.reader — refCards resolved in single round-trip (PRIM-01)', { todo: 'Task 2: 3 distinct BEAAA-NNN refs in description, spy on http.fetch, assert exactly 1 outbound call with all 3 ids' });

test('issue.reader — each data slice wraps in try/catch and degrades gracefully', { todo: 'Task 2: fake throws on documents.list; assert deliverable returned null, NOT the whole handler throwing' });

// ---------------------------------------------------------------------------

test('flatten-blocker-chain — handler calls ctx.issues.relations.get (NOT http.fetch /blockers)', { todo: 'Task 2: assert no ctx.http.fetch call; ctx.issues.relations.get called with (issueId, companyId)' });

test('flatten-blocker-chain — handler walks transitively up to MAX_DEPTH=6', { todo: 'Task 2: 4-level chain, assert relations.get called 4 times and depth caps stop traversal' });

test('flatten-blocker-chain — handler returns graceful "no active blockers" terminal when chain empty', { todo: 'Task 2: relations.get returns {blockedBy: [], blocks: []}; assert returned terminal kind === "none"' });

test('flatten-blocker-chain — handler returns 200 (NOT 502) even when SDK call throws', { todo: 'Task 2: relations.get throws; assert handler catches and returns a typed-error terminal, not an unhandled rejection' });

// ---------------------------------------------------------------------------

test('editor.pause-status — handler unwraps ctx.db.query as T[] (NOT {rows: T[]})', { todo: 'Task 2: query returns [{failed_at, reason, consecutive}] directly; assert handler reads the array correctly' });
