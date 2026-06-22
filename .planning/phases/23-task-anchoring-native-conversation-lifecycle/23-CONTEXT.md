# Phase 23: Task-anchoring & native conversation lifecycle - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make every chat thread a real task issue with a native, truthful lifecycle. Chat messages persist as comments on a real task — the existing task when chatting about one (ANCHOR-02), otherwise a newly created conversation issue (ANCHOR-01) — never on a standalone "Chat — <employee>" container (ANCHOR-03). Per-employee grouping becomes a Clarity-side query-by-assignee view, not a host issue. The agent takes a conversation issue `done` between turns (CONV-01) and a new operator comment natively reopens + re-wakes it (CONV-02, already proven by the Phase 22 spike). Clarity never mutates host issue status — no `issues.update` capability is added (CONV-03). Operator chat messages are attributed as a clean non-agent (`user`) actor so they reliably reopen/re-wake the assignee, and the agent's own replies do not self-trigger the host reopen-loop (REPLY-01).

**Locked by the Phase 22 = GO gate (do NOT re-prove or re-decide):**
- The SC1 reopen recipe — a clean `actorType:"user"` comment on a `done` anchor natively reopens it (`issue_reopened_via_comment`) and re-wakes the assignee. **No `issues.update` to reopen.**
- The SC2 self-comment suppression — the host suppresses an agent's own reply from re-triggering a reopen; Clarity adds NO wake on the agent's reply.
- The CONV-03 capability boundary — Clarity stays create / comment / read-only; the agent owns every status transition; the host owns wake/reopen.

**Out of scope (owned by later phases):** confirmable delegation / propose→confirm (Phase 24); visual "Conversation vs work" distinction, exclusion from active-tasks rails, topic-watchdog deletion, Chat-X container removal at the *create* site, and stranded-artifact cleanup (Phase 25); live BEAAA deploy + drill (Phase 26).

</domain>

<decisions>
## Implementation Decisions

### Operator-message attribution (REPLY-01) — the make-or-break
- **D-01:** Operator chat messages are written **UI-direct under the operator's own Paperclip session** — the plugin UI posts the comment to Paperclip's HTTP comment API using the operator's logged-in identity, so the host attributes it `authorType:"user"` natively (the precondition the Phase 22 D-10 gate proved a `user` actor satisfies). The worker's `ctx.issues.createComment` path is NOT used for operator messages, because the host stamps worker-authored comments `authorType:"system"` (confirmed on Countermoves; a `system` comment will not trip the native reopen).
- **D-02:** Moving the write UI-direct relocates the opt-in gate + message dedup off the worker's `chat.send` handler. This is consistent with the existing same-origin trust posture (manifest capabilities gate worker RPC, not UI HTTP — the opt-in gate was only ever meaningful UI-side for direct writes). The exact relocation (UI-side gate, a lightweight worker pre-check, and where the `message_uuid → comment_id` dedup map is recorded) is a **planner/researcher implementation detail**, not a re-decision of D-01.
- **D-03:** The agent's own reply self-triggering a reopen is **already handled by the host's native self-comment suppression** (Phase 22 SC2, GREEN). Clarity adds NO Clarity-side wake on the agent's reply. (Second half of REPLY-01 — locked by the gate.)

### Existing-task chat entry (ANCHOR-02)
- **D-04:** Chatting about an existing task attaches the conversation as comments **directly on that task issue** (per design spec §5.1) — not on a separate linked conversation issue. The task's own comment thread is the chat.
- **D-05:** Entry points to "chat about this existing task" — support **all three**: (a) from the Task Detail **Reader view** (reuse the Phase 4.2-07 Reader→Chat continuation routing — `origin_issue_id` + assignee reverse-lookup); (b) from a **chat-side task picker** within the Chat surface; (c) from **Situation Room rows / action-cards** (carry the task context into chat).
- **D-06:** Chatting on an **already-`done` work task reopens it natively** (re-waking the assignee) — and that is the **intended** behavior. A question about finished work re-engages the agent; this IS the native loop the milestone wants. Terminal work-tasks are NOT steered to a separate conversation anchor.

### Per-employee grouping view (ANCHOR-03)
- **D-07:** The chat roster **keeps its current employee-grouped layout** (employees with their threads beneath), but the grouping is **computed from a query-by-assignee** instead of reading a "Chat — <employee>" container issue. Least UX churn; matches the existing mockups / sketch-findings. No container issue is created or read.
- **D-08:** An employee may have **multiple conversation anchors**. The roster shows an employee's open conversation anchors, with an explicit **"+ New conversation"** per employee to start a fresh anchor — the operator deliberately continues an existing thread or opens a new one (avoids accidentally reopening an old thread).

### New-conversation anchor shape (ANCHOR-01) — Claude's Discretion
- **D-09 (derived, grounded in principle):** A fresh conversation anchor (no existing task) is created **lazily on the operator's first message**, NOT eagerly on opening the chat or clicking "+ New conversation" — to honor the core principle that a conversation must never accumulate as empty garbage (design spec §4 / §5.3). The anchor is assigned to the employee being chatted with. The precise title/`goalId`/initial-status convention is left to research/planning, constrained by: never a perpetual-`in_progress` hold, never a "Chat — X" container, additive-schema-only.

### Claude's Discretion (explicit)
- Exact attribution wiring (which Paperclip HTTP endpoint, how the operator session token is reached from the same-origin UI), dedup/idempotency mechanism after the write moves UI-direct, and where the opt-in gate re-lands (D-02).
- New-conversation anchor metadata: title format, `goalId` selection, initial status target (D-09).
- The read-only stale/lingering-conversation detector mentioned in design §7 — include or defer is a planner call; if included it must be read-only (never mutate status), consistent with CONV-03.

</decisions>

<specifics>
## Specific Ideas

- "Asking about finished work should re-engage the assignee" — D-06: the operator treats the native reopen-on-comment as the desired loop, not a hazard to guard against.
- The roster must not visibly change from today for the operator (D-07) — re-sourcing from a query is an under-the-hood change; the employee-grouped mental model stays.
- The Phase 22 SPIKE-FINDINGS LOCKED recipes are inherited verbatim — Phase 23 implements against them; it does not re-derive the reopen/rewake mechanism.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design & requirements (the WHAT)
- `docs/superpowers/specs/2026-06-20-task-anchored-chat-design.md` — the milestone design spec. §3 (decided principles: agent-proposes/operator-confirms, anchoring = comments on a task, capability split), §4 (native engine behavior we ride on — `issue_reopened_via_comment`, non-assignee-comment reopen, self-comment suppression), §5.1 (anchoring & the two issue shapes; "discussing an existing work task → comments attach there directly" = D-04), §5.3 (no fake tasks / no empty garbage = D-09), §6 (capability & trust — no `issues.update`), §8.4–8.5 (fix comment attribution; rewrite the conversation brief).
- `.planning/REQUIREMENTS.md` — v1.9.0 requirements; Phase 23 owns ANCHOR-01/02/03, CONV-01/02/03, REPLY-01. CONV-02 is already marked Complete (proven by the Phase 22 spike).
- `.planning/ROADMAP.md` §"Phase Details (v1.9.0) → Phase 23" — the five locked success criteria and the Phase-23/24/25 scope split.

### The proven gate input (inherit, do NOT re-prove)
- `.planning/phases/22-reopen-delegation-spike-go-no-go-gate/22-03-SPIKE-FINDINGS.md` — the GO verdict + LOCKED recipes. SC1 = the comment-only native reopen recipe (CONV-02). SC2 = native self-comment suppression (REPLY-01 second half). "Operational findings → Attribution path (D-10)": only a `user`/board actor yields `actorType:"user"`; a worker/system-attributed comment is invalid for reopen — the basis for D-01. Capability boundary HELD (CONV-03).
- `.planning/phases/22-reopen-delegation-spike-go-no-go-gate/22-CONTEXT.md` — the spike's decision set (D-10 attribution fidelity, D-03 no-live-box, the capability invariant).

### Operator/safety context
- `CLAUDE.md` — same-origin trust model (plugin UI = trusted same-origin JS that CAN call Paperclip HTTP APIs directly with the operator's session — the basis for D-01/D-02); the create/comment/read-only capability footprint; additive-schema-only + disable/uninstall-preserves-data; bookended-by-snapshots rule (relevant to Phase 26, not built here).
- `Skill("sketch-findings-clarity-pack")` — validated chat design decisions / CSS patterns / visual direction; the roster (D-07) must stay consistent with these and the `sketches/` mockups.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/worker/handlers/chat-send.ts` — today's canonical operator-message write (`ctx.issues.createComment` → `public.issue_comments`, dedup on `message_uuid`, opt-in-guard wrapper). The write moves UI-direct (D-01); this handler's opt-in gate + dedup map are the pieces D-02 relocates.
- `src/worker/handlers/chat-open-for-issue.ts` + `src/worker/db/chat-topics-repo.ts` + `src/worker/handlers/issue-reader.ts` — the Phase 4.2-07 Reader→Chat continuation routing (`origin_issue_id` + assignee reverse-lookup) reused by the Reader entry point (D-05a).
- `src/worker/handlers/chat-roster.ts` — the current roster handler; re-source its grouping from a query-by-assignee (D-07) instead of container issues.
- `src/worker/chat/comment-classify.ts` — host-field-first classifier; documents the confirmed fact that the host stamps worker `createComment` calls `authorType:"system"` (the root reason for D-01).
- `src/worker/chat/true-task.ts` + `src/worker/handlers/chat-topics.ts` (`formatParentIssueTitle`, `chat.topic.create`) — today's container/topic creation; the "Chat — X" parent + perpetual-`in_progress` topic created here are what ANCHOR-03 stops sourcing. (Deleting the *create* site + watchdog is Phase 25; Phase 23 stops the new model from depending on them.)

### Established Patterns
- Chat message bodies live ONLY in `public.issue_comments` (the host); Clarity side tables map IDs, never store body. Preserve this when the write moves UI-direct.
- Comment classification is host-field-first (`authorType` / `presentation.kind`), with a marker allowlist + narrow body-pattern fallback. Operator messages must classify as `conversation` and carry `user` attribution (D-01).
- Additive-schema-only; opt-in-guard server enforcement under the same-origin trust model (the gate that D-02 relocates).

### Integration Points
- D-01/D-02 touch the UI↔host write seam (new UI-direct comment POST) and the worker's opt-in/dedup role — the largest structural change in the phase.
- `src/worker/chat/topic-watchdog.ts` (`NON_TERMINAL_CONVERSATION_STATUS`) is imported by `true-task.ts` and `chat-topics.ts`; CONV-01's native `done`-between-turns lifecycle removes the *need* for it, but its deletion is Phase 25. Phase 23 must not add new dependents on the perpetual-`in_progress` hold.

</code_context>

<deferred>
## Deferred Ideas

- **Visual "Conversation vs work" distinction + exclusion from active-tasks rails/counts** — CONV-04, Phase 25 (legibility). A `done`-between-turns conversation already neither looks like a stuck task nor churns; the explicit rendering/exclusion work is Phase 25's.
- **Delete the topic-watchdog + stop creating Chat-X containers + clean stranded artifacts** (BEAAA-6704 / BEAAA-7027) — CLEAN-01/CLEAN-02, Phase 25. Phase 23 stops the new model from *relying* on them but does not remove the machinery.
- **Propose → confirm → delegate** (structured task proposal, cross-agent child-issue delegation, in-thread status, manual convert-to-task backstop, brief rewrite to "propose for confirmation") — DELEG-01..05 / REPLY-02, Phase 24.
- **The conversation-brief rewrite** ("respond; propose a task for confirmation; take the conversation `done` when it concludes") — design §8.5 lands fully in Phase 24; Phase 23 needs only the lifecycle half (take the conversation `done` when concluded — CONV-01) reflected in the agent brief.

</deferred>

---

*Phase: 23-task-anchoring-native-conversation-lifecycle*
*Context gathered: 2026-06-22*
