// src/worker/bulletin/lineage-filter.ts
//
// Plan 07-05 (Phase 7 ITEM 5) — D-I5-01 lineage FILTER.
//
// The Daily Bulletin's "ONE ARTIFACT, END-TO-END" lineage section renders a flat
// chronological list of recent activity that includes routine/scheduled outputs
// (Daily Founder digest, Daily CEO status report ×2, Nightly Auditor Report) +
// exact duplicates → it reads like a LOG, not an insight. This pure filter drops
// that noise so the section delivers insight rather than a chronological dump.
//
// D-I5-01 (LOCKED): drop **routine/scheduled outputs + exact duplicates**; KEEP
// **agent-self substantive outputs**. The filter is heuristic — be CONSERVATIVE:
// when the heuristic is unsure, KEEP the thread.
//
// PURE: no ctx, no I/O, no LLM. Same input → byte-equal output. Mirrors the
// no-ctx/no-I/O style of src/worker/bulletin/lineage-grouper.ts. NEVER throws on
// a malformed thread (a node missing name/detail is treated as empty strings).
//
// Instance-agnostic: NO 'BEAAA' literal — the cadence heuristic targets generic
// scheduled-output phrasing (the BEAAA bulletin's routine threads happen to be
// titled "Daily Founder digest" / "Daily CEO status report" / "Nightly Auditor
// Report" — but any instance's cadence outputs match the same tokens).

import type { LineageThread } from '../../shared/types.ts';

/**
 * Cadence tokens that mark a SCHEDULED/ROUTINE output. A node whose name+detail
 * contains any of these (case-insensitive) is "cadence-shaped". A thread is
 * routine only when EVERY node is cadence-shaped (conservative — a single
 * substantive node defeats the routine flag).
 *
 * These are the digest/report/status cadence phrasings the Editor-Agent and the
 * org-chart's scheduled hires emit (Daily/Nightly/Weekly digests + status
 * reports). Kept deliberately tight so substantive work-product threads
 * (e.g. "Pricing sheet draft", "CSO review of strategy") never match.
 */
const CADENCE_TOKENS: readonly string[] = [
  'daily',
  'nightly',
  'weekly',
  'digest',
  'status report',
  'status update',
];

/**
 * `report` ALONE is too broad (a substantive "Compliance report draft" is real
 * work) — only treat `report` as a cadence signal when it co-occurs with a
 * cadence-cadence word in the SAME node text (e.g. "Nightly Auditor Report",
 * "Daily ... report"). The cadence words above already cover the strong cases;
 * this pairing catches "<Cadence> ... report" phrasings.
 */
const CADENCE_PAIR_WORDS: readonly string[] = ['daily', 'nightly', 'weekly', 'morning', 'evening'];

function nodeText(node: { name?: unknown; detail?: unknown } | null | undefined): string {
  const name = typeof node?.name === 'string' ? node.name : '';
  const detail = typeof node?.detail === 'string' ? node.detail : '';
  return `${name} ${detail}`.toLowerCase();
}

/** True when a single node's text is cadence-shaped (a scheduled-output signal). */
function isCadenceNode(node: { name?: unknown; detail?: unknown }): boolean {
  const text = nodeText(node);
  if (text.trim().length === 0) return false; // empty → not cadence (conservative)
  for (const token of CADENCE_TOKENS) {
    if (text.includes(token)) return true;
  }
  // "<Cadence> ... report" pairing (report alone is NOT enough).
  if (text.includes('report')) {
    for (const w of CADENCE_PAIR_WORDS) {
      if (text.includes(w)) return true;
    }
  }
  return false;
}

/**
 * D-I5-01 routine predicate (exported + unit-tested so the heuristic is pinned
 * directly). A thread is routine when it has at least one node AND EVERY node is
 * cadence-shaped. An empty-node thread is NOT routine (conservative — keep it).
 */
export function isRoutineThread(thread: LineageThread | null | undefined): boolean {
  const nodes = Array.isArray(thread?.nodes) ? thread!.nodes : [];
  if (nodes.length === 0) return false;
  return nodes.every((n) => isCadenceNode(n));
}

/**
 * Canonical exact-duplicate signature for a thread: its entityId plus each
 * node's name~detail~time joined in order. Two threads with the same entity and
 * the same node sequence are exact duplicates (the grouper can emit the same
 * activity under two slightly-different chains). Stable / deterministic.
 */
function threadSignature(thread: LineageThread): string {
  const nodes = Array.isArray(thread.nodes) ? thread.nodes : [];
  const nodeSig = nodes
    .map((n) => {
      const name = typeof n?.name === 'string' ? n.name : '';
      const detail = typeof n?.detail === 'string' ? n.detail : '';
      const time = typeof n?.time === 'string' ? n.time : '';
      return `${name}~${detail}~${time}`;
    })
    .join('>');
  return `${thread.entityId ?? ''}|${nodeSig}`;
}

/**
 * D-I5-01 — drop routine/scheduled threads AND exact-duplicate threads; KEEP
 * agent-self substantive threads. Conservative (unsure → keep). PURE: no ctx, no
 * I/O; byte-equal output for byte-equal input; never mutates the input array.
 */
export function filterLineageThreads(
  threads: LineageThread[] | null | undefined,
): LineageThread[] {
  if (!Array.isArray(threads) || threads.length === 0) return [];
  const seen = new Set<string>();
  const out: LineageThread[] = [];
  for (const thread of threads) {
    if (!thread || typeof thread !== 'object') continue; // defensive — never throw
    if (isRoutineThread(thread)) continue; // drop routine/scheduled
    const sig = threadSignature(thread);
    if (seen.has(sig)) continue; // drop exact duplicate (keep the first)
    seen.add(sig);
    out.push(thread);
  }
  return out;
}
