# Sketch Wrap-Up Summary

**Date:** 2026-05-18
**Sketches processed:** 2
**Design areas:** Chat Layout & Density · Inline References · Message States
**Skill output:** `./.claude/skills/sketch-findings-clarity-pack/`

## Included Sketches

| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 001 | employee-chat-density | A — Comfortable (+ title-forward chips, click-to-peek) | Chat Layout & Density · Inline References |
| 002 | employee-chat-states | Pending A (ghost bubble) · Attachment B (compact pill) | Message States |

## Excluded Sketches

| # | Name | Reason |
|---|------|--------|
| — | — | None — both sketches included |

## Design Direction

Phase 4 Employee Chat, warm-dark editorial aesthetic carried from the locked
`sketches/paperclip-fix-employee-chat.html` mockup and reconciled with the 14 decisions in
`04-CONTEXT.md`. Three-column shell (roster / thread / context rail), Comfortable density.
The governing interaction principle is **zero rabbit-holes**: every inline reference resolves
in place rather than sending the user away.

## Key Decisions

- **Density:** Comfortable (Compact cramped at real roster size; Editorial too airy for an ops surface).
- **Inline references:** title-forward resolved chips — task name leads, `BEAAA-NNN` is a small recessed tag, status is coloured. Clicking opens an inline **peek** card (TL;DR / status / owner); navigating to the full task is an explicit escape hatch, never the default.
- **Pending state:** dashed ghost bubble + animated dots; after timeout, an honest "no reply yet" notice — never a forever-spinner.
- **Attachment:** compact single-line pill (no inline preview — Phase 5 owns full-fidelity previewers).
- **Determined states:** failed-send stays + Retry (same `message_uuid`); closed-topic composer says "Reopen & send"; reconnecting shows a degraded poll-fallback banner; attachments-unavailable disables attach with an explicit reason. No silent failures.
- **Layout note for the build:** the message thread is a `flex:1` scroll pane — it needs `min-height:0` + a hard-pinned grid row, or it expands past the viewport and hides the composer.

## Carry-Forward

- Sketch 001's thread still renders the *bordered* attachment chip; the canonical treatment is
  the **compact pill** (002). The findings skill records the pill; the build follows the skill.
