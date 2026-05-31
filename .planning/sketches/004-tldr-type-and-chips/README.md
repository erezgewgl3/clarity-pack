---
sketch: 004
name: tldr-type-and-chips
question: "How should the editorial voice read when embedded in the host, and how heavy should ref-chips be?"
winner: "B (Newsreader host serif) + light inline ref-chips"
tags: [reader, typography, tldr, ref-chips, editorial-voice]
---

# Sketch 004: TL;DR Type & Ref-Chips

## Design Question
The live page renders two competing type systems at once — the host's (system-ui + Newsreader + JetBrains Mono) and the plugin's (Geist + Instrument Serif + Geist Mono). The TL;DR's single-weight Instrument Serif also has to fake bold for its `**lead**`. What editorial voice for the TL;DR feels intentional rather than "all over the place" — and how heavy should the inline `BEAAA-NNN` refs be?

## How to View
open .planning/sketches/004-tldr-type-and-chips/index.html

Same briefing content, three type treatments (tabs). The ref-chip two-weights demo at the bottom is shared across all three (chips are font-agnostic).

## Variants
- **A: Instrument Serif (BLUF only)** — keep the "Editorial Desk" display serif, but ONLY on the one lead line (so its single weight never fakes bold); body in Geist sans; IDs in host JetBrains Mono.
- **B: Newsreader (host serif)** — editorial voice in the host's own text serif (real 400/600 weights → true bold), so it harmonizes with Paperclip instead of importing a foreign face.
- **C: All-sans** — no serif; hierarchy carried by size + weight + the gold rule + color. Maximally native, at the cost of editorial character.

## Ref-chips — two weights (shared)
- **Full chip** (border + status badge) — for a ref that stands alone or starts a line.
- **Light inline ref** (no border, status = a dot, underline-on-hover) — for refs embedded mid-sentence, so dense ref-runs read as prose instead of fragmenting into boxed blocks (today's bug). The hover-peek (no-navigate core mechanic) stays on both.

## What to Look For
- Which BLUF voice feels like a *briefing* and still feels native? (A = characterful but foreign; B = characterful and native; C = native but plain.)
- Does the faux-bold problem disappear in A (only the lead is serif) and B (real weights)?
- In the chips demo: feel how the **light inline form** keeps the Goal sentence readable vs the full chips fragmenting it.
- Is one mono (host JetBrains Mono) for all IDs visibly calmer than today's Geist Mono?
