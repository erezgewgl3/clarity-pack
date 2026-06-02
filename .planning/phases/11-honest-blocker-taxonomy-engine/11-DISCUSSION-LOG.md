# Phase 11: Honest Blocker Taxonomy (engine) - Discussion Log

> **Audit trail only.** Not consumed by downstream agents (researcher, planner, executor).
> Decisions are captured in 11-CONTEXT.md.

**Date:** 2026-06-02
**Phase:** 11-honest-blocker-taxonomy-engine
**Mode:** discuss (default, interactive)
**Areas discussed:** Agent liveness boundary, Terminal taxonomy & migration, Honest unowned vs degrade, Verdict contract

---

## Area: Agent liveness boundary

| Question | Options presented | Selected |
|---|---|---|
| Where is staleness computed? | Caller pre-classifies / Engine computes from injected now / Hybrid | **Caller pre-classifies** |
| What defines 'stuck'? | Heartbeat staleness only / Stale AND nothing queued / Paused-terminated counts too | **Stale AND nothing queued** |
| Agent leaf, no liveness signal → terminal? | agent-stuck (conservative) / Unclassified degrade / agent-working (optimistic) | **agent-stuck (conservative)** |
| Stale window? | 2× heartbeat interval / Fixed 10 min / Configurable constant | **2× heartbeat interval** |

## Area: Terminal taxonomy & migration

| Question | Options presented | Selected |
|---|---|---|
| Evolve the type vocabulary? | Rename + add (clean) / Additive only / Rename + temp alias | **Rename + add (clean)** |
| Migrate 17 consumers? | Big-bang this phase / Adapter shim | **Big-bang this phase** |
| Leaf precedence cascade? | awaiting-first / agent-first / Let me specify | **awaiting-first cascade** |
| Test suite scope this phase? | Fixture per new kind + determinism / Minimal / You decide | **You decide** (planner discretion) |

## Area: Honest unowned vs degrade (TAX-03)

| Question | Options presented | Selected |
|---|---|---|
| Represent the two cases? | Two terminal kinds / One kind + degradeReason / UNOWNED + result error flag | **Two terminal kinds (UNOWNED + UNCLASSIFIED)** |
| Boundary between them? | Walk-success vs walk-failure / Collapse to degrade / Require explicit unowned marker | **Walk-success vs walk-failure** |
| Fate of the `__unowned__` sentinel? | Remove entirely / Keep internally, map at boundary | **Remove entirely** |
| UNCLASSIFIED row copy? | Can't determine + open / Terse unknown / You decide | **Can't determine + open** |

## Area: Verdict contract (SC5)

| Question | Options presented | Selected |
|---|---|---|
| Verdict shape? | Rich verdict object / Just the 8-kind union / Middle: union + needsYou | **Rich verdict object** |
| Engine owns kind→tier/action mapping? | Engine owns it / Surface policy | **Engine owns it** |
| Carry actor identity? | Split label + UUID / Single id field | **Split label + UUID (NO_UUID_LEAK)** |
| Engine pre-computes leverage count? | No — leave to Phase 12 / Yes — engine computes it | **No — leave to Phase 12** |

---

## Deferred Ideas
- Needs-you leverage ranking → Phase 12
- Editor-Agent named-action sentences / action cards → Phase 13
- Reply-in-place + quick-decision chips → Phase 14
- Cockpit IA redesign → Phase 15
- `issue.relations.write` capability → Phase 14 decision (per Phase 10 D-10)

## Claude's Discretion items
- Determinism-test fixtures/depth (D-08), exact UNCLASSIFIED copy (D-12), verdict field naming, worker heartbeat-cadence sourcing for the 2× window (D-03).
