// src/worker/jobs/humanize-snapshot.ts
//
// Plan 02-08 Task 2 — pure helpers that rewrite terminal.label so it contains
// zero raw UUIDs. Wraps the output of flattenBlockerChain (shared/blocker-chain
// .ts) BEFORE the recompute-situation job INSERTs the snapshot payload.
//
// Why a separate file:
// - Pure functions: no ctx, no SDK loading; unit-testable in stock node --test.
// - Operator-facing contract: every terminal.label that reaches the UI is
//   asserted to contain no UUID-shaped substrings (humanize-snapshot.test.mjs
//   shape-negation pattern).
//
// THREAT MODEL (T-02-08-01 + T-02-08-05): the IdLookup is scoped per-company.
// `buildIdLookup({ agents, users })` MUST NOT receive entities from other
// companies — the caller (situation-snapshot.ts) builds the lookup inside its
// per-company loop so cross-tenant disclosure is impossible. v1 is
// single-tenant, but the contract is documented for future multi-tenant use.
//
// SDK SHAPE FOR USERS (DEV-11-AGENT-ONLY deviation from plan):
// `@paperclipai/plugin-sdk@2026.512.0` does NOT expose a PluginUsersClient or
// `ctx.users.list({ companyId })` accessor. The plan flagged this; verified by
// grep on node_modules/@paperclipai/plugin-sdk/dist/types.d.ts (no
// UsersClient interface). Therefore Plan 02-08 ships AGENT-ONLY humanization
// — the captured drill payload contains only agent UUIDs anyway, so closing
// the agent path closes the drill's actual narration defect. Human-user name
// resolution becomes a Phase 3 follow-on when (if) the SDK adds the accessor.

import type { BlockerChainResult, Terminal } from '../../shared/types.ts';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  if (s.length === 0) return false;
  return UUID_STRICT.test(s);
}

export type IdLookupEntry = { label: string; kind: 'agent' | 'user' };
export type IdLookup = Map<string, IdLookupEntry>;

/**
 * Title-case for agent roles:
 *   - Short all-lowercase (2-4 chars) → all-uppercase ('ceo' → 'CEO')
 *   - Longer all-lowercase → first-letter-upper ('editor' → 'Editor')
 *   - Mixed-case input → passed through unchanged ('iOS Engineer' stays)
 */
function titleCaseRole(raw: string): string {
  if (!raw) return raw;
  if (raw !== raw.toLowerCase()) return raw; // mixed case — passthrough
  if (raw.length >= 2 && raw.length <= 4) return raw.toUpperCase();
  return raw[0]!.toUpperCase() + raw.slice(1);
}

export function buildIdLookup({
  agents,
  users,
}: {
  agents: Array<{ user_id?: string; id?: string; role?: string }>;
  users: Array<{ id?: string; name?: string }>;
}): IdLookup {
  const out: IdLookup = new Map();
  for (const a of agents) {
    const id = a.user_id ?? a.id;
    if (!id) continue;
    out.set(id, { label: titleCaseRole(a.role ?? 'agent'), kind: 'agent' });
  }
  for (const u of users) {
    if (!u.id) continue;
    out.set(u.id, { label: u.name ?? u.id.slice(0, 8), kind: 'user' });
  }
  return out;
}

/**
 * Rewrites terminal.label so it contains no raw UUIDs. Three passes:
 *
 * (1) HUMAN_ACTION_ON with userId === '__unowned__':
 *     Extract the first UUID from the existing label. If it resolves in
 *     `lookup`, rewrite to "<resolved-label> has no owner assigned".
 *     Otherwise rewrite to "Agent has no owner assigned".
 *
 * (2) Any other terminal kind whose label contains a UUID substring:
 *     Replace each UUID with its lookup label, or with the short-form
 *     'agent#<first-8-hex-chars>' when absent from lookup.
 *
 * (3) Belt-and-suspenders: any UUID that somehow survived steps (1)-(2)
 *     gets replaced with short form, so the operator-facing contract
 *     ("never see a UUID") holds even on a buggy lookup.
 *
 * Pure: returns a new BlockerChainResult + new Terminal; never mutates input.
 */
export function humanizeChain(chain: BlockerChainResult, lookup: IdLookup): BlockerChainResult {
  const t = chain.terminal;
  let newLabel = t.label;

  // Step 1: __unowned__ → "no owner assigned" form
  if (t.kind === 'HUMAN_ACTION_ON' && t.userId === '__unowned__') {
    const m = t.label.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const agentLabel = m ? lookup.get(m[0])?.label : undefined;
    newLabel = agentLabel
      ? `${agentLabel} has no owner assigned`
      : 'Agent has no owner assigned';
  } else {
    // Step 2: substitute every UUID with its lookup label, or short form
    newLabel = t.label.replace(UUID_RE, (uuid) => {
      const entry = lookup.get(uuid);
      if (entry) return entry.label;
      return `agent#${uuid.slice(0, 8)}`;
    });
  }

  // Step 3: belt-and-suspenders
  newLabel = newLabel.replace(UUID_RE, (uuid) => `agent#${uuid.slice(0, 8)}`);

  // Build a new terminal object preserving the discriminant + extras.
  let newTerminal: Terminal;
  switch (t.kind) {
    case 'HUMAN_ACTION_ON':
      newTerminal = { kind: 'HUMAN_ACTION_ON', userId: t.userId, label: newLabel };
      break;
    case 'SELF_RESOLVING':
      newTerminal = { kind: 'SELF_RESOLVING', etaIso: t.etaIso, label: newLabel };
      break;
    case 'EXTERNAL':
      newTerminal = { kind: 'EXTERNAL', label: newLabel };
      break;
    case 'CYCLE':
      newTerminal = { kind: 'CYCLE', cycleNodes: t.cycleNodes, label: newLabel };
      break;
    default: {
      // Exhaustiveness — TS narrows to `never`.
      const _exhaustive: never = t;
      throw new Error(`humanizeChain: unhandled terminal kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
  return {
    startId: chain.startId,
    pathIds: chain.pathIds,
    terminal: newTerminal,
    isStale: chain.isStale,
  };
}
