// src/worker/agents/self-loop-filter.ts
//
// Plan 02-03 Task 1 — D-04 belt-and-suspenders self-loop filter. The
// Editor-Agent writes TL;DRs back to issue documents (and stamps them with the
// EDITOR_WRITE_TAG); without this filter, the very next heartbeat would see
// that write as a fresh event and try to re-compile, looping until the budget
// cap fires. Two independent checks excludes the row:
//   (a) author_id matches the Editor-Agent's resolved id
//   (b) the event's tags array includes 'clarity:editor-write'
//
// Either match excludes — both ensure that future agents (Phase 4 chat-agent,
// any v2 surface agent) inherit the same pattern. The cost is ~10 LOC; the
// benefit is no LLM cost runaway from a single missing field on a write.

/**
 * Locked literal tag. Stamped onto every write produced by the Editor-Agent
 * (and any future Clarity agent). The Situation Room critical-path narrative
 * compiler in Plan 02-04 will reuse this same tag — search-and-replace would
 * be the only path to changing it.
 */
export const EDITOR_WRITE_TAG = 'clarity:editor-write';

/**
 * Minimal event shape we care about. The host's heartbeat-context payload is
 * richer; we only need author_id + tags for the filter decision.
 */
export type SelfLoopEvent = {
  author_id?: string | null;
  tags?: string[] | null;
  // Pass-through fields (entity_type, entity_id, etc.) survive the filter
  // because we copy the object reference, not its fields.
  [key: string]: unknown;
};

/**
 * Drop any event matching (author_id === editorAgentId) OR
 * (tags includes EDITOR_WRITE_TAG). Input order preserved for passing events.
 */
export function filterSelfLoopEvents<E extends SelfLoopEvent>(
  events: E[],
  editorAgentId: string,
): E[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events.filter((e) => {
    if (e?.author_id && e.author_id === editorAgentId) return false;
    const tags = Array.isArray(e?.tags) ? e.tags : [];
    if (tags.includes(EDITOR_WRITE_TAG)) return false;
    return true;
  });
}
