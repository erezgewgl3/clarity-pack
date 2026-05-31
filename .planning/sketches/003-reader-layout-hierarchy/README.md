---
sketch: 003
name: reader-layout-hierarchy
question: "Embedded in the Paperclip host, what Reader structure + reading order feels right?"
winner: "B + conditional on-you banner (C)"
tags: [reader, layout, hierarchy, embedded, coexistence]
---

# Sketch 003: Reader Layout & Hierarchy

## Design Question
The Reader is a **detail tab embedded inside Paperclip** — the host already shows a left nav and a right Properties panel. Today the plugin *also* renders its own 320px right rail, squeezing the reading column to ~424px (wide ref-chips overflow, prose fragments), and the most valuable thing (the TL;DR "nothing left for you") sits below boilerplate. What overall structure + reading order feels right *in that frame*?

## How to View
open .planning/sketches/003-reader-layout-hierarchy/index.html

Each variant is rendered inside a faithful mock Paperclip shell (left nav + tabs + host Properties panel) so the "does it feel native / is the rail redundant" question is real. Use the toolbar (bottom-right) to test desktop / narrow widths.

## Variants
- **A: Rail kept (baseline)** — today's live build. Exposes the two problems: two competing right-hand panels (plugin rail + host Properties), the cramped 424px main column with overflowing chips, and boilerplate above the TL;DR.
- **B: TL;DR-first, no rail** — drop the redundant plugin rail (host Properties owns the right); TL;DR is the first thing under the title with a gold `--you` left rule; raw task body collapses behind "Show full task"; AC + deliverable become inline cards; one ~70ch reading column.
- **C: Hybrid + on-you banner** — same single-column spine as B, but promotes the "on you" action to a full-width banner at the very top (shown here in its healthy "nothing needs you" state) so the on-you signal dominates.

## What to Look For
- Does removing the plugin rail feel like a **loss**, or a relief? (Watch the chip overflow disappear and the measure relax.)
- **TL;DR-first** vs description-first: does leading with the briefing match "zero rabbit-holes"?
- Is the **"Show full task" disclosure** the right call, or do you want the body always visible?
- In C, is the top **on-you banner** worth the vertical space when it's usually "nothing needs you", or does B's quieter treatment win? (The banner earns its keep when something *does* need you — imagine it amber.)
- Throughout: the host chrome is intentionally in system-ui while the plugin content is in Geist — feel the seam (sketch 004 addresses the type system).
