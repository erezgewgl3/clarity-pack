// src/shared/scrub-human-action.ts
//
// Plan 08-01 Task 1 — the single source of truth for the NO_UUID_LEAK guard.
//
// EXTRACTED VERBATIM from src/worker/handlers/org-blocked-backlog.ts:50-115
// (Plan 07-03 hotfix 35d4945) so BOTH the ROOM-12 org-blocked-backlog AND the
// ROOM-13..16 per-employee rollup (Plan 08-01 Task 3) consume one definition.
// A future blocker-chain change now fixes the scrub in exactly one place.
//
// REUSE (no re-implementation): the four-step scrub plus the three module-local
// constants travel together. The function signature is byte-identical to the
// prior private function — org-blocked-backlog.ts now imports it.

import type { Terminal } from './types.ts';

// Plan 11-01 (D-11) — the legacy unowned-sentinel userId is GONE. UNOWNED is now
// a first-class terminal kind carrying NO userId, so the scrub branches on
// `terminal.kind === 'UNOWNED'` instead of a magic userId string. No sentinel const.

// Hex UUID (8-4-4-4-12). Mirrors humanize-snapshot.ts:30 so the scrub enforces
// the SAME shape contract the job path enforces.
export const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Plan 18-02 (LEG-02) — the SINGLE plain-English fallback vocabulary. When an
// agent UUID does not resolve to a real name/role, the human-facing text must
// read the literal "an agent" — NEVER a partial hash like `agent#04fcac7c`.
// (Pre-18-02 the fallback emitted `agent#<first-8-hex>`, which still leaked a
// machine token into prose a non-builder must read; the live BEAAA-972 Reader
// read "...CEO stuck on agent#04fcac7c is stuck".)
export const AGENT_FALLBACK = 'an agent';

// Plan 18-02 (LEG-02) — the ANCHORED partial-hash guard. It matches the
// removed `agent#<hex{6,}>` fallback shape ONLY — it is anchored to the literal
// `agent#` prefix so it does NOT false-positive on a bare git SHA (`deadbeef`),
// a hex color (`#0E0D0A`), or any other short hex run (landmine #5: a blanket
// `/[0-9a-f]{8,}/` rule would fail builds on legitimate SHAs/colors). The guard
// tests AND the runtime rescrub import THIS one anchor so they can never drift.
export const PARTIAL_HEX_RE = /\bagent#[0-9a-f]{6,}\b/i;

/**
 * Plan 18-02 (LEG-02e) — read-time re-scrub of an ALREADY-PERSISTED display
 * string. Pure, additive, idempotent, ZERO new DB fetches (regex over an
 * in-memory string only). Replace every bare UUID AND every legacy
 * `agent#<hex{6,}>` partial-hash with the plain-English AGENT_FALLBACK so any
 * historical leaked text (e.g. a pre-18-02 `tldr_cache.body`) reads clean on
 * the NEXT render with no destructive migration (additive — coexistence #3/#6).
 *
 * Idempotent: over already-clean text it is a no-op (AGENT_FALLBACK contains no
 * UUID and no `agent#<hex>`, so a second pass changes nothing).
 */
export function rescrubPersisted(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text
    .replace(UUID_RE_G, AGENT_FALLBACK)
    .replace(new RegExp(PARTIAL_HEX_RE.source, 'gi'), AGENT_FALLBACK);
}

/**
 * Plan 18-02 (D-08/D-09) — humanize a chat chip identifier into plain English,
 * single-sourced here so the chat UI and the scrub vocabulary never drift.
 *
 *   - A topic chip ({ kind: 'topic', title, topicId }) → the topic.title (the
 *     human label). NEVER the raw `topicId.slice(0,8)` hex slice (D-09).
 *   - A run chip ({ kind: 'run', agentName?, title? }) → the run's agent
 *     name/role when the payload carries one, else AGENT_FALLBACK (D-09
 *     last-resort). NEVER the raw `runId.slice(0,8)` hex slice.
 *
 * The legitimate ordinal CHT-NN branches are handled by the caller (chtLabel)
 * — this helper owns ONLY the previously-leaking hex-slice path.
 */
export function humanizeChatChip(
  chip:
    | { kind: 'topic'; title?: string | null; topicId?: string | null }
    | { kind: 'run'; agentName?: string | null; title?: string | null },
): string {
  if (chip.kind === 'topic') {
    const title = typeof chip.title === 'string' ? chip.title.trim() : '';
    return title || 'this topic';
  }
  const name = typeof chip.agentName === 'string' ? chip.agentName.trim() : '';
  return name || AGENT_FALLBACK;
}

/**
 * 07-03 HOTFIX — produce a human-action label that contains ZERO raw UUIDs,
 * for ANY terminal kind. This is the situation.snapshot DATA HANDLER's OWN
 * humanize step, mirroring src/worker/jobs/humanize-snapshot.ts:103-152 (the
 * JOB path) so the data handler — which does NOT run that job — gets the same
 * NO_UUID_LEAK guarantee.
 *
 * Pure: depends only on the terminal, the viewer id, and the pre-resolved
 * UUID→name map (D-09 degrade-safe — a name is null/absent ⇒ the plain-English
 * 'an agent' fallback (AGENT_FALLBACK), NEVER a raw UUID or a partial hash).
 *
 *   Plan 11-01 (D-11/D-12) + Plan 18-02 (LEG-02) — branches for all 8 kinds:
 *   1. UNOWNED (genuine, NO userId) → "{name} — assign an owner first" when the
 *      label's embedded UUID resolves, else "Owner unknown — assign an owner first".
 *   2. UNCLASSIFIED (degrade) → honest "Can't determine blocker — open <leaf> to
 *      investigate", NO assign verb (a walk-failure must never claim assignment).
 *   3. AWAITING_AGENT_WORKING / AWAITING_AGENT_STUCK → scrub the agentId to a name
 *      via nameByUuid, else AGENT_FALLBACK ('an agent') — never the raw UUID.
 *   4. Any terminal → replace EVERY embedded UUID with its resolved name, else
 *      AGENT_FALLBACK ('an agent'). (Plan 18-02 LEG-02 — was an `agent#<8>`
 *      partial-hash fallback; that still leaked a machine token into prose.)
 *   5. AWAITING_HUMAN whose userId is the viewer → substitute that id with "You".
 *   6. Belt-and-suspenders: any UUID that somehow survived → 'an agent'.
 */
export function scrubHumanAction(
  terminal: Terminal,
  viewerUserId: string,
  nameByUuid: Map<string, string | null>,
): string {
  const nameOf = (uuid: string): string | null => nameByUuid.get(uuid) ?? null;

  // Step 1 — genuine UNOWNED (D-11). No userId; the label may embed the leaf id.
  if (terminal.kind === 'UNOWNED') {
    const m = terminal.label.match(UUID_RE);
    const name = m ? nameOf(m[0]) : null;
    return name ? `${name} — assign an owner first` : 'Owner unknown — assign an owner first';
  }

  // Step 2 — UNCLASSIFIED degrade (D-12). Honest, NO assign verb. Still scrub any
  // UUID the label may carry so the open-to-investigate line never leaks an id.
  // Plan 18-02 (LEG-02) — the double-scrub collapses to ONE pass: a name or the
  // plain-English 'an agent' fallback (no partial-hash second pass to mop up).
  if (terminal.kind === 'UNCLASSIFIED') {
    return terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? AGENT_FALLBACK);
  }

  // Step 3 — substitute every embedded UUID with a name or 'an agent' (covers
  // AWAITING_AGENT_WORKING/STUCK agentId, AWAITING_HUMAN/EXTERNAL/CYCLE labels).
  let label = terminal.label.replace(UUID_RE_G, (uuid) => nameOf(uuid) ?? AGENT_FALLBACK);

  // Step 4 — viewer userId → "You" for an AWAITING_HUMAN action. Run AFTER step 3
  // because the userId is itself a UUID that step 3 would have already rewritten
  // to a name; substitute against the resolved fragment too.
  if (terminal.kind === 'AWAITING_HUMAN') {
    if (terminal.label.includes(terminal.userId)) {
      const resolved = nameOf(terminal.userId) ?? AGENT_FALLBACK;
      if (terminal.userId === viewerUserId) {
        label = label.split(resolved).join('You');
      }
    }
  }

  // Step 5 — belt-and-suspenders: no UUID may survive → 'an agent'.
  return label.replace(UUID_RE_G, () => AGENT_FALLBACK);
}
