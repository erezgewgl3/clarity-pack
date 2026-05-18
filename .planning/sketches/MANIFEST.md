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

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | employee-chat-density | How dense/structured should the chat thread feel? | A — Comfortable | layout, chat, density |
| 002 | employee-chat-states | How should message-level states (pending, attachment, failed, closed, reconnecting) read? | TBD | states, chat, components |
