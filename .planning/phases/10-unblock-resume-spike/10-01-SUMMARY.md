---
status: partial
phase: 10-unblock-resume-spike
plan: 01
requirement: DO-03
updated: 2026-06-01
---

# Plan 10-01 — Probe harness + Wave-0 dry-confirm (PARTIAL)

> **PARTIAL.** Code complete. Live dry-confirm ran against BEAAA and resolved A3 + D-02; **A1's
> final yes/no is pending the live re-run** (first attempt 422'd on a now-fixed probe defect).
> The A1 re-run is folded into the combined morning live run (see `MORNING-RUNBOOK.md`), which
> runs dry-confirm + all three shapes in one pass once the sacrificial agent exists.

## Tasks

| Task | Status | Note |
|---|---|---|
| 1. Probe harness skeleton | ✅ done | `1a7fbd3` — REST helpers copied verbatim, `[SPIKE 10]` tag, DO-backup bookend header, `node --check` clean |
| 2. Operator bookend (DO backup + rollback verify) | ✅ confirmed | Operator-confirmed (human-verify gate); backup id/timestamp not captured in-session |
| 3. Dry-confirm A1/A3 + D-02 | ◐ partial | `05680e2`,`251cec1`,`589a5a6` — A3 + D-02 answered live; A1 pending re-run |

## Results captured (LIVE, real)

- **A1 — `status:'blocked'` settable via PATCH?** INCONCLUSIVE. Throwaway create 422'd (missing
  `assigneeAgentId`); fixed to assign the sacrificial agent only (never a real agent — D-02).
  Strong prior: 13 real bare-`blocked` items exist → likely SETTABLE; confirm on re-run.
- **A3 — REST agent mint/delete?** NO (400). Manual hire + `SPIKE_PROBE_AGENT_ID` pin. Anticipated.
- **D-02 — per-shape fidelity (200 issues):** Shape A real (BEAAA-1047), Shape B real & dominant
  (13 bare-blocked, BEAAA-1602), Shape C no real relation (construct synthetic). Full data in
  `10-03-SPIKE-FINDINGS.md`.

## Key files
- `scripts/spike/unblock-resume-spike-probe.mjs` — probe harness (created)

## Deviations
- A1 could not be answered in this pass: BEAAA's `POST issues` requires `assigneeAgentId`, and A3
  proved agents aren't REST-mintable — so A1 genuinely depends on a hand-minted sacrificial agent.
  Probe fixed accordingly; A1 answer deferred to the combined live run. No real items written
  (D-02 held). Zero `[SPIKE 10]` residue from the dry-confirm (create failed → nothing to tear down).

## Remaining for plan close
- Live re-run with `SPIKE_PROBE_AGENT_ID` set → record A1 yes/no.
- Then `10-01` + `10-02` close together from the single combined run.
