---
sketch: 001
name: employee-chat-density
question: "How dense/structured should the Employee Chat thread feel?"
winner: "A — Comfortable"
tags: [layout, chat, density, ref-chips]
---

# Sketch 001: Employee Chat — Density

## Design Question

The full Phase-4-scoped Employee Chat page exists as one mockup. The open choice is **how
dense it should read** — the original locked sketch is fairly generous; an operator running
nine agents might want more history on screen. Same page, same content, three density
treatments — flip between them and feel the difference.

## How to View

open .planning/sketches/001-employee-chat-density/index.html

Use the **A / B / C tabs** at the top to switch density live. Sketch toolbar (bottom-right)
has theme / viewport / annotate.

## Variants

- **A: Comfortable** — matches the locked `paperclip-fix-employee-chat.html`: 14.5px text, generous bubble padding, 34px avatars, 18px message gaps. The "feels designed" baseline.
- **B: Compact** — ops-console density: 13px text, tight padding, 26px avatars, 9px gaps. Far more conversation history visible without scrolling — for an operator scanning fast.
- **C: Editorial** — reading-room: 15.5px text, 1.72 line-height, 40px avatars, narrower 680px column, lots of air. Slowest, calmest read.

## What's Phase-4-scoped here (vs the original sketch)

- **No "Group threads"** in the roster — deferred to v2 (D-03). Roster split into Leadership / Operations.
- **Attachments are generic chips** — no inline image preview; full-fidelity previewers are Phase 5 (D-12).
- **A pending "CFO is working…" row** sits after Eric's last message — realistic reply latency is minutes, not the original "14s" (D-04).
- Agent reply timestamps read "replied 2m / 4m / 6m" — native heartbeat cadence (D-01).

## What to Look For

- Does the thread read better tight or airy? At nine employees with multiple topics each, does Compact's extra history win, or does it feel cramped?
- Do the reasoning panel, ref chips, resolved pills, and the decision-recorded card survive all three densities, or does one break them?
- The roster + context rail are shared chrome — does any density make them feel mismatched to the thread?
- Try Send (type + ⌘Enter) and the topic tabs — interaction rhythm at each density.

## Decisions Locked

- **Density: A — Comfortable.** Generous spacing / large bubbles. Compact read cramped at 9 employees; Editorial too airy for an ops surface.
- **Resolved reference chips are title-forward.** Inline `BEAAA-NNN` references render the *task name* first (e.g. "Board capital-charge lock"), with the ID as a small recessed mono tag and a coloured status. The bare number never leads — that is the "zero rabbit-holes" core value made literal.
- **Clicking a chip = inline peek, NOT navigation.** A click pops a peek card in place (Editorial Desk TL;DR, status, owner, latest activity) with an "Open full task" escape hatch. Navigating away to the task page is the rabbit-hole the product exists to kill — so it is the explicit secondary action, never the default click.
- **Layout fix worth carrying to the build:** the message thread is a `flex:1` scroll pane — it needs `min-height:0` + a hard-pinned grid row or it expands past the viewport and hides the composer.

## Interactive

Variant tabs · topic switching · roster select + search · composer send (appends optimistic
bubble + shows pending row) · reasoning `<details>` · hover promote/pin · toasts annotate the
decisions (D-01, D-12, D-13, CHAT-07).
