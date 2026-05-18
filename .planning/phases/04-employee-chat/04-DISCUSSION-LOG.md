# Phase 4: Employee Chat - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 04-employee-chat
**Mode:** Interactive `/gsd:discuss-phase 4`
**Areas discussed:** Agent reply path & scope, Topic issue model, Real-time & idempotency, Rich messages & attachments

---

## Area selection

Question: "Which areas do you want to discuss for Employee Chat?"

| Option | Selected |
|--------|----------|
| Agent reply path & scope | ✓ |
| Topic issue model | ✓ |
| Real-time & idempotency | ✓ |
| Rich messages & attachments | ✓ |

All four selected.

---

## Area 1 — Agent reply path & scope

### Q: How should the employee agent see Eric's message and reply?

| Option | Description | Selected |
|--------|-------------|----------|
| Native Paperclip heartbeat | Comment lands on the topic issue; the assigned agent picks it up on its own heartbeat. Zero delivery code. | |
| Plugin-driven wake + deliver | Phase 4 builds a wake/deliver path per employee (Phase 3 deliverAgentTask machinery). | |
| Persistence + realtime only | Phase 4 ships UI + persistence + realtime + coexistence; replies left to whatever Paperclip natively does. | |

**User's choice:** Deferred to investigation — "I need you to investigate how Paperclip actually handles something like this so we can make the decision. Look at the code base in GitHub so that we have a real answer and we're not guessing and designing something that won't work."

**Investigation result:** A general-purpose research agent investigated `paperclipai/paperclip@master` (commit `242a2c2`). **VERDICT: NATIVE** — posting a comment on an issue assigned to an agent natively enqueues an `issue_commented` heartbeat wakeup; the agent runs, receives the comment IDs inline, and replies as an ordinary `issue_comments` row. Proven by `server/src/__tests__/issue-update-comment-wakeup-routes.test.ts` + `heartbeat-comment-wake-batching.test.ts` + `server/src/services/heartbeat.ts`. → Area 1 reply path LOCKED as **Native Paperclip heartbeat** (D-01). The investigation also resolved Area 2 (no private-issue mechanism — D-07), Area 3 (`usePluginStream` is a plugin-defined SSE channel, not a native feed — D-08), and Area 4 (issue descriptions propagate to agents — D-14).

### Q: Who appears in the chat roster?

| Option | Description | Selected |
|--------|-------------|----------|
| All employees, Editor-Agent excluded | Roster = every Paperclip employee; Editor-Agent excluded; group threads omitted. | ✓ |
| All employees including Editor-Agent | Editor-Agent shown too. | |
| Configurable subset | Allowlist via instanceConfigSchema. | |

**User's choice:** All employees, Editor-Agent excluded → D-03.

### Q: While waiting for an agent's reply, what does the thread show?

| Option | Description | Selected |
|--------|-------------|----------|
| Working indicator + timeout notice | "{Employee} is working…" pending row + a quiet notice if no reply within N minutes. | ✓ |
| Working indicator only | Indicator with no timeout messaging. | |
| No pending indicator | Reply just appears via realtime. | |

**User's choice:** Working indicator + timeout notice → D-04.

---

## Area 2 — Topic issue model

### Q: How should topic issues be organized in classic Paperclip?

| Option | Description | Selected |
|--------|-------------|----------|
| Child issues under a per-employee parent | One parent issue per employee; each CHT-NN topic is a child issue. Grouped via the issue tree. | ✓ |
| Flat + tagged clarity:chat-topic | Standalone tagged issues; cluttered in classic lists. | |
| Flat, single issue per employee | One chat issue per employee; loses the CHT-NN topic mapping. | |

**User's choice:** Child issues under a per-employee parent → D-05.

### Q: How should a topic's lifecycle work (agents don't wake on terminal issues)?

| Option | Description | Selected |
|--------|-------------|----------|
| Stay open; archive = plugin metadata flag | Issue never set terminal; archiving is a flag. Chat always works. | |
| Closing a topic sets the issue done | Classic semantics; agent stops replying once closed. | ✓ |

**User's choice:** Closing a topic sets the issue done → D-06 (combined with the auto-reopen answer below).

---

## Area 3 — Real-time delivery & idempotency

### Q: What happens if Eric sends a message to an already-closed topic?

| Option | Description | Selected |
|--------|-------------|----------|
| Composer disabled on closed topics | Closed topic is read-only; explicit reopen affordance. | |
| Sending auto-reopens the topic | Issue flips back to in_progress + resume; agent wakes. | ✓ |
| Message persists, no reply | Comment saves but agent never wakes. | |

**User's choice:** Sending auto-reopens the topic → D-06.

### Q: If the realtime SSE stream drops, what's the fallback?

| Option | Description | Selected |
|--------|-------------|----------|
| Stream-primary, poll fallback | usePluginStream SSE primary; on error, fall back to usePoll refresh. | ✓ |
| Stream only | SSE only; "reconnecting" state, no poll fallback. | |
| Poll only | Skip the stream; CHAT-04 requirement deviation. | |

**User's choice:** Stream-primary, poll fallback → D-08.

### Q: Where should the client message_uuid idempotency key live?

| Option | Description | Selected |
|--------|-------------|----------|
| Plugin-namespace chat_messages table | Side table mapping message_uuid → comment_id. | |
| Embed in the comment body | Hidden marker in comment text; pollutes content. | |
| Comment origin/metadata field | Store in the comment-create metadata blob — IF the API supports it (unverified). | ✓ |

**User's choice:** Comment origin/metadata field → D-09. **Flagged:** the field is unverified — D-09 carries a verification gate + the chat_messages side table as the documented fallback.

### Q: On a failed optimistic send, what does the thread show?

| Option | Description | Selected |
|--------|-------------|----------|
| Failed message stays, with Retry | Optimistic bubble stays marked failed; Retry re-sends with the same message_uuid. | ✓ |
| Failed message removed + error toast | Bubble removed; Eric loses typed text. | |
| Failed message stays, no retry | Stays failed; Eric retypes. | |

**User's choice:** Failed message stays, with Retry → D-10.

---

## Area 4 — Rich messages & attachments

### Q: What's the v1 scope for attachment file handling and preview?

| Option | Description | Selected |
|--------|-------------|----------|
| Any type, ~10MB cap, generic chip | Work-product storage + filename/size/Open chip; no inline preview (Phase 5 owns previewers). | ✓ |
| Images inline, others as chip | Pulls Phase 5 previewer work forward. | |
| Any type, no size cap, generic chip | No upload guardrail. | |

**User's choice:** Any type, ~10MB cap, generic chip → D-12.

### Q: How real are Promote-to-task and Pin for v1?

| Option | Description | Selected |
|--------|-------------|----------|
| Promote real, Pin in chat metadata | Promote creates a real linked issue; Pin is a plugin-metadata flag. | ✓ |
| Both visual-only stubs | Affordances rendered, nothing wired. | |
| Promote real, Pin deferred | Splits the requirement. | |

**User's choice:** Promote real, Pin in chat metadata → D-13.

### Q: Where does the reasoning panel's content come from (Phase 4 can't change agent prompts)?

| Option | Description | Selected |
|--------|-------------|----------|
| Issue-description convention + body parse | Per-topic issue description asks the agent for a parseable reasoning block; plugin parses from the comment body. | ✓ |
| Best-effort parse, no agent instruction | Parse only if the agent happens to format it; panel often empty. | |
| Worker post-process extraction | A worker pass extracts reasoning into chat metadata; adds a compile-style path. | |

**User's choice:** Issue-description convention + body parse → D-14.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` → "Claude's Discretion": pending-reply timeout duration, poll-fallback cadence, reasoning-block delimiter format, `chat_topics` columns, plugin-namespace partitioning, `CHT-NN` numbering, global-search implementation, new-topic creation flow, composer slash-command / @-mention affordances.

## Deferred Ideas

Group threads (v2 / `CHAT-G-01`); full-fidelity attachment previewers (Phase 5 / `DIST-03`); inline image preview; @-mention routing to non-assignee agents; composer slash-commands; "private" topic issues (not achievable — constraint correction, D-07); Editor-Agent in the chat roster.

## Constraint correction surfaced

PROJECT.md / REQUIREMENTS describe "per-topic **private** issues." The investigation found no private-issue / `surfaceVisibility` mechanism in Paperclip. Topic issues are ordinary issues visible in classic UI (origin tag only). Recorded as D-07; the word "private" should be reworded at the next phase transition.
