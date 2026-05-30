// src/worker/handlers/org-blocked-backlog.ts
//
// Plan 07-03 Task 1 (Phase 7 ITEM 4) — the pure ORG-LEVEL blocked-issue
// backlog builder.
//
// WHY THIS EXISTS: the Situation Room reports "No blockers" on every agent
// card while ~24 issues sit status=blocked. Root cause (situation-snapshot.ts):
// buildEmployeeRow walks blockers PER AGENT from current_focus_issue_id, gated
// `if (startId)`; every agent is idle/Standby (no focus) → empty chain → "No
// blockers". The FIX (output/insight only — NO new schema): walk ALL
// company-wide status=blocked issues DIRECTLY, flatten each to a single human
// action via the EXISTING flattenBlockerChain, rank HUMAN_ACTION_ON-first via
// the EXISTING pickTopChains, resolve each owner to a display NAME (never a
// UUID) via the D-09 ctx.agents.get pattern.
//
// This builder is PURE + structurally-typed so it is test-stubbable without
// the SDK (mirrors the snapshot-job ctx idiom). It is wired into the
// situation.snapshot DATA HANDLER (Task 2, valid HTTP-request scope) — NOT the
// scope-dead recompute-situation job.
//
// REUSE (no re-implementation): flattenBlockerChain + pickTopChains both come
// from src/shared/blocker-chain.ts. The per-issue edge/nodeMeta build mirrors
// the snapshot job's relations.get BFS (situation-snapshot.ts:160-203,
// MAX_CHAIN_DEPTH=6). The owner-name resolution replicates the D-09
// NO_UUID_LEAK dedupe+degrade pattern (resolve-refs.ts:127-159) locally so the
// handler is self-contained.

import {
  flattenBlockerChain,
  pickTopChains,
  type BlockerEdge,
} from '../../shared/blocker-chain.ts';
import type { BlockerChainResult, Terminal } from '../../shared/types.ts';
// Plan 08-01 Task 1 — scrubHumanAction + its UUID constants are now the single
// source of truth in src/shared/scrub-human-action.ts (extracted from this file
// verbatim). Both ROOM-12 (here) and ROOM-13..16 (build-employees-rollup.ts)
// import them, so a future blocker-chain change is fixed in exactly one place.
import {
  scrubHumanAction,
  UUID_RE_G,
  UNOWNED_SENTINEL,
} from '../../shared/scrub-human-action.ts';

// Bound the per-issue blocker walk (mirrors the snapshot job's
// MAX_CHAIN_DEPTH at situation-snapshot.ts:39).
const MAX_CHAIN_DEPTH = 6;

// D-I4-04 — cap the rendered backlog at 12–15. This plan picks 15: covers a
// ~two-dozen-blocked org at >half while staying scannable. A "N total" count +
// overflow indicator surface the rest. (Instance-agnostic: no company-prefix
// literal anywhere in this file.)
const CAP = 15;

/** True iff `s` is exactly a hex UUID (strict, full string). */
function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Every distinct hex UUID inside an arbitrary string. */
function uuidsIn(s: string): string[] {
  return s.match(UUID_RE_G) ?? [];
}

/** A single blocked-issue row in the org backlog. */
export type OrgBlockedRow = {
  issueId: string;
  identifier: string;
  title: string;
  /** The single flattened human action — the terminal.label (React text only;
   *  the UI never renders ownerAgentId as text). */
  humanAction: string;
  terminalKind: Terminal['kind'];
  /** Owner DISPLAY NAME or null. NO_UUID_LEAK: null renders "Unassigned" in
   *  the UI — NEVER the raw UUID. */
  ownerName: string | null;
  /** Owner UUID — carried ONLY as the chat-deep-link target. NOT rendered as
   *  visible text. null/sentinel when the issue has no resolvable owner. */
  ownerAgentId: string | null;
  /** ms since the issue was blocked, or null when no timestamp field parses
   *  (the UI omits the age chip rather than render NaN). */
  age_ms: number | null;
};

export type OrgBlockedBacklog = {
  rows: OrgBlockedRow[];
  /** All blocked issues (the headline N). */
  total: number;
  /** Same as total (the banner's "N blocked"). */
  blocked_count: number;
  /** The banner's "M need you" — HUMAN_ACTION_ON rows whose terminal targets
   *  the VIEWER specifically. */
  need_you_count: number;
  /** total > CAP. */
  overflow: boolean;
};

/** The structural ctx the builder accepts — stubbable in tests, satisfied at
 *  runtime by the widened SituationRoomCtx (Task 2). */
export type OrgBlockedBacklogCtx = {
  issues: {
    list(input: { companyId: string; status?: string }): Promise<unknown[]>;
    relations: {
      get(
        issueId: string,
        companyId: string,
      ): Promise<{ blockedBy?: unknown[]; blocks?: unknown[] } | null | undefined>;
    };
  };
  agents?: {
    get(agentId: string, companyId: string): Promise<unknown | null>;
  };
  logger?: { warn?: (msg: string, meta?: unknown) => void };
};

/** Loosely-typed Issue projection — read camelCase (07-01 proved the real
 *  shape is camelCase). */
type IssueLike = {
  id?: string;
  identifier?: string;
  title?: string;
  status?: string;
  assigneeUserId?: string | null;
  assigneeAgentId?: string | null;
  updatedAt?: string | null;
  statusChangedAt?: string | null;
  blockedAt?: string | null;
  createdAt?: string | null;
};

const EMPTY: OrgBlockedBacklog = {
  rows: [],
  total: 0,
  blocked_count: 0,
  need_you_count: 0,
  overflow: false,
};

/** Read the first present, parseable timestamp field → age in ms, else null.
 *  <age_source_note>: the SDK Issue's "blocked-since" field name is not
 *  guaranteed; try the common candidates and degrade to null (no NaN). */
function ageMsFrom(issue: IssueLike): number | null {
  const candidates = [
    issue.updatedAt,
    issue.statusChangedAt,
    issue.blockedAt,
    issue.createdAt,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) {
      return Math.max(0, Date.now() - t);
    }
  }
  return null;
}

/** Build the blocker-edge graph for one blocked issue by walking
 *  relations.get, mirroring the snapshot job's BFS
 *  (situation-snapshot.ts:160-203). Bounded at MAX_CHAIN_DEPTH; a thrown
 *  relations.get on an inner node is skipped (continue), a thrown call on the
 *  ROOT propagates so the caller can skip the whole issue.
 *
 *  Plan 08-01 Task 3 — EXPORTED so build-employees-rollup.ts reuses the exact
 *  same BFS (Don't-Hand-Roll: per-issue edge graph build). The ctx requirement
 *  is only `issues.relations.get`, satisfied structurally by EmployeesRollupCtx. */
export async function buildEdges(
  ctx: OrgBlockedBacklogCtx,
  companyId: string,
  startId: string,
): Promise<{
  edges: BlockerEdge[];
  nodeMeta: Record<
    string,
    { ownerUserId: string | null; etaIso: string | null; status: string }
  >;
}> {
  const edges: BlockerEdge[] = [];
  const nodeMeta: Record<
    string,
    { ownerUserId: string | null; etaIso: string | null; status: string }
  > = {};
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  let isRoot = true;
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > MAX_CHAIN_DEPTH) continue;
    visited.add(id);
    let summary;
    try {
      summary = await ctx.issues.relations.get(id, companyId);
    } catch (e) {
      // A thrown relations.get on the ROOT issue means we cannot build any
      // chain for it — propagate so the caller skips this issue entirely.
      // On an inner node, skip just that node (the rest of the graph survives).
      if (isRoot) throw e;
      continue;
    } finally {
      isRoot = false;
    }
    const blockedBy = (summary?.blockedBy ?? []) as Array<{
      id?: string;
      issueId?: string;
      key?: string;
      assigneeUserId?: string | null;
      ownerUserId?: string | null;
      etaIso?: string | null;
      status?: string;
    }>;
    for (const blocker of blockedBy) {
      const toId = blocker.id ?? blocker.issueId ?? blocker.key ?? '';
      if (!toId) continue;
      edges.push({ from: id, to: toId, reason: 'blocks' });
      nodeMeta[toId] = {
        ownerUserId: blocker.assigneeUserId ?? blocker.ownerUserId ?? null,
        etaIso: blocker.etaIso ?? null,
        status: blocker.status ?? 'awaiting',
      };
      if (!visited.has(toId) && depth + 1 <= MAX_CHAIN_DEPTH) {
        queue.push({ id: toId, depth: depth + 1 });
      }
    }
  }
  return { edges, nodeMeta };
}

/**
 * Walk ALL company-wide status=blocked issues, flatten each to a single human
 * action, rank HUMAN_ACTION_ON-first, cap at 15, resolve owners to NAMES.
 *
 * Degrade-safe: a thrown ctx.issues.list → the empty backlog; a thrown
 * relations walk for one issue → that issue is skipped; a thrown/absent
 * ctx.agents.get → that owner's name is null (NEVER the UUID). Instance-
 * agnostic: no company-prefix literal.
 */
export async function buildOrgBlockedBacklog(
  ctx: OrgBlockedBacklogCtx,
  companyId: string,
  viewerUserId: string,
): Promise<OrgBlockedBacklog> {
  // 1. List blocked issues (defensive status filter — <list_filter_note>).
  let listed: unknown[];
  try {
    listed = await ctx.issues.list({ companyId, status: 'blocked' });
  } catch (e) {
    ctx.logger?.warn?.('org-blocked-backlog: issues.list failed', {
      companyId,
      err: (e as Error).message,
    });
    return { ...EMPTY };
  }
  const blocked = (Array.isArray(listed) ? listed : []).filter(
    (i): i is IssueLike =>
      !!i && typeof i === 'object' && (i as IssueLike).status === 'blocked',
  );
  const total = blocked.length;

  // 2. Flatten each blocked issue to one Terminal, keeping the source-issue
  //    pairing so the ranked top-CAP rows carry their metadata.
  type Paired = { chain: BlockerChainResult; issue: IssueLike };
  const paired: Paired[] = [];
  for (const issue of blocked) {
    const startId = issue.id ?? issue.identifier ?? '';
    if (!startId) continue;
    let edges: BlockerEdge[];
    let nodeMeta: Record<
      string,
      { ownerUserId: string | null; etaIso: string | null; status: string }
    >;
    try {
      ({ edges, nodeMeta } = await buildEdges(ctx, companyId, startId));
    } catch (e) {
      ctx.logger?.warn?.('org-blocked-backlog: relations walk failed (issue skipped)', {
        companyId,
        startId,
        err: (e as Error).message,
      });
      continue;
    }
    let chain: BlockerChainResult;
    try {
      chain = flattenBlockerChain({ startId, edges, nodeMeta, viewerUserId });
    } catch (e) {
      ctx.logger?.warn?.('org-blocked-backlog: flatten failed (issue skipped)', {
        companyId,
        startId,
        err: (e as Error).message,
      });
      continue;
    }
    paired.push({ chain, issue });
  }

  // 3. Rank HUMAN_ACTION_ON-first via the shared pickTopChains, then re-pair
  //    each ranked chain back to its source issue. We rank the FULL list and
  //    slice to CAP; the pairing is recovered by chain identity.
  const chainToIssue = new Map<BlockerChainResult, IssueLike>();
  for (const p of paired) chainToIssue.set(p.chain, p.issue);
  const rankedChains = pickTopChains(
    paired.map((p) => p.chain),
    CAP,
  );

  // 4. Resolve distinct UUIDs → display NAMES (D-09 NO_UUID_LEAK). This now
  //    covers BOTH the issue OWNER (for row.ownerName) AND every UUID the
  //    flattened terminal LABEL embeds (for scrubHumanAction) — the issue's
  //    HUMAN_ACTION_ON terminal.userId when it is a real UUID (not the
  //    __unowned__ sentinel) plus any UUID found inside terminal.label (07-03
  //    HOTFIX: previously only the owner was resolved, so the raw blocker-node
  //    UUID leaked through terminal.label into row.humanAction).
  const ownerUuidFor = (issue: IssueLike): string | null =>
    (typeof issue.assigneeUserId === 'string' && issue.assigneeUserId
      ? issue.assigneeUserId
      : typeof issue.assigneeAgentId === 'string' && issue.assigneeAgentId
        ? issue.assigneeAgentId
        : null);

  // The shared UUID→name map consumed by both ownerName and scrubHumanAction.
  const nameByUuid = new Map<string, string | null>();
  if (typeof ctx.agents?.get === 'function') {
    const wanted = new Set<string>();
    for (const c of rankedChains) {
      // The issue OWNER → row.ownerName. Resolve ANY non-empty owner id (not
      // gated on UUID-shape — ownerName is a display field, unchanged from the
      // pre-HOTFIX behavior).
      const owner = ownerUuidFor(chainToIssue.get(c)!);
      if (owner) wanted.add(owner);
      // Terminal-label UUIDs → scrubHumanAction. Only hex UUIDs need resolving
      // for the scrubber; the viewer "You" substitution uses terminal.userId.
      const t = c.terminal;
      if (t.kind === 'HUMAN_ACTION_ON' && t.userId !== UNOWNED_SENTINEL && isUuid(t.userId)) {
        wanted.add(t.userId);
      }
      for (const u of uuidsIn(t.label)) wanted.add(u);
    }
    for (const uuid of wanted) {
      try {
        const agent = await ctx.agents.get(uuid, companyId);
        if (agent && typeof (agent as { name?: unknown }).name === 'string') {
          const candidate = (agent as { name: string }).name.trim();
          nameByUuid.set(uuid, candidate || null);
        } else {
          nameByUuid.set(uuid, null);
        }
      } catch (e) {
        // D-09 — degrade silently to null on agents.get throw. NEVER fall back
        // to the UUID; the NO_UUID_LEAK guarantee depends on this (the scrubber
        // then uses the agent#<short> / clean-unowned fallback).
        ctx.logger?.warn?.('org-blocked-backlog: agents.get failed', {
          companyId,
          uuid,
          err: (e as Error).message,
        });
        nameByUuid.set(uuid, null);
      }
    }
  }

  // 5. Emit rows. need_you_count is computed across the RANKED rows (the
  //    rendered backlog): HUMAN_ACTION_ON terminals whose userId === viewer
  //    (not the __unowned__ sentinel, not other users) — mirrors the snapshot
  //    job's awaiting-you semantics (situation-snapshot.ts:414-417).
  const rows: OrgBlockedRow[] = [];
  let needYou = 0;
  for (const chain of rankedChains) {
    const issue = chainToIssue.get(chain)!;
    const ownerUuid = ownerUuidFor(issue);
    const terminal = chain.terminal;
    if (
      terminal.kind === 'HUMAN_ACTION_ON' &&
      terminal.userId !== UNOWNED_SENTINEL &&
      terminal.userId === viewerUserId
    ) {
      needYou += 1;
    }
    rows.push({
      issueId: issue.id ?? issue.identifier ?? '',
      identifier: issue.identifier ?? issue.id ?? '',
      title: issue.title ?? '',
      // 07-03 HOTFIX — scrub the raw terminal.label so the rendered action can
      // NEVER carry a raw UUID (mirrors the JOB path's humanize-snapshot.ts).
      humanAction: scrubHumanAction(terminal, viewerUserId, nameByUuid),
      terminalKind: terminal.kind,
      ownerName: ownerUuid ? (nameByUuid.get(ownerUuid) ?? null) : null,
      ownerAgentId: ownerUuid,
      age_ms: ageMsFrom(issue),
    });
  }

  return {
    rows,
    total,
    blocked_count: total,
    need_you_count: needYou,
    overflow: total > CAP,
  };
}
