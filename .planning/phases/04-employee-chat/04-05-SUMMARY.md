---
phase: 04-employee-chat
plan: 05
status: complete
completed: 2026-05-19
requirements: [CHAT-07, CHAT-10]
---

# Plan 04-05 Summary — Employee Chat UI Surface

**Status:** CLOSED on its UI scope, 2026-05-19 (operator approved). Reliable multi-turn
conversation and a real "true task" capability are deferred to a follow-up phase — see
Deferred, below.

## What was delivered

The Employee Chat user-facing surface — `chat-stub.tsx` replaced with the four-region
shell from `sketches/paperclip-fix-employee-chat.html`:

- **Roster rail** — company employees (Editor-Agent excluded).
- **Topic strip** — per-employee CHT-NN topics; creating a topic opens it.
- **Message thread** — optimistic send, server-ordered, day dividers, collapsed reasoning
  panels, promote/pin affordances on agent messages; operator messages render "Eric · You",
  agent messages "Agent".
- **Composer** — optimistic send with a Retry affordance + "✓ Sent" confirmation; Enter
  sends, Shift+Enter = newline; attach button disabled with an explicit "Attachments are
  temporarily unavailable" message (CHAT-07 graceful-degrade — the 04-01 spike's OQ-1
  NO-PATH).
- **Context rail** — agent card, tasks / you-owe / attachments / quick-actions / storage-pin.
- A **truthful, sticky, pulsing** live-status indicator (healthy "Live" / "Updates delayed"
  / "Updates stopped" — derived from real poll state).
- `chat.css` — `[data-clarity-surface="chat"]`-scoped stylesheet.

## Build + checkpoint history

Tasks 1-3 (build) committed `33f781f..e5d5c10`. Task 4 was the live visual-fidelity
checkpoint drill on Countermoves. That drill and the operator re-tests that followed
surfaced a long series of host-faithfulness defects the TDD fakes had hidden — each fixed
across versions 0.7.0 → 0.7.8:

- **0.7.1** — new-topic flow (opens topic + strip refresh); context-rail contrast; the
  `Status<b>` run-together label; the CHT allocator bigint-as-string concatenation bug.
- **0.7.2 / 0.7.3** — `chat.send` param-name drift (`message_uuid` vs `messageUuid` — every
  send failed); sender attribution (operator messages showed "Agent"); the `usePluginStream`
  501 NO-PATH → poll made primary; the alarming "reconnecting" banner reframed.
- **0.7.4** — thorough host-contract audit of all 9 chat handlers + UI; promote/pin reworked
  to resolve a comment by id (the `chat_messages` side table is operator-write-only, so
  agent messages have no row); sender identity via `sender_kind`.
- **0.7.5** — Enter-to-send.
- **0.7.6 / 0.7.7 / 0.7.8** — the live-status indicator: static → truthful (real poll
  state) → pulsing + sticky + single-dot + emphasized "Live".

Final suite: **941 tests, 0 fail** (2 pre-existing skips). Artifact: `clarity-pack-0.7.8.tgz`.

## Deferred to a follow-up phase (Phase 4.1 — Chat → True Task)

Live drilling proved the chat *conversation surface* works, but surfaced a design-level gap
out of this plan's scope:

- No operator-side "make this a true task" — `Promote` is agent-messages-only and creates an
  **unassigned, buried** `todo`.
- The chat-topic / agent-task-lifecycle collision — directing an agent runs Paperclip's task
  lifecycle on the chat-topic issue: runtime bookkeeping leaks into the thread, the issue is
  stranded, and **multi-turn conversation is unreliable** (the agent answers once, then stops
  re-waking on follow-ups).

Full problem statement + design questions: **`04-FOLLOWUP-chat-true-task.md`**. Operator
decision 2026-05-19: defer to a dedicated follow-up phase (research → design → implement).

Also recorded: **CHAT-04** ("real-time via `usePluginStream`, no polling") is host-blocked —
plugin streams return HTTP 501 on this Paperclip host; chat runs on 15s polling. CHAT-04
cannot be met as written and must be reconciled at Phase 4 verification.

## Self-check

UI scope delivered and live-verified across the 0.7.x drills. Suite green, typecheck clean,
`clarity-pack-0.7.8.tgz` packed. CHAT-07 + CHAT-10 met for the UI surface; the
conversation-reliability and true-task gaps are tracked in Phase 4.1.
