# Situation Room — Truthful, Actionable Cockpit (design)

**Date:** 2026-06-01
**Status:** Design approved (brainstorming). Implementation not yet planned.
**Surface:** Situation Room (`/<companyPrefix>/situation-room`). Engine changes are shared and also improve the org-blocked backlog + Reader blocker panel; the new *reply-in-place* affordance ships in the Situation Room first.
**Live context:** Phase 9 closed; BEAAA runs v1.3.0. This is new post-v1.0.0 work.

---

## 1. Problem

The Situation Room's "Needs you" segment shows ~9 blocked items, **all** rendered as *"BEAAA-NN has no owner → Assign owner ▾"*, and a banner reading *"9 stuck · 9 unowned → assign owners."* The operator (Eric) recognized this is wrong: these items aren't unowned — each is **awaiting a named party** (him/the Founder, the CEO, a board member, or another agent), and the right move is to *do the thing that unblocks it*, not reassign it to an agent.

This defeats the product's core value: **transitively-resolved blocker chains ending in a single named human action** ("zero rabbit-holes"). That signature output never appears for an agent-run org — it degrades to a generic "assign someone" on every row.

### Root cause (confirmed in code)

Two failure modes, both collapse to the `__unowned__` terminal → *"assign an owner first"*:

1. **No structured blocker edge.** `buildEdges` ([`src/worker/handlers/org-blocked-backlog.ts`](../../../src/worker/handlers/org-blocked-backlog.ts), ~L202) only walks `blockedBy` relations. Many blocked issues (e.g. CFO `BEAAA-43`, CEO `BEAAA-1610`) carry no `blockedBy` edge — the reason is in the prose/title. Empty chain → start node has no `nodeMeta` → `__unowned__`.
2. **User-only ownership.** Where edges exist, `nodeMeta.ownerUserId` is built from `assigneeUserId` only (org-blocked-backlog.ts ~L215–219) — **never `assigneeAgentId`**. The org is agent-run, so every agent-owned blocker reads as ownerless → `__unowned__`.

`flattenBlockerChain` ([`src/shared/blocker-chain.ts`](../../../src/shared/blocker-chain.ts)) therefore returns the degenerate fallback, and `build-employees-rollup.ts` keys its UI branch on `ownerName === 'Unassigned'`, so the "Assign owner" path fires for the entire board. The computed `humanAction` field is, for these rows, only the fallback string `"Owner unknown — assign … first"` — the real named action does not exist yet and must be generated.

---

## 2. Locked decisions (from the design session)

1. **Named single action (B) + honesty (A) + performable.** The row states the one named action and lets the operator do it from the board. The **"Assign owner" control only appears when an item is genuinely about assignment** (a truly-unowned item, or a stuck idle agent with no next move).
2. **Action mechanic:** **reply-in-place** by default (type the answer on the row → posts to the agent's thread → unblocks), with **quick-decision chips** (Approve / Reject / pick-one) when the question is a clean yes/no. "Open ↗" remains the escape hatch for a deep dive.
3. **Flatten through to the human.** When a chain is waiting on another agent, keep walking until it ends in something a *person* can act on — never surface "go poke the Actuary." Honest tail: a chain ending on a *busy* agent leaves "Needs you"; a chain ending on a *stuck/idle* agent surfaces a nudge/redirect.
4. **The screen has one job:** one glance answers "how's the company?", the next answers "what needs me?". Section 3 redesigns the whole screen's information hierarchy, not just the rows.

---

## 3. Architecture — hybrid: deterministic honesty + Editor-Agent naming

**Why hybrid:** pure-deterministic can't name a prose-only blocker ("Founder ruling needed"); pure-AI is fragile and would lie/blank when cold. So the deterministic engine guarantees honesty and degrade-safety; the Editor-Agent supplies the human sentence on top. This mirrors the existing split (pure blocker-chain engine with an AI-boundary test guard; Editor-Agent already writes TL;DRs/bulletins).

### Section 1 — Engine (honest terminal taxonomy)

Replace the binary "owned vs unowned" with a richer, **deterministic** classification (no AI in `blocker-chain.ts`; its determinism test + AI-token grep guard stay intact):

| Terminal | Detected from | In "Needs you"? | Action |
|---|---|---|---|
| `AWAITING_HUMAN` | leaf owned by / referencing a **user** (you, CEO, board), or status `awaiting` | **Yes** | named action → reply-in-place |
| `AWAITING_AGENT_WORKING` | flattened through agent; heartbeat fresh & progressing | **No** → drops to "In motion" | none |
| `AWAITING_AGENT_STUCK` | flattened through agent; agent idle/stale, nothing queued | **Watch** (not "Needs you") | nudge / redirect (the only surviving assign-style action) |
| `SELF_RESOLVING` | has ETA | **No** | "clears by \<date\>" |
| `EXTERNAL` / `CYCLE` | as today | shown in Watch | chase-external / break-loop |
| `UNOWNED` (genuine) | truly no owner anywhere | **Yes** | this is where "Assign owner" legitimately lives |

Concrete changes:
- **`buildEdges` captures agent ownership + liveness:** `nodeMeta` gains `ownerAgentId` and the agent's heartbeat freshness, so the walk can continue *through* agents and classify the end as working vs stuck.
- **`flattenBlockerChain` terminal selection** extended to emit the new kinds deterministically.
- **`build-employees-rollup` re-triages "Needs you"** off the new terminal kind (not `ownerName === 'Unassigned'`), so working-agent waits and self-resolving items leave the list. The engine hands the UI a structured verdict per row.

### Section 2 — Editor-Agent named-action layer (+ guardrail)

For each row the engine classifies as `AWAITING_HUMAN` (or `AWAITING_AGENT_STUCK`), the Editor-Agent emits a structured **action card**:
`{ awaitedParty, namedAction (sentence), estMinutes, actionKind: answer|decide|nudge|none, decisionOptions?, targetIssueId, sourceIssueId, generatedAt }`.

Guardrails:
- The Editor-Agent **cannot invent urgency** — it only writes sentences for rows the engine already flagged. It surfaces the *question*; the operator makes the call. `decisionOptions` (yes/no chips) only when the issue text poses a binary.
- **Grounded + freshness-stamped** (same pattern as existing TL;DR/bulletin, which has a pass-2 verifier). Each card carries its source issue.
- **Stale → degrade**, not fabricate: if a card is stale, the row falls back to the deterministic line ("waiting on you — Founder ruling, BEAAA-649").
- Cached in the plugin namespace; refreshed on the Editor-Agent heartbeat + the existing 60s on-view recompute.

### Section 3 — Cockpit information architecture

A whole-screen redesign organized around "is it mine," loudest-on-top. (Mockup: `.superpowers/brainstorm/1041-1780319036/content/cockpit-redesign-v3.html`.)

- **The Pulse** (top, always visible): one editorial sentence + four vital signs (need you / in motion / stuck / clearing themselves). "How's the company?" answered before any list.
- **Needs you** (N): equal rows (no hero card), **ranked by what each unblocks** (not age). Each row = named-action sentence + who + *unblocks →* impact + time estimate + running total. Reply-in-place inline (input + Send), yes/no chips when binary, "Open ↗" escape. **No "Assign owner"** here.
- **In motion** (N): calm, lower-contrast reassurance — one line per working agent (name + what they're working on + age). Content text (the "what they're working on" gist) must be clearly legible — not the dimmest thing on the row.
- **Watch** (N): quietly stalled — stuck agents (the one place redirect/assign survives), external waits, dependency cycles, and the org-wide overflow backlog. Awareness, not act-now.

UX principles: one glanceable pulse; organize by ownership not by agent; rank by leverage; human-scale sentences + time estimates; calm scales with control; do-it-here.

---

## 4. The reply-that-unblocks — OPEN RISK (verify first)

The reply-in-place mechanic assumes that **answering the agent actually unblocks it and causes it to resume**. Unknown: whether posting a comment is sufficient, or whether we must also clear the blocker / transition the issue status, and whether/when the agent consumes it on its next heartbeat.

**This is the #1 thing to validate before building the reply mechanic** — a short spike against the live Paperclip model (comment-write path + agent resume semantics). The UX (reply-in-place) is decided; the unblock plumbing is the feasibility question. If a comment alone doesn't resume the agent, the "Send" action must also perform the right state transition.

---

## 5. Scope

**In scope:** engine taxonomy + agent-ownership capture; Editor-Agent action-card generation + caching + guardrail; Situation Room cockpit IA (Pulse + 3 tiers); reply-in-place + quick-decision chips; assign-button suppression; honest re-triage of "Needs you."

**Inherited for free (engine only):** org-blocked backlog and Reader blocker panel get the honest classification; their UIs are not otherwise redesigned in this round.

**Out of scope (this round):** reply-in-place on Reader/backlog; new schema beyond an additive action-card cache table (must stay additive-only per coexistence guarantee #3); any change to the same-origin trust model.

**Constraints carried:** additive-only Postgres (plugin namespace); NO_UUID_LEAK (UUIDs never rendered as text); degrade-safe rows; instance-agnostic (no company-prefix literals); Editor-Agent governance parity.

---

## 6. Verification targets (success = these are true)

1. On the live BEAAA board, "Needs you" shows **only** items that genuinely need a human; working-agent and self-resolving items are not listed there.
2. Zero "Assign owner" controls on items that aren't genuinely unowned/stuck.
3. Each "Needs you" row states a named action + who + impact + estimate; an agent-wait flattens to the human at the end.
4. Reply-in-place posts to the agent's thread **and the agent resumes** (the open risk, proven by the spike).
5. Editor-Agent down/stale → rows degrade to the deterministic line; the board never blanks or fabricates.
6. NO_UUID_LEAK, additive-schema, degrade-safe, instance-agnostic all hold.
