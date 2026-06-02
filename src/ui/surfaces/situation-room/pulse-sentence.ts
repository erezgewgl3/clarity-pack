// src/ui/surfaces/situation-room/pulse-sentence.ts
//
// Plan 15-02 Task 1 (COCK-01 / SC1 / D-02) — the deterministic Pulse status
// sentence: a PURE counts -> plain-English string template.
//
// This is the ALWAYS-ON floor (15-CONTEXT D-02): the one-glance "how's the
// company?" answer the Editor-Agent prose enrichment (DEFERRED this phase, D-03)
// would degrade to. It is a function of the four integers ONLY — no clock, no
// Editor-Agent, no host fetch, no hook. Same inputs -> same string (the SC4
// degrade target). It NEVER blanks: the all-zero case returns an honest floor.
//
// NO_UUID_LEAK / instance-agnostic (D-10): the output is counts + static English
// only — no company prefix, no raw id, no UUID. (Proven by the render-scan in
// pulse-header-no-uuid-leak.test.mjs.)
//
// Voice (sketch-findings "calm scales with control" + "degraded states name
// themselves"):
//   - need-you > 0       -> lead with the actionable count, then reassure with
//                           in-motion: "3 things need you · 5 in motion".
//   - need-you === 0 &&  -> calm/control: "Nothing needs you — 4 in motion."
//     in-motion > 0
//   - all four 0         -> honest floor: "The board is clear."
//   - stuck/self-clearing-> tail, only when > 0: " · 2 stuck · 1 self-clearing".
//                           A zero is shown by its chip, not the prose.

/** The four Pulse vital-sign counts. STRUCTURAL mirror of the worker-side
 *  PulseSummary (15-01 build-pulse-summary.ts) — the UI bundle does NOT import
 *  worker types. Kept structurally identical. */
export type PulseCounts = {
  needYou: number;
  inMotion: number;
  stuck: number;
  selfClearing: number;
};

/** Coerce to a safe non-negative integer so a malformed count never blanks or
 *  lies in the prose (degrade-honest). */
function n(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
}

/** "1 thing" / "3 things" — pluralize a noun against a count. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Build the deterministic one-sentence company-status line from the four counts.
 *
 * PURE: a function of the four integers only. Same inputs -> same string. Never
 * returns an empty string (the all-zero case is an honest floor sentence).
 */
export function buildPulseSentence(pulse: PulseCounts): string {
  const needYou = n(pulse?.needYou ?? 0);
  const inMotion = n(pulse?.inMotion ?? 0);
  const stuck = n(pulse?.stuck ?? 0);
  const selfClearing = n(pulse?.selfClearing ?? 0);

  // The tail surfaces stuck / self-clearing ONLY when > 0 (a zero is its chip).
  const tailParts: string[] = [];
  if (stuck > 0) tailParts.push(`${stuck} stuck`);
  if (selfClearing > 0) tailParts.push(`${selfClearing} self-clearing`);
  const tail = tailParts.length > 0 ? ` · ${tailParts.join(' · ')}` : '';

  // ---- need-you > 0 — lead with the human-actionable count ------------------
  if (needYou > 0) {
    const verb = needYou === 1 ? 'needs' : 'need';
    const lead = `${needYou} ${plural(needYou, 'thing', 'things')} ${verb} you`;
    const motion = inMotion > 0 ? ` · ${inMotion} in motion` : '';
    return `${lead}${motion}${tail}.`;
  }

  // ---- need-you === 0 && in-motion > 0 — calm/control voice -----------------
  if (inMotion > 0) {
    return `Nothing needs you — ${inMotion} in motion${tail}.`;
  }

  // ---- need-you === 0 && in-motion === 0 — but stuck/self-clearing may exist -
  if (tail) {
    // Nothing needs you and nothing is actively moving, but the watch tail has
    // signal — name it honestly rather than claiming the board is clear.
    return `Nothing needs you — ${tailParts.join(' · ')}.`;
  }

  // ---- all four 0 — the honest floor (never blank) --------------------------
  return 'The board is clear.';
}
