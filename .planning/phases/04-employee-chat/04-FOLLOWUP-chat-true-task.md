# Follow-up Phase — Chat → True Task (problem statement & handoff)

**Status:** DEFERRED from Phase 4 by operator decision, 2026-05-19. To become a dedicated
follow-up phase: research → design → plan → implement.

**Why this exists:** Phase 4 delivered the Employee Chat as a *conversation* surface. Live
drilling on Countermoves (2026-05-19) surfaced a design-level gap that is out of Phase 4's
committed scope (CHAT-01..11) and cannot be closed with a patch. The operator asked for it
to be handled as the next phase, with a clear written problem statement. This is that
statement.

---

## The problem (two intertwined parts)

### Part 1 — There is no operator-side "make this a true task"

The chat surface has `↗ Promote to task`, but:
- It appears **only on agent messages** (CHAT-09 scoped it that way).
- It creates an **unassigned `todo` issue** — nobody is on the hook for it.
- There is **no** way for the operator to turn an intention into a real, **assigned**,
  tracked task from inside the chat.

"Operator → task" was never a Phase 4 requirement — so this is a genuine capability gap,
not a defect. But "direct your employees" is the core promise of an Employee Chat, so the
gap matters.

### Part 2 — Chat-topic vs. agent-task-lifecycle collision

A chat topic **is** a real Paperclip issue assigned to the employee-agent (assignment is
the wake contract, D-02). That is fine while the topic is used as a *conversation*. But the
moment the operator directs the agent ("Make it happen"), the agent runs Paperclip's full
**task-execution lifecycle** on the chat-topic issue: it does the work, marks the issue
`done`, and the post-completion machinery (disposition checks, recovery-owner logic)
engages — and gets stuck.

**Observed, "Hire a CMO" drill, 2026-05-19:** the CEO agent *successfully* hired a CMO
agent (`618ebd0d-…`, full charter) — then posted a run of Paperclip-runtime bookkeeping
into the chat thread:
- "Paperclip needs a disposition before this issue can continue."
- "The wake was a `finish_successful_run_handoff` with no pending comments — nothing new to act on."
- "Paperclip could not resolve this issue's missing disposition automatically. The issue is
  blocked on a recovery owner."

The chat surface renders **every** comment on the topic issue, so this runtime chatter
appears as chat messages, and the topic issue itself ends up stranded ("blocked on a
recovery owner").

**Observed, multi-turn breakdown, 2026-05-19 (CMO topic CHT-1116):** the CMO agent gave a
substantial first reply, then went **silent on every follow-up message** — despite the
chat UI polling healthily. "Responds once, then stops re-waking" is the same lifecycle
confusion: once the agent has run-completed on the topic issue, subsequent operator
comments do not reliably re-wake it. **Net effect: sustained back-and-forth — the entire
point of a chat — is unreliable.** This makes the chat-topic/lifecycle problem a core
functional blocker for the feature, not a polish item: the follow-up phase must make
multi-turn conversation reliably wake the agent on every operator message.

### Why these are one problem

The operator must be able to *direct agents and create real tasks* — that is the point of
Employee Chat. But the current model (a chat topic = one agent-assigned issue used as both
conversation **and** task) means doing so corrupts the chat thread and strands the issue.
A proper "true task" mechanism and a clean conversation/lifecycle separation are the same
piece of work.

---

## What the follow-up phase must design + implement

1. **A first-class "create a true task" action from the chat surface** — operator-initiated.
   The task is a *separate*, properly **assigned**, tracked Paperclip issue — distinct from
   the chat-topic issue (not the current unassigned-`todo` Promote behaviour).

2. **Separation of conversation from runtime noise** — the chat thread must show genuine
   conversational messages only, never Paperclip agent-task-lifecycle / system bookkeeping.
   Investigate whether runtime/system comments are distinguishable (`authorType`,
   `originKind`, a system flag) so `chat.messages` can filter them.

3. **A chat-topic lifecycle that does not strand the issue** — a chat topic must not get
   stuck in task-completion lifecycle ("blocked on a recovery owner"). Decide how a chat
   topic issue's status/disposition should behave so it stays a durable conversation
   container.

---

## Open design questions for the phase to resolve

- Should a chat topic issue be a **non-completable conversation container** (never goes to
  `done`/disposition), with every "true task" spun off as a separate child issue?
- How does the operator trigger a true task — a composer action ("Send as task"), a Promote
  variant on operator messages, an explicit affordance?
- A true task should be **assigned** (to the employee-agent, or delegable) — unlike today's
  Promote, which leaves it unassigned.
- Is the runtime-comment leak fixable entirely in Clarity Pack (filter in `chat.messages`),
  or does part of it need Paperclip-host coordination (the "recovery owner" / disposition
  behaviour is host-side)?

---

## Evidence & references

- The "Hire a CMO" drill exchange, Countermoves, 2026-05-19 (agent hired the CMO, then
  posted lifecycle noise).
- Promote live test, 2026-05-19: clicking `Promote to task` returned a real task id, but
  the created issue does NOT surface in the Issues list — it is created parented under the
  chat-topic issue (chat-topic issues are plugin plumbing, nested/filtered out of the normal
  Issues view) AND unassigned (`status: todo`, no `assigneeAgentId`). Because it is
  unassigned, no employee-agent acts on it — the operator observed the **Editor-Agent**
  activate (it TL;DR-compiles every new issue, its normal job), NOT the CEO they were
  chatting with. Concrete confirmation that today's Promote produces an orphan task nobody
  owns and that is not even findable in the issue tracker.
- `src/worker/handlers/chat-promote.ts` — current Promote: unassigned `todo`, agent-messages
  only.
- `src/worker/handlers/chat-topics.ts` — `chat.topic.create` assigns the topic issue to the
  employee-agent (D-02 wake contract).
- `src/worker/handlers/chat-messages.ts` — currently returns *every* comment on the topic
  issue; no system/runtime filter.
- Related host limitation already on record: plugin streams return HTTP 501 (CHAT-04
  real-time is host-blocked; chat runs on polling).

## Not in scope here

Phase 4's delivered Employee Chat (conversation surface, topics, send, promote/pin of agent
messages, polling) stands. This follow-up is purely the "true task" capability + the
conversation/lifecycle separation.
