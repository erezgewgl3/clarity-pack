// src/worker/bulletin/lineage-grouper.ts
//
// Plan 03-03 — Temporal+actor proximity heuristic for lineage threads
// (D-21 fallback since the SDK has no `caused_by_activity_id` field on the
// activity log — see 03-RESEARCH.md Q3).
//
// Pure deterministic code. Same input → byte-equal output. No LLM, no ctx,
// no I/O. Mirrors the shape of src/shared/blocker-chain.ts: sort the input
// into a canonical order, then walk it once building clusters.
//
// Algorithm: group activities by (entityId, actorChain) — events that share
// an entity AND an actor-chain belong to the same lineage. Within a group,
// consecutive events more than `maxDeltaSec` apart start a NEW thread (the
// agent-handoff gap). Clusters longer than NODE_TRUNCATE_AT nodes keep only
// the first NODE_TRUNCATE_AT and report the overflow via `truncatedCount`
// (CONTEXT.md "Claude's Discretion" — sketch shows 8 nodes).

import type { LineageThread } from '../../shared/types.ts';

export type ActivityEvent = {
  id: string;
  entityId: string; // issueId, agentId, document-id, etc.
  actorId: string; // agent or user id
  actorChain?: string; // optional "parent → child" thread marker; default = actorId
  timestamp: string; // ISO
  message: string;
  name?: string; // optional display name
  detail?: string;
};

const DEFAULT_MAX_DELTA_SEC = 300;
const NODE_TRUNCATE_AT = 8;

/**
 * Pure function. Groups activities by (entityId, actorChain) into clusters
 * where consecutive events within the same cluster are at most
 * `opts.maxDeltaSec` apart. Returns a deterministic LineageThread[].
 */
export function groupLineageThreads(
  activities: ActivityEvent[] | null | undefined,
  opts: { maxDeltaSec?: number } = {},
): LineageThread[] {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  const maxDeltaMs = (opts.maxDeltaSec ?? DEFAULT_MAX_DELTA_SEC) * 1000;

  // Deterministic sort: entityId, then (actorChain ?? actorId), then timestamp,
  // then id as a final tie-break so identical timestamps never reorder.
  const sorted = [...activities].sort((a, b) => {
    if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
    const aChain = a.actorChain ?? a.actorId;
    const bChain = b.actorChain ?? b.actorId;
    if (aChain !== bChain) return aChain < bChain ? -1 : 1;
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const threads: LineageThread[] = [];
  let currentGroup: ActivityEvent[] = [];
  let currentKey: string | null = null;

  const flush = (): void => {
    if (currentGroup.length === 0) return;
    const head = currentGroup[0];
    const kept = currentGroup.slice(0, NODE_TRUNCATE_AT);
    const nodes = kept.map((ev, i) => ({
      time: timeOf(ev.timestamp),
      name: ev.name ?? ev.actorId,
      detail: ev.detail ?? ev.message,
      isTerminal: i === kept.length - 1,
    }));
    threads.push({
      id: `${head.entityId}:${head.actorChain ?? head.actorId}:${head.timestamp}`,
      entityId: head.entityId,
      nodes,
      truncatedCount: Math.max(0, currentGroup.length - NODE_TRUNCATE_AT),
    });
    currentGroup = [];
  };

  for (const ev of sorted) {
    const key = `${ev.entityId}::${ev.actorChain ?? ev.actorId}`;
    if (key !== currentKey) {
      flush();
      currentKey = key;
      currentGroup.push(ev);
      continue;
    }
    const last = currentGroup[currentGroup.length - 1];
    const delta = new Date(ev.timestamp).getTime() - new Date(last.timestamp).getTime();
    if (delta > maxDeltaMs) {
      // Same entity+chain but a wide time gap — start a new thread.
      flush();
    }
    currentGroup.push(ev);
  }
  flush();

  return threads;
}

/** Extract HH:MM from an ISO timestamp; falls back to the raw string. */
function timeOf(iso: string): string {
  if (typeof iso === 'string' && iso.length >= 16 && iso[10] === 'T') {
    return iso.slice(11, 16);
  }
  return iso;
}
