// src/worker/bulletin/bulletin-verifier.ts
//
// Plan 03-02 — Pass-2 deterministic verifier (CONTEXT.md D-15).
//
// NEVER an LLM. Pure async function: for every standing-number the draft
// claims, look up the canonical SQL in STANDING_NUMBER_SLOTS by key, re-run it
// via the injected SqlClient, and compare the actual result to the claimed
// value. Returns a typed VerifierResult discriminated union.
//
// T-03-08 (hallucinated numbers): a number that drifts from its SQL source is
// rejected with a typed `{slot, claimed, actual, tolerance}` mismatch. An
// `{{NUMBER:X}}` placeholder that references a slot with no canonical SQL is
// rejected with `{kind:'UNKNOWN_SLOT', slot}`.
//
// Tolerance: exact for integers (currency/count), ±0.01 absolute for
// percentage and ratio formats (RESEARCH.md Pattern 5).
//
// Three consecutive `{ok:false}` results at the CALLER layer
// (compile-bulletin.ts) trip the existing circuit-breaker via
// recordFailure(agentKey='bulletin-compile') — the verifier itself stays pure
// and never touches `ctx` or the circuit breaker.

import type { BulletinDraft, VerifierResult } from '../../shared/types.ts';
import { STANDING_NUMBER_SLOTS } from './standing-numbers.ts';

/** Narrow SQL client shape — tests inject a stub keyed by SQL string. */
export type SqlClient = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
};

/** ±1 percentage point absolute tolerance for pct slots. */
const PCT_TOLERANCE = 0.01;
/** ±0.01 absolute tolerance for ratio slots. */
const RATIO_TOLERANCE = 0.01;

/**
 * Pure-async verifier. Iterates draft.standingNumbers; for each, re-runs the
 * canonical slot SQL via `sqlClient` and compares actual to the draft's
 * claimed value. Deterministic — calling twice with the same inputs yields a
 * deep-equal result.
 */
export async function verifyDraft(
  draft: BulletinDraft,
  sqlClient: SqlClient,
  companyId: string,
): Promise<VerifierResult> {
  const mismatches: Array<{
    slot: string;
    claimed: unknown;
    actual: unknown;
    tolerance: number;
  }> = [];

  for (const claimed of draft.standingNumbers) {
    const slotDef = STANDING_NUMBER_SLOTS.find((s) => s.key === claimed.key);
    if (!slotDef) {
      return { ok: false, kind: 'UNKNOWN_SLOT', slot: claimed.key };
    }

    const params = slotDef.params.map((p) => (p === '<companyId>' ? companyId : p));
    let actual: number;
    try {
      const rows = await sqlClient.query<{ value: number }>(slotDef.sql, params);
      actual = Number(rows[0]?.value ?? 0);
    } catch {
      mismatches.push({
        slot: claimed.key,
        claimed: claimed.value,
        actual: 'query_failed',
        tolerance: 0,
      });
      continue;
    }

    const tolerance =
      claimed.format === 'pct'
        ? PCT_TOLERANCE
        : claimed.format === 'ratio'
          ? RATIO_TOLERANCE
          : 0;
    const diff = Math.abs(Number(claimed.value) - actual);
    if (diff > tolerance) {
      mismatches.push({ slot: claimed.key, claimed: claimed.value, actual, tolerance });
    }
  }

  if (mismatches.length === 0) return { ok: true };
  return { ok: false, mismatches };
}
