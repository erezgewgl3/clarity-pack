// test/worker/org-blocked-backlog.test.mjs
//
// Plan 07-03 Task 1 RED — the pure org-blocked-backlog builder.
//
// Phase 7 ITEM 4: the Situation Room reports "No blockers" on every agent
// card while ~24 issues sit status=blocked, because buildEmployeeRow walks
// blockers PER AGENT from current_focus_issue_id (every idle agent → empty
// chain). The FIX is an ORG-LEVEL backlog: walk ALL company-wide
// status=blocked issues directly, flatten each via the EXISTING
// flattenBlockerChain, rank HUMAN_ACTION_ON-first via the EXISTING
// pickTopChains, resolve owners to display NAMES via the D-09 NO_UUID_LEAK
// pattern.
//
// Convention: plain-object ctx stub (mirrors situation-snapshot.test.mjs's
// makeJobCtx idiom — NO new devDep). Instance-neutral fixture ids (COU-/ACME-,
// NOT BEAAA).

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildOrgBlockedBacklog } from '../../src/worker/handlers/org-blocked-backlog.ts';

// ---------------------------------------------------------------------------
// Stub factory — a structurally-minimal ctx the builder accepts.
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array} opts.issues       what ctx.issues.list returns
 * @param {object} opts.relations   map issueId → { blockedBy, blocks }
 * @param {object} opts.agents      map agentUuid → { name } | throws via the
 *                                  `agentsThrow` flag below
 * @param {boolean} [opts.listThrows]   ctx.issues.list throws
 * @param {Set<string>} [opts.relationsThrowFor]  ids whose relations.get throws
 * @param {boolean} [opts.agentsThrow]  ctx.agents.get throws for every uuid
 * @param {boolean} [opts.noAgents]     omit ctx.agents entirely
 */
function makeCtx({
  issues = [],
  relations = {},
  agents = {},
  listThrows = false,
  relationsThrowFor = new Set(),
  agentsThrow = false,
  noAgents = false,
} = {}) {
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    issues: {
      async list() {
        if (listThrows) throw new Error('issues.list boom');
        return issues;
      },
      relations: {
        async get(id) {
          if (relationsThrowFor.has(id)) throw new Error(`relations.get boom for ${id}`);
          return relations[id] ?? { blockedBy: [], blocks: [] };
        },
      },
    },
  };
  if (!noAgents) {
    ctx.agents = {
      async get(uuid) {
        if (agentsThrow) throw new Error('agents.get boom');
        return agents[uuid] ?? null;
      },
    };
  }
  return ctx;
}

// A blocked issue whose single blocker is OWNED + awaiting → AWAITING_HUMAN.
function humanActionIssue(id, identifier, ownerUuid, viewerUuid = ownerUuid) {
  return {
    issue: {
      id,
      identifier,
      title: `Title for ${identifier}`,
      status: 'blocked',
      assigneeUserId: ownerUuid,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [
        {
          id: `${id}-blocker`,
          assigneeUserId: viewerUuid,
          status: 'awaiting',
          etaIso: null,
        },
      ],
      blocks: [],
    },
  };
}

// Plan 11-02 — a blocked issue whose single blocker is AGENT-owned (no user
// owner, not awaiting). The agentState ('working'|'stuck') is driven by the
// blocker node's heartbeat/queue signals, which buildEdges feeds through the
// pure resolveAgentState helper. Pass `fresh=true` for a recent heartbeat
// (→ AWAITING_AGENT_WORKING) or `fresh=false` / omit for a stale/missing one
// (→ AWAITING_AGENT_STUCK per D-04 conservative).
function agentOwnedIssue(id, identifier, agentUuid, { fresh = false } = {}) {
  return {
    issue: {
      id,
      identifier,
      title: `Title for ${identifier}`,
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [
        {
          id: `${id}-blocker`,
          assigneeUserId: null,
          ownerUserId: null,
          assigneeAgentId: agentUuid,
          status: 'in_progress',
          etaIso: null,
          // Fresh heartbeat (1 min ago) ⇒ working; absent ⇒ conservative stuck.
          lastHeartbeatMs: fresh ? Date.now() - 60 * 1000 : null,
          hasQueuedWork: fresh,
        },
      ],
      blocks: [],
    },
  };
}

// A blocked issue whose single blocker is unowned + has an ETA → SELF_RESOLVING.
function selfResolvingIssue(id, identifier) {
  return {
    issue: {
      id,
      identifier,
      title: `Title for ${identifier}`,
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [
        {
          id: `${id}-blocker`,
          assigneeUserId: null,
          status: 'in_progress',
          etaIso: '2026-06-01T00:00:00Z',
        },
      ],
      blocks: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Ranking + cap + total/overflow
// ---------------------------------------------------------------------------

test('builder — ranks HUMAN_ACTION_ON-first; total === N', async () => {
  const fixtures = [
    selfResolvingIssue('i-s', 'COU-1'),
    humanActionIssue('i-h', 'COU-2', 'u-1'),
  ];
  const ctx = makeCtx({
    issues: fixtures.map((f) => f.issue),
    relations: Object.fromEntries(fixtures.map((f) => [f.issue.id, f.relations])),
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.total, 2);
  assert.equal(backlog.blocked_count, 2);
  // AWAITING_HUMAN ranks before SELF_RESOLVING.
  assert.equal(backlog.rows[0].terminalKind, 'AWAITING_HUMAN');
  assert.equal(backlog.rows[1].terminalKind, 'SELF_RESOLVING');
});

test('builder — caps at 15 with overflow=true and total=N when N>15', async () => {
  const fixtures = [];
  for (let i = 0; i < 20; i += 1) {
    fixtures.push(humanActionIssue(`i-${i}`, `COU-${i}`, 'u-1'));
  }
  const ctx = makeCtx({
    issues: fixtures.map((f) => f.issue),
    relations: Object.fromEntries(fixtures.map((f) => [f.issue.id, f.relations])),
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.total, 20);
  assert.equal(backlog.blocked_count, 20);
  assert.equal(backlog.rows.length, 15);
  assert.equal(backlog.overflow, true);
});

test('builder — overflow=false when total<=15', async () => {
  const fixtures = [humanActionIssue('i-0', 'COU-0', 'u-1')];
  const ctx = makeCtx({
    issues: fixtures.map((f) => f.issue),
    relations: Object.fromEntries(fixtures.map((f) => [f.issue.id, f.relations])),
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.overflow, false);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK — owner resolves to a NAME, never the UUID
// ---------------------------------------------------------------------------

test('builder — ownerName resolves to agents.get .name; row never carries the UUID as ownerName', async () => {
  const fixtures = [humanActionIssue('i-h', 'COU-2', 'u-1')];
  const ctx = makeCtx({
    issues: fixtures.map((f) => f.issue),
    relations: Object.fromEntries(fixtures.map((f) => [f.issue.id, f.relations])),
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  const row = backlog.rows[0];
  assert.equal(row.ownerName, 'Head of Compliance');
  assert.notEqual(row.ownerName, 'u-1');
  // The UUID is carried ONLY as ownerAgentId (for the chat deep-link target).
  assert.equal(row.ownerAgentId, 'u-1');
});

test('builder — agents.get THROWS degrades ownerName to null (NEVER the UUID), build still succeeds', async () => {
  const fixtures = [humanActionIssue('i-h', 'COU-2', 'u-1')];
  const ctx = makeCtx({
    issues: fixtures.map((f) => f.issue),
    relations: Object.fromEntries(fixtures.map((f) => [f.issue.id, f.relations])),
    agentsThrow: true,
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  const row = backlog.rows[0];
  assert.equal(row.ownerName, null);
  assert.notEqual(row.ownerName, 'u-1');
  // ownerAgentId still carried so the UI can build the chat link.
  assert.equal(row.ownerAgentId, 'u-1');
});

test('builder — missing ctx.agents client degrades ALL ownerNames to null (no throw)', async () => {
  const fixtures = [humanActionIssue('i-h', 'COU-2', 'u-1')];
  const ctx = makeCtx({
    issues: fixtures.map((f) => f.issue),
    relations: Object.fromEntries(fixtures.map((f) => [f.issue.id, f.relations])),
    noAgents: true,
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.rows[0].ownerName, null);
});

// ---------------------------------------------------------------------------
// blocked-only filter (defensive — <list_filter_note>)
// ---------------------------------------------------------------------------

test('builder — mixed-status list yields blocked-only rows (defensive filter)', async () => {
  const blocked = humanActionIssue('i-h', 'COU-2', 'u-1');
  const inProgress = {
    issue: {
      id: 'i-ip',
      identifier: 'COU-9',
      title: 'In progress',
      status: 'in_progress',
      assigneeUserId: 'u-1',
      updatedAt: '2026-05-01T00:00:00Z',
    },
  };
  const ctx = makeCtx({
    issues: [blocked.issue, inProgress.issue],
    relations: { 'i-h': blocked.relations },
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.total, 1);
  assert.equal(backlog.rows.length, 1);
  assert.equal(backlog.rows[0].identifier, 'COU-2');
});

// ---------------------------------------------------------------------------
// Degrade-safe — per-issue relations.get throw + fully-thrown list
// ---------------------------------------------------------------------------

test('builder — an issue whose relations.get throws surfaces an UNCLASSIFIED row (Plan 11-02 TAX-03); the others still produce honest rows', async () => {
  // Plan 11-02 — pre-11-02 this DROPPED the throwing issue. Now it surfaces an
  // honest UNCLASSIFIED row so the blocked issue never silently vanishes.
  const a = humanActionIssue('i-a', 'COU-1', 'u-1');
  const b = humanActionIssue('i-b', 'COU-2', 'u-1');
  const ctx = makeCtx({
    issues: [a.issue, b.issue],
    relations: { 'i-a': a.relations, 'i-b': b.relations },
    relationsThrowFor: new Set(['i-a']),
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  // total counts ALL blocked issues; rows now include BOTH (no silent drop).
  assert.equal(backlog.total, 2);
  const byIdent = Object.fromEntries(backlog.rows.map((r) => [r.identifier, r]));
  assert.ok(byIdent['COU-2'], 'the non-throwing issue still renders');
  assert.ok(byIdent['COU-1'], 'the throwing-relations issue surfaces, not dropped');
  assert.equal(byIdent['COU-1'].terminalKind, 'UNCLASSIFIED');
});

test('builder — a fully-thrown issues.list yields the empty backlog shape (never throws)', async () => {
  const ctx = makeCtx({ listThrows: true });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.deepEqual(backlog, {
    rows: [],
    total: 0,
    blocked_count: 0,
    need_you_count: 0,
    overflow: false,
  });
});

// ---------------------------------------------------------------------------
// Age — present vs absent
// ---------------------------------------------------------------------------

test('builder — age_ms is computed when a timestamp field is present', async () => {
  const f = humanActionIssue('i-h', 'COU-2', 'u-1');
  f.issue.updatedAt = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-h': f.relations },
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(typeof backlog.rows[0].age_ms, 'number');
  assert.ok(backlog.rows[0].age_ms >= 2 * 24 * 3600 * 1000);
});

test('builder — age_ms is null when no timestamp field is present (no throw, no NaN)', async () => {
  const f = humanActionIssue('i-h', 'COU-2', 'u-1');
  delete f.issue.updatedAt;
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-h': f.relations },
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.rows[0].age_ms, null);
});

// ---------------------------------------------------------------------------
// need_you_count — viewer-scoped HUMAN_ACTION_ON
// ---------------------------------------------------------------------------

test('builder — need_you_count counts ONLY HUMAN_ACTION_ON rows whose terminal.userId === viewerUserId', async () => {
  // i-me: blocker awaiting the VIEWER (u-viewer) → counts toward need_you.
  // i-other: blocker awaiting a DIFFERENT user (u-other) → does NOT count.
  // i-self: SELF_RESOLVING → does NOT count.
  const me = humanActionIssue('i-me', 'COU-1', 'u-viewer', 'u-viewer');
  const other = humanActionIssue('i-other', 'COU-2', 'u-other', 'u-other');
  const self = selfResolvingIssue('i-self', 'COU-3');
  const ctx = makeCtx({
    issues: [me.issue, other.issue, self.issue],
    relations: {
      'i-me': me.relations,
      'i-other': other.relations,
      'i-self': self.relations,
    },
    agents: {
      'u-viewer': { name: 'You' },
      'u-other': { name: 'Someone Else' },
    },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  assert.equal(backlog.need_you_count, 1);
});

test('builder — need_you_count excludes a genuinely UNOWNED blocker (no userId to match)', async () => {
  // Plan 11-02 — the legacy __unowned__ sentinel is GONE. A blocker with NO
  // owner, NO agent, NO eta now flattens to the first-class UNOWNED terminal,
  // which carries no userId. It is org-wide needs-you, not viewer-specific, so
  // it must NOT inflate the viewer's "M need you" count (V4 viewer-scoping).
  const f = {
    issue: {
      id: 'i-u',
      identifier: 'COU-1',
      title: 'Unowned',
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [{ id: 'i-u-blocker', assigneeUserId: null, status: 'blocked', etaIso: null }],
      blocks: [],
    },
  };
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-u': f.relations },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  assert.equal(backlog.rows[0].terminalKind, 'UNOWNED');
  assert.equal(backlog.need_you_count, 0);
});

// ---------------------------------------------------------------------------
// Row shape — title + humanAction (the terminal label) + identifier
// ---------------------------------------------------------------------------

test('builder — each row carries title, identifier, humanAction (terminal label) + issueId', async () => {
  const f = humanActionIssue('i-h', 'COU-7', 'u-1');
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-h': f.relations },
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  const row = backlog.rows[0];
  assert.equal(row.title, 'Title for COU-7');
  assert.equal(row.identifier, 'COU-7');
  assert.equal(row.issueId, 'i-h');
  assert.equal(typeof row.humanAction, 'string');
  assert.ok(row.humanAction.length > 0);
});

// ---------------------------------------------------------------------------
// NO_UUID_LEAK on humanAction (07-03 HOTFIX) — the action LABEL itself must
// never carry a raw UUID, for ANY terminal kind. Live BEAAA drill 2026-05-29
// caught the org-blocked-backlog panel rendering
// "Owner unknown — assign 7b5c7deb-…-6cf7b724e945 first" because the item-4
// builder passed the flattener's RAW terminal.label straight through (the
// JOB path scrubs this via humanize-snapshot.ts, but the situation.snapshot
// DATA HANDLER does not run that job). The builder now has its OWN humanize
// step mirroring humanize-snapshot.ts.
// ---------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// A blocked issue whose single blocker is UNOWNED + no eta → the flattener's
// first-class UNOWNED terminal, whose label embeds the blocker's raw node UUID
// ("Owner unknown — assign <UUID> first"). Plan 11-02: no more sentinel.
function unownedUuidBlockerIssue(id, identifier, blockerUuid) {
  return {
    issue: {
      id,
      identifier,
      title: `Title for ${identifier}`,
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [{ id: blockerUuid, assigneeUserId: null, status: 'blocked', etaIso: null }],
      blocks: [],
    },
  };
}

test('builder — UNOWNED terminal: humanAction is a clean "assign an owner" phrase with NO raw UUID', async () => {
  const blockerUuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const f = unownedUuidBlockerIssue('i-u', 'COU-1', blockerUuid);
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-u': f.relations },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'UNOWNED');
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
  assert.match(row.humanAction, /assign an owner first/i);
});

test('builder — UNOWNED terminal: embedded blocker UUID that resolves to an agent name is shown by name', async () => {
  const blockerUuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const f = unownedUuidBlockerIssue('i-u', 'COU-1', blockerUuid);
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-u': f.relations },
    agents: { [blockerUuid]: { name: 'Compliance Bot' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
  assert.match(row.humanAction, /Compliance Bot/);
  assert.match(row.humanAction, /assign an owner first/i);
});

test('builder — AWAITING_HUMAN owned terminal: label UUIDs are replaced by the resolved agent name, never raw', async () => {
  // blocker owned by a real UUID (not the viewer) → flattener label is
  // "<ownerUuid> to act on <nodeUuid>". Both UUIDs must be scrubbed.
  const ownerUuid = 'aaaaaaaa-1111-2222-3333-444444444444';
  const blockerNodeUuid = 'bbbbbbbb-5555-6666-7777-888888888888';
  const f = {
    issue: {
      id: 'i-h',
      identifier: 'COU-2',
      title: 'Owned blocker',
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [{ id: blockerNodeUuid, assigneeUserId: ownerUuid, status: 'awaiting', etaIso: null }],
      blocks: [],
    },
  };
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-h': f.relations },
    agents: {
      [ownerUuid]: { name: 'Head of Compliance' },
      [blockerNodeUuid]: { name: 'Backlog Item 42' },
    },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'AWAITING_HUMAN');
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
  assert.match(row.humanAction, /Head of Compliance/);
});

test('builder — HUMAN_ACTION_ON terminal whose userId is the VIEWER renders "You", not the raw UUID', async () => {
  const viewerUuid = 'cccccccc-9999-0000-1111-222222222222';
  const blockerNodeUuid = 'dddddddd-3333-4444-5555-666666666666';
  const f = {
    issue: {
      id: 'i-me',
      identifier: 'COU-3',
      title: 'Awaiting you',
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [{ id: blockerNodeUuid, assigneeUserId: viewerUuid, status: 'awaiting', etaIso: null }],
      blocks: [],
    },
  };
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-me': f.relations },
    agents: { [blockerNodeUuid]: { name: 'Backlog Item 42' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', viewerUuid);
  const row = backlog.rows[0];
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
  assert.match(row.humanAction, /\bYou\b/);
});

test('builder — agents.get THROWS for the label UUID: humanAction still has NO raw UUID (agent#<short> fallback)', async () => {
  const blockerUuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const f = unownedUuidBlockerIssue('i-u', 'COU-1', blockerUuid);
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-u': f.relations },
    agentsThrow: true,
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID even when agents.get throws; got: ${row.humanAction}`,
  );
});

test('builder — owned label UUIDs with agents.get THROW fall back to agent#<short>, never raw', async () => {
  const ownerUuid = 'aaaaaaaa-1111-2222-3333-444444444444';
  const blockerNodeUuid = 'bbbbbbbb-5555-6666-7777-888888888888';
  const f = {
    issue: {
      id: 'i-h',
      identifier: 'COU-2',
      title: 'Owned blocker',
      status: 'blocked',
      assigneeUserId: null,
      updatedAt: '2026-05-01T00:00:00Z',
    },
    relations: {
      blockedBy: [{ id: blockerNodeUuid, assigneeUserId: ownerUuid, status: 'awaiting', etaIso: null }],
      blocks: [],
    },
  };
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-h': f.relations },
    agentsThrow: true,
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
  assert.match(row.humanAction, /agent#/);
});

// ---------------------------------------------------------------------------
// Plan 11-02 — agent ownership + liveness ride into the engine via nodeMeta
// (TAX-01 / SC1 / D-01). An agent-owned leaf classifies AWAITING_AGENT_*; a
// fresh heartbeat ⇒ WORKING, a missing/stale one ⇒ STUCK (D-04 conservative).
// ---------------------------------------------------------------------------

test('builder — agent-owned leaf with a FRESH heartbeat classifies AWAITING_AGENT_WORKING (SC1/TAX-01)', async () => {
  const agentUuid = 'eeeeeeee-1111-2222-3333-444444444444';
  const f = agentOwnedIssue('i-aw', 'COU-10', agentUuid, { fresh: true });
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-aw': f.relations },
    agents: { [agentUuid]: { name: 'Builder-Agent' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'AWAITING_AGENT_WORKING');
  // need_you is verdict-keyed: a WORKING agent is in-motion, not needs-you.
  assert.equal(backlog.need_you_count, 0);
  // NO_UUID_LEAK still holds on the action label.
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
});

test('builder — agent-owned leaf with NO heartbeat classifies AWAITING_AGENT_STUCK (D-04 conservative)', async () => {
  const agentUuid = 'eeeeeeee-5555-6666-7777-888888888888';
  const f = agentOwnedIssue('i-as', 'COU-11', agentUuid, { fresh: false });
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-as': f.relations },
    agents: { [agentUuid]: { name: 'Stalled-Agent' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'AWAITING_AGENT_STUCK');
  assert.ok(
    !UUID_RE.test(row.humanAction),
    `humanAction must not contain a raw UUID; got: ${row.humanAction}`,
  );
});

// ---------------------------------------------------------------------------
// Plan 11-02 — a thrown edge build no longer SILENTLY DROPS the issue (TAX-03 /
// D-09). It surfaces an honest UNCLASSIFIED row instead. Contrast with the
// pre-11-02 "issue skipped" behavior, which lost the blocked issue entirely.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plan 12-03 Task 1 (NY-03 / D-09) — OrgBlockedRow now carries the engine
// actionAffordance so the org-blocked backlog expander can gate the
// OwnerPickerPopover off the SAME verdict every other surface reads. After
// 12-01, actionAffordance === 'assign' ⇔ terminal.kind ∈ {UNOWNED,
// AWAITING_AGENT_STUCK}; AWAITING_HUMAN → 'reply'; an UNCLASSIFIED degrade →
// 'open'. The affordance flows from chain.actionAffordance (classifyVerdict) —
// NO new compute, NO terminal.kind string-match in the UI.
// ---------------------------------------------------------------------------

test('builder — UNOWNED row carries actionAffordance "assign" (NY-03/D-09)', async () => {
  const blockerUuid = '7b5c7deb-8135-4d23-b41b-6cf7b724e945';
  const f = unownedUuidBlockerIssue('i-u', 'COU-1', blockerUuid);
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-u': f.relations },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'UNOWNED');
  assert.equal(row.actionAffordance, 'assign');
});

test('builder — AWAITING_AGENT_STUCK row carries actionAffordance "assign" (post-12-01, NY-03/D-09)', async () => {
  const agentUuid = 'eeeeeeee-5555-6666-7777-888888888888';
  const f = agentOwnedIssue('i-as', 'COU-11', agentUuid, { fresh: false });
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-as': f.relations },
    agents: { [agentUuid]: { name: 'Stalled-Agent' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-viewer');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'AWAITING_AGENT_STUCK');
  assert.equal(row.actionAffordance, 'assign');
});

test('builder — AWAITING_HUMAN row carries actionAffordance "reply" (NOT "assign")', async () => {
  const f = humanActionIssue('i-h', 'COU-2', 'u-1');
  const ctx = makeCtx({
    issues: [f.issue],
    relations: { 'i-h': f.relations },
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'AWAITING_HUMAN');
  assert.equal(row.actionAffordance, 'reply');
  assert.notEqual(row.actionAffordance, 'assign');
});

test('builder — UNCLASSIFIED degrade row carries actionAffordance "open" (NOT "assign")', async () => {
  const a = humanActionIssue('i-a', 'COU-1', 'u-1');
  const ctx = makeCtx({
    issues: [a.issue],
    relations: { 'i-a': a.relations },
    relationsThrowFor: new Set(['i-a']), // root relations.get throws → UNCLASSIFIED row
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  const row = backlog.rows[0];
  assert.equal(row.terminalKind, 'UNCLASSIFIED');
  assert.equal(row.actionAffordance, 'open');
  assert.notEqual(row.actionAffordance, 'assign');
});

test('builder — a thrown edge build yields an honest UNCLASSIFIED row, not a dropped issue (TAX-03)', async () => {
  const a = humanActionIssue('i-a', 'COU-1', 'u-1');
  const b = humanActionIssue('i-b', 'COU-2', 'u-1');
  const ctx = makeCtx({
    issues: [a.issue, b.issue],
    relations: { 'i-a': a.relations, 'i-b': b.relations },
    relationsThrowFor: new Set(['i-a']), // root relations.get throws → buildEdges throws
    agents: { 'u-1': { name: 'Head of Compliance' } },
  });
  const backlog = await buildOrgBlockedBacklog(ctx, 'co-1', 'u-1');
  assert.equal(backlog.total, 2);
  // BOTH issues now produce rows — the throwing one is UNCLASSIFIED, not dropped.
  assert.equal(backlog.rows.length, 2);
  const byIdent = Object.fromEntries(backlog.rows.map((r) => [r.identifier, r]));
  assert.equal(byIdent['COU-1'].terminalKind, 'UNCLASSIFIED');
  assert.equal(byIdent['COU-2'].terminalKind, 'AWAITING_HUMAN');
  // The UNCLASSIFIED row's action is the honest open-to-investigate line, NO
  // "assign" verb (a walk failure must never claim a false assignment).
  assert.match(byIdent['COU-1'].humanAction, /open to investigate/i);
  assert.doesNotMatch(byIdent['COU-1'].humanAction, /assign/i);
});
