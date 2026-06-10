# Phase 17: Structured human-wait + truthful verdicts (CENTERPIECE) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 17-structured-human-wait-truthful-verdicts-centerpiece
**Areas discussed:** Agent declaration mechanism, What the wait captures & shows, Truthful-verdict precedence, Reader legibility fold-ins

---

## Agent declaration mechanism (WAIT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Editor-Agent interprets prose | Editor-Agent detects the wait in employee prose and writes a structured plugin-namespace row; engine reads it. Zero new agent behavior; degrade-safe. | ✓ |
| Deterministic comment marker | Agents emit a fixed grammar; worker regex-parses (no AI). Deterministic but requires prompting every agent; won't fix existing prose. | |
| Both — marker + AI backfill | Marker fast-path + Editor-Agent backfill. Most robust; most build, two paths. | |

**User's choice:** Editor-Agent interprets prose → structured row (engine stays pure).
**Notes:** Decisive factor — employee agents are regular Paperclip hires without the Clarity MCP server, so the signal must derive from comments they already produce. The structured plugin-namespace row is the durable contract; AI populates it, the pure engine consumes it (mirrors the TL;DR split).

### Follow-up: detection sensitivity

| Option | Description | Selected |
|--------|-------------|----------|
| High precision | Only declare when prose clearly names a decision awaiting a person; misses fall to honest Watch floor. | ✓ |
| High recall | Declare on any hint; risks noisy Needs-you rows. | |

**User's choice:** High precision.

### Follow-up: clearing/lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Re-derive each compile | SWR-cached, self-healing; clears when prose no longer shows an open wait or issue leaves blocked. | ✓ |
| Sticky until resolved | Persists until explicit human action / status flip; risks staleness. | |

**User's choice:** Re-derive each compile.

---

## What the wait captures & shows (WAIT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Decision one-liner + owner | Store {polished question text, owner}; row reads "<owner> to decide: <one-liner>" in Reader voice. | ✓ |
| Owner flip only | Just classify needs-you; reuse generic label. Least build, least legible. | |
| Decision one-liner, no distinct owner | Show question; default owner to issue human owner / founder. | |

**User's choice:** Decision one-liner + owner.

### Follow-up: owner resolution when prose is unspecific

| Option | Description | Selected |
|--------|-------------|----------|
| Existing owner → founder | Use issue's human owner if set, else the founder. | |
| Always the founder | Always the company's primary human, ignoring issue-level human assignee. | ✓ |
| Only if prose names someone | Else classify UNOWNED. | |

**User's choice:** Always the founder.
**Notes:** Deliberate single-operator simplification, consistent with v1.5.0 lock ("legible-for-non-builders, NOT multi-operator"). Applies ONLY to the structured-wait path — native blocked+human-owned issues keep their own ownerUserId.

---

## Truthful-verdict precedence (WAIT-03)

### Precedence vs agent ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Structured wait wins | AWAITING_HUMAN over AWAITING_AGENT_*; the BEAAA-972 fix; matches existing "awaiting beats agent" rule. | ✓ |
| Agent wins | Keep agent classification when assigned; re-introduces BEAAA-972 hiding. | |

**User's choice:** Structured wait wins over agent ownership.

### Terminal kind

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse AWAITING_HUMAN | Keep 8-kind union + 8-column SC5 matrix; decision one-liner in label; 'reply' affordance. | ✓ |
| Add a 9th kind | Distinct AWAITING_HUMAN_DECISION; grows matrix to 9 columns; more surface. | |

**User's choice:** Reuse AWAITING_HUMAN.

---

## Reader legibility fold-ins (operator-seeded v1.5.1)

### Breadcrumb mission-goal segment

| Option | Description | Selected |
|--------|-------------|----------|
| Drop it entirely | Remove the root company-mission goal segment (never a useful nav target); truncate other long segments. | ✓ |
| Truncate to a short label | Keep a shortened mission crumb. | |

**User's choice:** Drop it entirely.

### Breadcrumb links

| Option | Description | Selected |
|--------|-------------|----------|
| Link what resolves, else plain text | Prefix + link confirmed-routable segments; plain text otherwise. Zero 404. | ✓ |
| Prefix everything and link all | Risk a 404 if a goal/project page doesn't exist. | |
| All plain text, no links | 404-proof but loses nav affordance. | |

**User's choice:** Link what resolves, else plain text.

### Ref-card de-coding

| Option | Description | Selected |
|--------|-------------|----------|
| Lead plain-English, demote codes | Human title first; BEAAA-NNN subtle/hidden; status chips → plain words. | ✓ |
| Keep codes, restyle subtle | Quieter codes but still on the card. | |
| Hide identifiers entirely | Pure prose; loses cross-reference id. | |

**User's choice:** Lead plain-English, demote codes.

---

## Claude's Discretion

- Exact plugin-namespace table shape, indexes, migration number (additive-only).
- Exact Editor-Agent prompt/heuristic for high-precision human-wait detection.
- Exact SC5 matrix encoding and CI placement (coordinate with Phase 20).
- Precise breadcrumb truncation length and ref-card visual treatment.

## Deferred Ideas

- 9th distinct terminal kind for structured waits — rejected for v1.5.0; revisit only for telemetry separation.
- Multi-operator owner routing — out (single-operator simplification).
- Deterministic agent-emitted marker / Clarity MCP tool for employee agents — possible later fast-path.
- Phase 18 legibility + Phase 19 action-card re-arch — separate phases; do not pull further forward.
