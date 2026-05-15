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
