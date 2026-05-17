// test/shared/bulletin-rendering.test.mjs
//
// Plan 03-02 Task 1 RED — pure markdown rendering of a BulletinDraft into the
// canonical body stored in public.issues.description (D-16).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderBulletinIssueBody } from '../../src/shared/bulletin-rendering.ts';

function draftWith(overrides = {}) {
  return {
    masthead: { volume: 'I', number: 12, weekday: 'Friday', dateText: '2026-05-15', prepareForName: 'Eric G.', cycleNumber: 12 },
    actionInbox: [],
    departments: [],
    standingNumbers: [],
    lineageThreads: [],
    ...overrides,
  };
}

test('rendering: empty draft renders at least the masthead header', () => {
  const md = renderBulletinIssueBody(draftWith());
  assert.match(md, /# The Bulletin/);
  assert.match(md, /No\. 12/);
});

test('rendering: action-inbox cards render under a Requires Your Decision heading', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      actionInbox: [
        { issueId: 'i1', identifier: 'COU-1', title: 'Approve refund', department: 'Customer', ageMs: 0, ageText: '3h', summary: 'A customer asked for a refund.' },
      ],
    }),
  );
  assert.match(md, /## Requires Your Decision/);
  assert.match(md, /Approve refund/);
});

test('rendering: department sections render as headings with item rows', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      departments: [
        {
          name: 'Sales',
          editorialSummary: 'A steady day.',
          items: [
            { title: 'Sent 4 briefs', timeText: '09:12', bylineHtml: '<b>Scout</b>', lineageInline: '', note: '' },
          ],
        },
      ],
    }),
  );
  assert.match(md, /### Sales/);
  assert.match(md, /Sent 4 briefs/);
});

test('rendering: standing-numbers panel renders as a heading + one bullet per slot', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      standingNumbers: [
        { key: 'mrr', displayName: 'MRR', value: 2475, format: 'currency' },
        { key: 'briefs_sent_week', displayName: 'Briefs sent', value: 4, format: 'count' },
      ],
    }),
  );
  assert.match(md, /## Standing Numbers/);
  assert.match(md, /MRR/);
  assert.match(md, /\$2,475/);
});

test('rendering: lineage threads render under a One artifact heading with arrow-style steps', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      lineageThreads: [
        {
          id: 'thread-1',
          entityId: 'COU-4',
          nodes: [
            { time: '08:00', name: 'Scout', detail: 'drafted brief', isTerminal: false },
            { time: '09:30', name: 'Editor', detail: 'published', isTerminal: true },
          ],
          truncatedCount: 0,
        },
      ],
    }),
  );
  assert.match(md, /## One artifact, end-to-end/);
  assert.match(md, /Scout/);
  assert.match(md, /TERMINAL/);
});

// ---------------------------------------------------------------------------
// Regression — debug session render-dept-items-undefined (2026-05-17).
//
// On the live v0.6.1 Countermoves re-drill, `renderBulletinIssueBody` crashed
// every compile-bulletin cycle with `TypeError: Cannot read properties of
// undefined (reading 'length')` at `dept.items.length`. Root cause: the LLM
// Editor-Agent emitted a department with nothing to report and OMITTED the
// `items` key; `validateDraftStructure` accepted the draft (it only checked
// top-level arrays); the renderer tripped on the first such department.
//
// The renderer carries a defence-in-depth `?? []` guard so a draft that
// reaches this pure function un-normalized (e.g. a `draft_json` persisted
// before the fix) still renders the quiet-day marker instead of crashing.
// ---------------------------------------------------------------------------

test('rendering: a department object that OMITS `items` renders the quiet-day marker, not a crash', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      departments: [
        // No `items` key at all — exactly the agent-emitted shape that crashed
        // dist/worker.js:4402 on the live drill.
        { name: 'Operations', editorialSummary: 'Nothing to report today.' },
      ],
    }),
  );
  assert.match(md, /### Operations/);
  assert.match(md, /Nothing to report today\./);
  assert.match(md, /\*· no items ·\*/);
});

test('rendering: a department whose `items` is a non-array (null) renders without crashing', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      departments: [{ name: 'Engineering', editorialSummary: '', items: null }],
    }),
  );
  assert.match(md, /### Engineering/);
  assert.match(md, /\*· no items ·\*/);
});

test('rendering: a mix of a populated department and an items-less department both render', () => {
  const md = renderBulletinIssueBody(
    draftWith({
      departments: [
        {
          name: 'Sales',
          editorialSummary: 'Busy.',
          items: [{ title: 'Closed a deal', timeText: '11:00', bylineHtml: '', lineageInline: '', note: '' }],
        },
        { name: 'Legal', editorialSummary: 'Quiet.' }, // omits `items`
      ],
    }),
  );
  assert.match(md, /Closed a deal/);
  assert.match(md, /### Legal/);
  assert.match(md, /\*· no items ·\*/);
});
