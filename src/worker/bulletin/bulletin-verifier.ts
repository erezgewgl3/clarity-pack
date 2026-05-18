// src/worker/bulletin/bulletin-verifier.ts
//
// Plan 03-02 — Pass-2 deterministic verifier (CONTEXT.md D-15).
// v0.6.6 — re-grounded against the FROZEN facts snapshot (debug session
//          bulletin-compile-cadence-runaway, Bug 2).
//
// NEVER an LLM. Pure (sync) function: for every standing-number the draft
// claims, look up the FROZEN value the pipeline HANDED the agent at compile
// START and compare the agent's claimed value to it.
//
// WHY THE FROZEN SNAPSHOT, NOT A LIVE SQL RE-RUN (Bug 2, 2026-05-18 drill).
// The original verifier RE-RAN each `slotDef.sql` at the END of the compile and
// exact-matched (`tolerance: 0`) against the draft. The agent takes ~50s; during
// that window Paperclip churns its own board (`stranded_issue_recovery` issues
// auto-created+auto-completed; a freshly-published bulletin issue counting
// itself) so the re-run SQL legitimately disagreed with the numbers the agent
// was handed — every cycle lost the compile-window race and was rejected.
//
// The fix: the verifier's job is "did the agent faithfully transcribe the
// numbers we GAVE it" (catches hallucination — a number the agent invented or
// mangled), NOT "do the numbers still match a fresh live re-query" (an
// unwinnable race the facts snapshot exists precisely to eliminate). The draft
// claimed 4 because `computeStandingNumbers` produced 4 at compile START — the
// draft is faithful; re-querying and getting 5 makes the VERIFIER wrong.
//
// T-03-08 (hallucinated numbers): a draft number that drifts from the frozen
// snapshot value is rejected with a typed `{slot, claimed, actual, tolerance}`
// mismatch. A standing-number key the draft claims that was NOT in the frozen
// snapshot is rejected with `{kind:'UNKNOWN_SLOT', slot}`.
//
// Tolerance: exact for integers (currency/count), ±0.01 absolute for
// percentage and ratio formats (RESEARCH.md Pattern 5).
//
// Three consecutive `{ok:false}` results at the CALLER layer
// (compile-bulletin.ts) trip the existing circuit-breaker via
// recordFailure(agentKey='bulletin-compile') — the verifier itself stays pure
// and never touches `ctx` or the circuit breaker.

import type { BulletinDraft, StandingNumberRow, VerifierResult } from '../../shared/types.ts';

/** ±1 percentage point absolute tolerance for pct slots. */
const PCT_TOLERANCE = 0.01;
/** ±0.01 absolute tolerance for ratio slots. */
const RATIO_TOLERANCE = 0.01;

/**
 * Pure verifier. Iterates `draft.standingNumbers`; for each, looks up the
 * FROZEN value the pipeline handed the agent at compile START (the
 * `computeStandingNumbers` output, passed in as `frozenStandingNumbers`) and
 * compares the agent's claimed value to it. Deterministic — calling twice with
 * the same inputs yields a deep-equal result, and there is NO I/O (no SQL
 * re-run), so the result cannot drift across the compile window.
 *
 * @param draft                 the agent's pass-1 BulletinDraft.
 * @param frozenStandingNumbers the EXACT `StandingNumberRow[]` array the
 *                              compile job built from `computeStandingNumbers`
 *                              and handed to `compilePass1` — the single source
 *                              of numeric truth for this cycle.
 */
export function verifyDraft(
  draft: BulletinDraft,
  frozenStandingNumbers: readonly StandingNumberRow[],
): VerifierResult {
  const frozenByKey = new Map<string, StandingNumberRow>(
    frozenStandingNumbers.map((row) => [row.key, row]),
  );

  const mismatches: Array<{
    slot: string;
    claimed: unknown;
    actual: unknown;
    tolerance: number;
  }> = [];

  for (const claimed of draft.standingNumbers) {
    const frozen = frozenByKey.get(claimed.key);
    if (!frozen) {
      // The draft claims a standing-number key the pipeline never handed it —
      // the agent invented a slot. That is a hallucinated slot, not a race.
      return { ok: false, kind: 'UNKNOWN_SLOT', slot: claimed.key };
    }

    const tolerance =
      claimed.format === 'pct'
        ? PCT_TOLERANCE
        : claimed.format === 'ratio'
          ? RATIO_TOLERANCE
          : 0;
    const diff = Math.abs(Number(claimed.value) - Number(frozen.value));
    if (diff > tolerance) {
      mismatches.push({
        slot: claimed.key,
        claimed: claimed.value,
        actual: frozen.value,
        tolerance,
      });
    }
  }

  if (mismatches.length === 0) return { ok: true };
  return { ok: false, mismatches };
}
