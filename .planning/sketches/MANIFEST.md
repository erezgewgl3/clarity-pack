# Sketch Manifest

## Design Direction

Phase 4 **Employee Chat** surface for the Clarity Pack Paperclip plugin. The aesthetic
is already locked — warm-dark editorial (Geist + Geist Mono + Instrument Serif, paper-on-ink
palette, no neon) ported from `sketches/paperclip-fix-employee-chat.html`, the non-throwaway
visual contract in PROJECT.md. These sketches do NOT re-explore the look; they reconcile that
mockup with the 14 implementation decisions locked in
`.planning/phases/04-employee-chat/04-CONTEXT.md` and explore the genuine open choices:
message density, message-level state treatments (pending/"working", attachment chip,
failed-send, closed-topic, reconnecting).

Scope corrections baked in vs the original sketch: group threads removed (v2), inline
image preview removed (generic attachment chip only — Phase 5 owns previewers), realistic
agent-reply latency (minutes, not "14s") so a pending state is required.

## Reference Points

- `sketches/paperclip-fix-employee-chat.html` — locked visual contract (baseline aesthetic)
- `sketches/paperclip-fix-situation-room.html` / `paperclip-fix-bulletin.html` — sibling Clarity surfaces (cross-surface consistency)

## Reader redesign (003–004, 2026-05-31)

Triggered by the live BEAAA Reader looking "fonts all over the place" + a cramped detail-tab layout. Sketched against the REAL host + plugin tokens (warm-dark, captured live). Key reconciliation with the Phase-4 lock: the standalone-mockup type system (Geist + **Instrument Serif** + Geist Mono) reads as a *foreign island* when EMBEDDED in Paperclip (system-ui + Newsreader + JetBrains Mono). Decision: go **host-native** — inherit host sans for body, **Newsreader** (host text serif, real weights) for the editorial BLUF voice replacing Instrument Serif, host **JetBrains Mono** for IDs. Plus: drop the plugin's redundant right rail on the detail tab (host Properties owns it), lead TL;DR-first under a gold `--you` rule, collapse the raw body, and give ref-chips two weights (full standalone / light inline). This supersedes the Instrument-Serif decision in `sketch-findings-clarity-pack` *for the embedded Reader* (the standalone chat mockup keeps its lock).

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | employee-chat-density | How dense/structured should the chat thread feel? | A — Comfortable | layout, chat, density |
| 002 | employee-chat-states | How should message-level states (pending, attachment, failed, closed, reconnecting) read? | Pending A · Attachment B | states, chat, components |
| 003 | reader-layout-hierarchy | Embedded in the host, what Reader structure + reading order feels right? | B — TL;DR-first, no rail (+ conditional on-you banner from C) | reader, layout, hierarchy, embedded |
| 004 | tldr-type-and-chips | How should the editorial voice read when embedded, and how heavy should ref-chips be? | B — Newsreader host serif (+ light inline ref-chips) | reader, typography, tldr, ref-chips |
