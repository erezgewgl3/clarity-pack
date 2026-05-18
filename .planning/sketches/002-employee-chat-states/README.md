---
sketch: 002
name: employee-chat-states
question: "How should the chat thread's message-level states read?"
winner: "Pending A (ghost bubble) · Attachment B (compact pill)"
tags: [states, chat, components]
---

# Sketch 002: Employee Chat — Message States

## Design Question

The chat thread has to handle states beyond the happy path. Two are genuine design choices
(pending, attachment chip) and show 2–3 options to pick from; the rest are determined by a
Phase 4 decision in 04-CONTEXT.md and show a single treatment for sign-off.

## How to View

open .planning/sketches/002-employee-chat-states/index.html

A single scrollable gallery — each state shown as a realistic chat fragment on the locked
warm-dark theme.

## States

1. **Pending — agent is working** (D-04) · *pick one* — A Ghost bubble / B Slim status line / C Skeleton bubble. Plus the shared timeout notice (never a forever-spinner).
2. **Attachment chip** (D-12) · *pick one* — A Bordered chip / B Compact pill / C Type-badge chip. No inline preview (Phase 5 owns previewers).
3. **Failed send** (D-10) · determined — failed bubble stays with Retry; Retry re-sends on the same `message_uuid`.
4. **Closed-topic composer** (D-06) · determined — composer says the topic is closed; "Reopen & send" names the auto-reopen.
5. **Reconnecting** (D-08) · determined — degraded banner; stream-primary, poll-fallback.
6. **Attachments unavailable** (CHAT-07) · determined — attach disabled with an explicit reason; text still sends.

## What to Look For

- **Pending:** which treatment is honest without overpromising? The skeleton implies a reply shape it can't know; the slim line is quietest; the ghost bubble reads most clearly as "a reply lands here."
- **Attachment chip:** at one file the bordered chip is fine — but a message with 3–4 files? Compare against the compact pill and the type-badge chip.
- The four determined states are for sign-off — flag if any treatment is wrong.

## Decisions Locked

- **Pending: A — Ghost bubble.** A message-shaped dashed placeholder + animated dots reads clearly as "a reply lands here." Skeleton (C) implied a reply shape it can't know; slim line (B) was too quiet.
- **Attachment: B — Compact pill.** Single-line inline pill (clip + name + size). Light enough that a message carrying several files stays readable; the bordered row (A) ate too much vertical space.
- **Determined states signed off:** failed-send bubble + Retry (D-10), closed-topic "Reopen & send" composer (D-06), reconnecting degraded banner (D-08), attach-disabled graceful degrade (CHAT-07).
