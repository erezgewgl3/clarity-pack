# Phase 18: No rabbit-holes & plain-English - Discussion Log

> **Audit trail only.** Not consumed by downstream agents (researcher/planner/executor).
> Decisions live in `18-CONTEXT.md`; this log preserves the discussion path.

**Date:** 2026-06-13
**Phase:** 18-no-rabbit-holes-plain-english
**Mode:** discuss (default, interactive)
**SPEC:** loaded — 3 requirements locked (LEG-01/02/03); discussion limited to HOW.

## Area Selection

Presented the four SPEC-named HOW items as gray areas. User selected three:
- Reader tab deep-link
- Divergence trigger def
- Chat-chip render layer

Not selected: **Shared wording helper home** → captured as Claude's Discretion (single shared module extending `scrub-human-action.ts`).

## Area 1 — Reader tab deep-link (LEG-01)

| Question | Options | Selected |
|---|---|---|
| Preferred tab-select mechanism (mechanism unverified) | Try URL param, fallback locked / Skip param → client auto-select / You decide after research | **Try URL param, fallback locked** → D-01, D-02 |
| Behavior if user manually returns to classic tab | Select once then respect user / Sticky Reader preference / You decide | **Select once, then respect user** → D-03 |

## Area 2 — Divergence trigger (LEG-03)

Grounding: `tldr_cache` has only free-text `body` + `tags`; no structured done field.

| Question | Options | Selected |
|---|---|---|
| What defines "TL;DR reads done" | Deterministic regex on body / Structured done-tag from Editor / Hybrid regex+tag-ready | **Deterministic regex on TL;DR body** → D-05 |
| Match tuning (false prompts low-harm but erode trust) | High precision / Balanced / You decide | **High precision (few false prompts)** → D-06 |

## Area 3 — Chat-chip render layer (LEG-02d)

Grounding: `topic-strip.tsx:82` falls back to `id.slice(0,8).toUpperCase()` — the raw-hex leak.

| Question | Options | Selected |
|---|---|---|
| Where to humanize chat chips | UI shared-helper render layer / Worker-side before serialize / You decide | **UI shared-helper render layer** → D-08 |
| What chips resolve to | Title for CHT + name/'an agent' for run / Drop run·<8>, title for CHT / You decide | **Topic title for CHT, agent name/'an agent' for run** → D-09 |

## Close

User selected "I'm ready for context" — no additional gray areas explored.

## Deferred Ideas Captured
- Structured Editor "done" tag for LEG-03 (deferred in favor of deterministic regex; clean upgrade path retained).
- Phase 19 action-cards re-arch; Phase 16 perf (not re-opened); destructive historical migrations (re-scrub on read instead); new visual design (mockup unchanged).

---

*Phase: 18-no-rabbit-holes-plain-english*
*Discussion logged: 2026-06-13*
