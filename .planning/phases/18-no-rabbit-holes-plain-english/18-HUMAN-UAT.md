---
status: partial
phase: 18-no-rabbit-holes-plain-english
source: [18-VERIFICATION.md]
started: 2026-06-15
updated: 2026-06-15
---

## Current Test

[1 item remaining — LEG-03 live-positive demo, env-gated on a fixture; not a defect]

## Tests

### 1. LEG-01 Tier-1 re-probe (optional upgrade vs formal Tier-2 acceptance)
expected: With the Reader now rendering on v1.7.1, run the live-host carrier check. If the host honors `?tab=clarity-reader` or `#tab=clarity-reader`, enable Tier-1 (one-line change in `src/ui/primitives/reader-href.ts`). If not, record formal Tier-2 acceptance.
result: RESOLVED 2026-06-15 — re-probed live on BEAAA v1.7.1 (Playwright via tunnel, issue BEAAA-972). Host honors NEITHER `?tab=clarity-reader` NOR `#tab=clarity-reader` (baseline default tab = Chat; Reader not auto-selected with either carrier). **TIER1_HONORED=false → Tier-2 is FINAL.** No in-plugin upgrade possible (Tier-1 closed by construction — host mounts ReaderView only when its detailTab is already active). ACCEPTED SHORTFALL: Open↗ lands on the issue's default tab; the Clarity Reader is one click away, not the terminal auto-landing. Making it auto-land needs a HOST feature (honor ?tab=/#tab=, or a detailTab defaultTab hint) — a future ask to the Paperclip host team. Probe artifact verdict updated.

### 2. LEG-03 live-positive affordance demo
expected: When a real BEAAA issue reaches the done-but-blocked state (AI TL;DR reads "done" AND deterministic engine still classifies needs-you), confirm the "Looks done — close it?" affordance appears on BOTH the Reader and the SR needs-you row, and that "Keep blocked" does not close it. (Code-proven by 109/109 phase tests; no live fixture exists on BEAAA today.)
result: [pending]

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Notes
- Rider 1 (LEG-01 Tier-1) RESOLVED 2026-06-15 → Tier-2 final (host honors no carrier; accepted host-limitation shortfall, future host-feature ask).
- Rider 2 (LEG-03 live-positive) remains pending — purely waiting for a real done-but-blocked BEAAA item; affordance is code-proven (109/109 phase tests).

## Gaps
