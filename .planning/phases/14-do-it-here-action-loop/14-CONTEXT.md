# Phase 14: Do-It-Here Action Loop - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Let the operator **act in place** on a human-actionable blocker row: type a reply (or tap a quick-decision chip) that (a) posts to the awaited agent's thread as a **canonical `public.issue_comments` comment via the host `ctx.issues.createComment`** path (the exact path Phase 4 chat uses), then (b) **unblocks + resumes** the agent using the **Phase 10 proven recipe**. The reply-in-place + quick-decision primitive is **ONE shared component** rendered on all three blocker surfaces — Situation Room employee row, Reader-view live blocker panel, org-blocked backlog expander — never three copies. When a chain terminates on an **out-of-system human** (not reachable via an in-system agent thread), the row surfaces the named action + **"Open ↗"** instead of a Send affordance — no dead Send button. UUIDs are never rendered (NO_UUID_LEAK): the mutation carries the leaf/awaited UUID while the display stays human-readable.

**In scope:** ONE new worker action handler (`situation.replyAndResume`) that writes the operator's comment + applies the Phase-10 transition; the shared `<ReplyInPlace>` UI primitive (free-text input + Send + optional decision chips + Open↗ escape) wired via `usePluginAction`; mounting that primitive on the three surfaces, gated off the **engine verdict** (`actionAffordance` / `needsYou` / terminal kind); the chip→comment-text mapping from Phase 13 `decisionOptions`; the out-of-system predicate (off the verdict, not a string match); await-confirm UI posture; idempotency (no double-post on retry); the `decisionOptions` data already produced by Phase 13.

**Out of scope (later phases):**
- **The full Pulse header + Needs-you / In-motion / Watch tier IA + the redesigned card LAYOUT** — **Phase 15** (COCK-01/02). Phase 14 wires the *working* reply/decide/Open↗ primitive onto the **existing** Phase-8/9/13 surfaces; it does NOT redesign the screen, the Pulse, or the tier reorg. The design spec is explicit (§ Surface line): "the new reply-in-place affordance ships in the Situation Room **first**"; the IA round is later.
- **`issue.relations.write` capability / relation-blocked (`blockedByIssueIds`) edge clearing** — out of envelope per Phase 10 Shape C (cannot construct or clear within declared caps). Phase 14 scopes the loop to **status / awaiting blocks** and surfaces a relation-block as "resolve the blocker issue" (which is itself a Shape A/B reply on that blocker). Recommend NOT declaring `issue.relations.write` this phase (Phase 10 finding 2(b)).
- **No `public.*` schema change** — the comments table is host-owned; writes go via `ctx.issues.createComment`. Any plugin-namespace bookkeeping is **additive-only**.
- **No engine change.** `blocker-chain.ts` stays pure, read-only consumed; no new Terminal kind, no AI token (PRIM-03).
- **Reworking the Bulletin "Requires Your Decision" inbox** to share this mechanism — out of scope (REQUIREMENTS.md Out-of-Scope: separate surface, own loop).
</domain>

<decisions>
## Implementation Decisions

### Area A — Worker mutation handler + the Phase-10 recipe (DO-01 / SC1)

- **D-01: ONE new worker action handler `situation.replyAndResume`**, a structural mirror of `src/worker/handlers/situation-assign-owner.ts` (the proven core-issue-mutation template), registered in `worker.ts` next to `registerSituationAssignOwner` and wrapped in `wrapActionHandler` (opt-in-guard → `OPT_IN_REQUIRED` for opted-out callers, server-side, same-origin trust posture). **Rejected: two handlers (`situation.reply` + `situation.resume`).** Splitting the write from the transition opens a window where the comment lands but the resume never fires (orphaned half-action) and doubles the idempotency surface; one atomic handler is the honest unit. **Rejected: reuse `chat.send`** — chat.send is topic-issue + chat_topics-side-table-coupled (it `insertChatMessage`s an id-map row and runs `ensureTopicWakeable`); the blocker reply is not a chat topic and must apply the Shape-B durability flip chat.send deliberately does not.

- **D-02: Handler params carry the UUID for the mutation + the human label separately (NO_UUID_LEAK), mirroring assignOwner's `leafIssueUuid` vs `leafIssueId` split (the v1.3.0 R3 fix).** Params:
  - `companyId` (req) — `reqStr`.
  - `leafIssueUuid` (req) — the **mutation/dispatch id**; the UUID passed to `ctx.issues.createComment(leafIssueUuid, …)` AND `ctx.issues.update(leafIssueUuid, …)`. Dispatched by the shared primitive from `verdict.targetIssueUuid` / `actionCard.sourceIssueUuid`. Never rendered.
  - `leafIssueId` (req) — the **human display key** (BEAAA-NN); log + echoed-in-result only, never the mutation id.
  - `body` (req) — the operator's reply text (free-text OR the canned chip text, D-06).
  - `userId` (req) — enforced by opt-in-guard; carried for the resume actor attribution + audit.
  - `messageUuid` (req) — the **idempotency key** (D-09), client-generated like chat.send's `messageUuid`.
  - `terminalKind` (optional) — the engine terminal kind, so the handler can choose comment-only (Shape A) vs comment+flip (Shape B); see D-04. (Lean: derive from a `needsDurabilityFlip` boolean the UI passes, computed off the verdict — keeps the handler dumb.)

- **D-03 — THE LOCKED PHASE-10 RECIPE (quoted verbatim from `10-03-SPIKE-FINDINGS.md`, the make-or-break contract — FOUND, complete, two clean live PASSes on BEAAA 2026-06-02):**
  > **DO-03 — ANSWERED. "YES — for both the awaiting-answer (Shape A) and `status='blocked'` (Shape B) cases, a plain comment alone triggers the agent to wake, run, and respond. No special transition is required to *trigger* the resume. For a *durable* status change on Shape B, pair the comment with a `status:'in_progress'` flip (proven settable — A1)."**

  > **Shape A — awaiting-answer → ✅ PASS. Recipe (LOCKED): post the answer as a comment. Native wake; no transition.**

  > **Shape B — `status='blocked'` → ✅ PASS (the dominant real shape — 15 live items). Recipe (LOCKED): comment alone wakes the blocked agent … Durability nuance (Phase 14 MUST handle): after the resume run, the issue re-settled to `blocked`. So: To trigger a resume run → comment alone is sufficient. For a durable unblock (issue stays workable) → pair the comment with `ctx.issues.update(id, {status:'in_progress'})`. … This is a deliberate CTT-07 exception Phase 14 owns explicitly (operator-attributed, audited) — not silent disposition-recovery."**

  > **Integration: new `situation.unblock` worker action mirroring `situation-assign-owner.ts` (UUID-based `ctx.issues.update` + `ctx.issues.createComment`).**

  **Therefore the `situation.replyAndResume` handler does, in order:**
  1. **Dedup** on `messageUuid` (D-09) — if already posted, return the original `commentId`, do NOT re-post or re-flip (idempotent replay, exactly chat.send's step 1 pattern).
  2. **Post the comment** — `ctx.issues.createComment(leafIssueUuid, body, companyId)` (the canonical `public.issue_comments` write; the same call chat.send.ts:78 and bulletin/publish.ts:116 make). This **alone triggers the native resume** for both Shape A and Shape B. On failure → `{ error: 'REPLY_FAILED' }`, no flip, no side-table row (no orphan).
  3. **Durability flip (Shape B only)** — if the row is a `status='blocked'` terminal (`needsDurabilityFlip`), `ctx.issues.update(leafIssueUuid, { status: 'in_progress' }, companyId, actor)` with `actor = { actorUserId: userId }` (operator-attributed audit, same as assignOwner). This is the **deliberate CTT-07 exception** the spike says Phase 14 OWNS — it is operator-initiated and audited, NOT the silent disposition-recovery `topic-watchdog.ts` was forbidden from doing. Ordering: **comment first, then flip** (the spike tested comment-only sufficient to trigger; the flip is the durability add-on layered after). A flip failure is **non-fatal** (the comment already triggered the resume) → still return `{ ok, commentId }` but log + flag `durable:false`.
  4. **(Optional, fire-and-forget) `requestWakeup`** — like chat.send step 5, a best-effort `ctx.issues.requestWakeup(leafIssueUuid, companyId, {reason, idempotencyKey: messageUuid})` to push a heartbeat; NEVER awaited, NEVER fails the action. The spike says native wake (the comment) is sufficient, so this is harmless belt-and-suspenders, consistent with chat.send.
  5. **Echo** `{ ok: true, commentId, leafIssueId, durable }` — the human key for the UI toast; the UUID never surfaced.

- **D-04: Shape selection is verdict-driven, not guessed.** Comment-only (Shape A) vs comment+flip (Shape B) is chosen from the engine terminal/status the verdict already carries. Lean: the UI passes a `needsDurabilityFlip: boolean` derived from the verdict (`true` when the leaf is a `status='blocked'` terminal; `false` for an `AWAITING_HUMAN` awaiting-answer leaf). The handler does NOT re-fetch the issue to decide — it trusts the verdict (degrade-safe: when unknown, default to comment-only, the spike-proven-sufficient trigger). **Rejected: always flip.** Flipping an awaiting-answer issue that was never `blocked` is an unwarranted status mutation; the spike only authorizes the flip as the Shape-B durability add-on. **Rejected: never flip.** Shape B re-settles to `blocked` after the run (spike "Durability nuance"); without the flip the operator's reply produces a transient run that re-blocks — dishonest "I resumed it."

### Area B — Quick-decision chips (DO-02 / SC2)

- **D-05: Chips appear ONLY when `actionCard.decisionOptions` is non-null** (the Phase 13 conservative-binary signal). Phase 13 D-08 already emits `decisionOptions` (e.g. `["Approve","Reject"]`) **only** when the source issue poses an explicit binary, `null` otherwise. Phase 14 renders chips iff that field is a non-empty array; otherwise free-text reply only. The chip set is **rendered verbatim** from `decisionOptions` (Approve/Reject or pick-one) — Phase 14 invents no options. This keeps the "never fabricate a false binary" guarantee at the data layer (Phase 13), not the UI. **Rejected: UI heuristic binary detection** (e.g. scan the title for "approve") — duplicates Phase 13's grounded detection in the dumb view layer and would fabricate chips Phase 13 deliberately withheld.

- **D-06: Each chip = a canned reply text + the SAME `situation.replyAndResume` path.** A chip click dispatches `situation.replyAndResume` with `body = <the chip's canned operator answer>` (e.g. "Approve" → `body: "Approved."`; "Reject" → `body: "Rejected."`; pick-one → `body: "<the chosen option>."`). The exact canned-text mapping (chip label → posted sentence) is **planner discretion**, but it MUST be a plain operator sentence the awaited agent can read as the answer — NOT a structured command. The chip path runs the identical comment+flip recipe (D-03); a chip is just a one-tap free-text reply. **Rejected: a separate `situation.decide` handler** — the unblock plumbing is identical; a chip differs only in where `body` comes from. One handler, one idempotency surface.

### Area C — The shared primitive (DO-01 / DO-04 / SC3)

- **D-07: ONE shared component `<ReplyInPlace>` at `src/ui/surfaces/_shared/reply-in-place.tsx`** (new directory `src/ui/surfaces/_shared/` — there is none today; `_shared` keeps it off any single surface's namespace, the convention the three surfaces can all import without a cross-surface dependency). It owns: the free-text input + Send button, the optional decision chips (D-05/D-06), the Open↗ escape (D-08), the `usePluginAction('situation.replyAndResume')` dispatch, the await-confirm posture (D-09), and the toast on success/failure. The three surfaces import it and pass props — **no copies** (SC3). **Rejected: `src/ui/components/`** — that dir holds shadcn-style generic primitives; this is a surface-composite that knows the verdict shape, so it lives under `surfaces/_shared`. **Rejected: put it in `situation-room/` and import upward from reader/backlog** — couples Reader + backlog to the SR namespace (the exact "three copies vs shared" smell SC3 forbids the spirit of).

- **D-08: `<ReplyInPlace>` props — the verdict + the action card + dispatch context, display-vs-dispatch split enforced:**
  ```
  leafIssueId: string | null        // HUMAN key — rendered in toast/labels, never the mutation id
  leafIssueUuid: string | null      // UUID — dispatch arg ONLY, never rendered (NO_UUID_LEAK)
  awaitedPartyLabel: string         // scrubbed display string (who the reply goes to)
  reachable: boolean                // the out-of-system predicate (D-10) — true → Send/chips; false → Open↗ only
  needsDurabilityFlip: boolean      // D-04 — drives comment-only vs comment+flip
  decisionOptions: string[] | null  // D-05 — non-null → render chips; null → free-text only
  companyId, userId: string
  companyPrefix: string             // for the Open↗ host route (/<prefix>/issues/<leafIssueId>)
  navigate, onActed                 // host nav + the parent's force-refetch-the-snapshot callback
  ```
  The component dispatches with `leafIssueUuid` (mutation id) + `leafIssueId` (echo) + a fresh client `messageUuid`, mirroring `owner-picker-popover.tsx`'s `dispatchAssign` (which already dispatches both keys with the `?? leafIssueId` fallback for UUID-only mounts).

### Area D — Out-of-system escape hatch (DO-04 / SC4)

- **D-09 (renumber → D-10): The reachable-vs-out-of-system predicate is computed off the VERDICT, never a string match.** A row is **reachable via comment** (→ show Send/chips) iff the chain terminates on an **in-system agent thread the comment can wake** — i.e. terminal kind ∈ `{ AWAITING_AGENT_STUCK }` **with a `targetAgentUuid`**, OR an `AWAITING_HUMAN` leaf that is an **in-system user issue** (the operator answering his own awaited-decision issue — the dominant BEAAA shape, e.g. "Founder ruling, BEAAA-649", which IS reachable because posting the answer-comment on that issue triggers the assigned agent's resume per Shape A/B). A row is **out-of-system** (→ named action + "Open ↗", **no Send**) for terminal kinds where no in-system thread can consume a comment: **`EXTERNAL`** (a third party with no Paperclip account), **`CYCLE`** (no single party to answer — break-the-loop is a navigate), **`UNCLASSIFIED`** (honest "can't determine — open to investigate"; the Phase 11 11-07 no-dead-button rule already renders Open↗ here), and **`UNOWNED`** (assignment, not reply, is the answer — its affordance is `'assign'`, handled by the existing `OwnerPickerPopover`, NOT this primitive). The predicate is a **pure helper** keyed on `terminal.kind` + presence of `targetAgentUuid` / the user-vs-agent leaf signal — exactly the `classifyVerdict`/`actionAffordance` discipline (Phase 11 D-13/D-14), NOT `ownerName === 'Unassigned'`. Concretely: `<ReplyInPlace reachable={…}>`; when `reachable === false` the component renders ONLY the named-action line + an Open↗ button (no input, no chips). **Rejected: parse `awaitedPartyLabel` for "external"** — string-match on a scrubbed display label is the exact anti-pattern Phase 11/12 killed.

- **D-11: "Open ↗" reuses the existing Phase-12 navigate-to-issue pattern.** It navigates to `/<companyPrefix>/issues/<leafIssueId>` — the **human identifier**, never the UUID (project memory `paperclip-issue-url-pattern`: a UUID 404s; the URL needs `/<prefix>/issues/<identifier>`). This is byte-for-byte the `openIssue` callback already in `employee-row.tsx` (L203) and `live-blocker-panel.tsx` (L163) and `blocked-backlog-expander.tsx` (L58). For a multi-hop chain where the surface has no leaf human key (the Reader CR-01 case — `live-blocker-panel.tsx` L261 renders NO button when `pathIds.length > 1`), `<ReplyInPlace>` likewise renders no Open↗ rather than a no-op/404, honoring the no-dead-button rule.

### Area E — Optimistic vs confirmed UI (SC1 honesty)

- **D-12: Await-confirm, never optimistic.** After Send/chip, the component shows a **pending state** (disabled input, "Sending…") and waits for the `situation.replyAndResume` result. On `{ ok }` → success toast ("Replied to <party> · <leafIssueId>") + call `onActed()` (the parent's force-refetch so the row re-resolves/leaves Needs-you live, mirroring `onAssignSuccess`). On `{ error }` → an **honest error toast** ("Couldn't reach <party> — your reply was not sent" / "…sent but couldn't confirm resume") and the input stays populated for retry; the row is NOT pretended-resumed. **Rejected: optimistic update.** The core value is HONESTY; an optimistic "resumed!" that silently failed the comment write or the flip is precisely the dishonesty this milestone exists to kill. The mutation is live against BEAAA — a false-positive is worse than a 1.5s wait.

### Area F — Identity, governance, idempotency (SC1 / SC5 / constraints)

- **D-13: The comment posts with the SAME identity Phase 4 chat uses — the plugin worker (no operator actor on the comment).** Verified against the SDK: `PluginIssuesClient.createComment(issueId, body, companyId, options?)` accepts ONLY `{ authorAgentId? }` — there is **no operator-userId actor parameter for comments** (`node_modules/@paperclipai/plugin-sdk/dist/types.d.ts:1124`). So the comment carries the worker/plugin identity exactly as `chat.send` and `bulletin/publish` already post (Phase 4's proven, coexistence-tested path — 907 comments survived disable). The **operator attribution lives on the `issues.update` durability flip** (D-03 step 3), which DOES accept `PluginIssueMutationActor` (4th arg `{ actorUserId: userId }`, exactly assignOwner) — so the audited *state mutation* is operator-attributed. **Rejected: forging `authorAgentId` to the awaited agent** — that would impersonate the agent answering itself; the operator's reply must read as an external answer the agent consumes, which is what the default worker-authored comment is (and is the chat-proven shape).

- **D-14: Governance parity — no privileged bypass.** The agent **resumes on its own heartbeat** per the spike recipe (the comment triggers the native wake; the optional `requestWakeup` only nudges a heartbeat). The plugin does NOT spawn, force-run, or bypass the agent's budget caps / pause-terminate / audit. The only state mutation is the operator-attributed status flip (Shape B), already a declared capability (`issues.update`) and exercised live (assignOwner). Capabilities needed are **already declared** in `src/manifest.ts`: `issue.comments.create` (L699) and `issues.update` (L720). **No new capability** (and explicitly NOT `issue.relations.write`, per D-domain out-of-scope).

- **D-15: Idempotency — client `messageUuid` dedup, exactly chat.send.** The shared primitive generates one `messageUuid` per Send/chip click; a retry of the *same* click reuses it. The handler's step 1 (D-03) dedups on it. **Storage of the dedup map is planner discretion:** lean is a tiny additive plugin-namespace table (mirroring `chat_messages`' `message_uuid → comment_id` map, `migrations/0016_*.sql`, additive-only) so a retry after a lost ACK returns the original `commentId` without re-posting/re-flipping. **Rejected: rely on the host comment de-dup** — there is no proven host-side idempotency for `createComment`; chat.send carries its own map for exactly this reason (CHAT-06). A double-post on a live board is a visible defect, so the dedup map is the honest minimum. (If the planner finds the flip is naturally idempotent — flipping `in_progress` twice is a no-op — and a single duplicate comment is tolerable, a no-table client-debounce is the cheaper fallback; lean table.)

### Claude's Discretion
- The exact canned chip-text mapping (D-06: "Approve" → posted sentence). Must be a plain operator answer sentence.
- Whether to ship the dedup map as an additive table (`0016_*.sql`, lean) vs a client debounce (D-15).
- The exact `reachable` predicate helper location — pure helper in `src/shared/` (preferred, unit-testable, instance-agnostic) vs inline in the primitive. Lean: a pure exported `isReplyReachable(verdict)` in `src/shared/` next to the `classifyVerdict` family.
- Whether `needsDurabilityFlip` is UI-derived-from-verdict (lean) vs handler-re-derived; and the default when the kind is unknown (lean: comment-only, the spike-proven trigger).
- Pending-state copy + error-toast wording (D-12) and the toast durations (reuse the 6000ms host-call-pending pattern from employee-row).
- Test depth for the handler (idempotent replay, comment-fail-no-flip, flip-fail-still-ok, NO_UUID_LEAK render-scan on the primitive — the Phase 11 11-07 render-scan guard MUST extend to cover `reply-in-place.tsx`).

## Decision → Requirement / Success-Criteria map
- **DO-01 / SC1** → D-01, D-02, D-03, D-07, D-08, D-12, D-13 (reply posts as a canonical comment + unblocks+resumes via the Phase-10 recipe; await-confirm honesty).
- **DO-02 / SC2** → D-05, D-06 (chips only on a clean binary from Phase 13 `decisionOptions`; same unblock+resume path).
- **DO-04 / SC3** → D-07, D-08 (ONE shared `<ReplyInPlace>` mounted on SR + Reader panel + org-blocked backlog).
- **DO-05 / SC4** → D-10, D-11 (verdict-driven reachable predicate; out-of-system → named action + Open↗, no dead Send).
- **SC5 (NO_UUID_LEAK)** → D-02, D-08, D-11, D-13, D-15 (mutation carries `leafIssueUuid`; display uses `leafIssueId`/`awaitedPartyLabel`; render-scan guard extended).
</decisions>

<specifics>
## Specific Ideas

- **The Phase-10 recipe (the make-or-break dependency) is FOUND, COMPLETE, and PROVEN LIVE** — `10-03-SPIKE-FINDINGS.md`, finalized 2026-06-02 from a live three-shape BEAAA run with sacrificial agent `0f20fe53-…`, three-signal PASS rule (behavioral + consumption + state). Verbatim locked steps quoted in D-03. There is **no missing-contract planning risk** — the gate is green.

- **Design-spec locked decision 2 (the literal UX target, verbatim):**
  > "Action mechanic: **reply-in-place** by default (type the answer on the row → posts to the agent's thread → unblocks), with **quick-decision chips** (Approve / Reject / pick-one) when the question is a clean yes/no. 'Open ↗' remains the escape hatch for a deep dive."

- **Design-spec § Needs-you row spec (verbatim):**
  > "Reply-in-place inline (input + Send), yes/no chips when binary, 'Open ↗' escape. **No 'Assign owner'** here." — i.e. the reply primitive and the assign popover are mutually exclusive per row, gated off the same verdict affordance (`reply`/`none` → ReplyInPlace; `assign` → OwnerPickerPopover).

- **Design-spec § Surface (verbatim — the in-vs-out-of-Phase-15 boundary):**
  > "Engine changes are shared and also improve the org-blocked backlog + Reader blocker panel; the new *reply-in-place* affordance ships in the Situation Room **first**." (Phase 14 ships the primitive on all three per DO-04/SC3; the full cockpit IA redesign is Phase 15.)

- **Design-spec §4 (the open risk this phase is built on — NOW CLOSED by the spike):**
  > "The reply-in-place mechanic assumes that **answering the agent actually unblocks it and causes it to resume**. … This is the #1 thing to validate before building the reply mechanic. … If a comment alone doesn't resume the agent, the 'Send' action must also perform the right state transition." — Resolved: comment alone triggers; Shape B adds the `{status:'in_progress'}` flip for durability (D-03).

- **The assignOwner `leafIssueUuid` lesson (project memory `beaaa-deploy-mechanics` / 09-VERIFICATION R3):** v1.3.0 passed the HUMAN key (BEAAA-43) to `ctx.issues.update`; the host needs the UUID → ASSIGN_FAILED. Fixed in 09-04 by carrying `leafIssueUuid` separately, dispatched by `owner-picker-popover.tsx`. **Phase 14's `situation.replyAndResume` MUST carry the UUID the same way** (D-02) for BOTH `createComment` and `update` — both host calls are UUID-keyed (the comment-write `topicIssueId` in chat.send is likewise a UUID).

- **The CTT-07 nuance (why the flip is allowed here but was forbidden in topic-watchdog):** `topic-watchdog.ts` was BANNED from calling `ctx.issues.update` to un-terminal a topic (rc.8 hotfix — it was silent, ran on every poll, and the host's disposition-recovery is the rightful owner). Phase 14's flip is the OPPOSITE case the spike explicitly authorizes: **operator-initiated, one-shot, audited** (actor = the operator userId), not a silent per-poll sweep. The spike calls it "a deliberate CTT-07 exception Phase 14 owns explicitly."

- **The comment identity reality (verified in the SDK, not assumed):** `createComment` takes no operator-actor arg (only `{authorAgentId?}`), so the reply posts as the worker — the exact Phase-4-chat identity, coexistence-proven (907 comments survived disable). Operator attribution rides on the `issues.update` flip (D-13).
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition + requirements
- `.planning/ROADMAP.md` — **Phase 14** goal + 5 success criteria (the acceptance spine); the v1.4.0 framing (deterministic engine + Editor-Agent; the two halves stay separate).
- `.planning/REQUIREMENTS.md` — **DO-01 / DO-02 / DO-04 / DO-05** (the four requirements this phase satisfies; DO-03 already Complete via Phase 10) + the Out-of-Scope table (no public.* mutation; bulletin decision inbox excluded) + `R3-SELF-01` (the minor "take it myself / one-assignee" follow-on that may fold in while reworking the action layer).

### THE make-or-break dependency — the proven unblock-resume recipe (READ FIRST)
- `.planning/phases/10-unblock-resume-spike/10-03-SPIKE-FINDINGS.md` — **the LOCKED contract**: DO-03 ANSWERED; Shape A (comment-only) + Shape B (comment + `{status:'in_progress'}` durability flip, the dominant 15-item real shape) PASS; Shape C (relation-blocked) out of envelope; the CTT-07 exception; capability boundary HELD; residue-cleanup steps. **Implement EXACTLY against this.**
- `.planning/phases/10-unblock-resume-spike/PHASE-14-PREP.md` — the integration map: "new `situation.unblock` worker action mirroring `situation-assign-owner.ts`"; the reusable-building-blocks table (status flip = topic-watchdog analog; comment = `createComment` at publish.ts:116; wake = agent-task-delivery.ts:405-422; status transition = editor.ts:663); the recipe→implementation mapping; the deploy note.

### The design ground truth
- `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` — **§2 locked decision 2** (reply-in-place + chips + Open↗ escape — THE UX spec for this phase), **§3 Section 3 "Needs you (N)" row spec** ("Reply-in-place inline (input + Send), yes/no chips when binary, 'Open ↗' escape. No 'Assign owner' here."), **§4** (the reply-that-unblocks open risk — closed by the spike), **§5 scope** (reply-in-place ships SR-first; additive-only; same-origin trust model unchanged), **§6 verification target 4** (reply posts to the agent's thread AND the agent resumes).

### Upstream phase CONTEXTs this phase builds on
- `.planning/phases/11-honest-blocker-taxonomy-engine/11-CONTEXT.md` — D-13 (rich verdict: `needsYou`/`tier`/`actionAffordance`), D-14 (engine owns kind→affordance table — the reachable predicate keys off THIS, not strings), D-15 (split-identity NO_UUID_LEAK: `awaitedPartyLabel` display vs `targetAgentUuid`/`targetIssueUuid` dispatch).
- `.planning/phases/13-editor-agent-named-action/13-CONTEXT.md` — D-08 (`decisionOptions` conservative binary — the chip trigger), the `ActionCard` shape (`actionKind` `'decide'`/`'answer'`, `decisionOptions`, `sourceIssueUuid` dispatch-only), D-13 (the card already rendered on `employee-row.tsx`; Phase 14 adds the ACTION onto it).

### The engine verdict + type surface (read-only consume; NO edit)
- `src/shared/types.ts` — `Terminal` union (8 kinds, §43-51), `BlockerChainResult` (`needsYou`/`tier`/`actionAffordance`/`awaitedPartyLabel`/`targetAgentUuid`/`targetIssueUuid`, §53-82), `ActionCard` (§107-125, the chip/decisionOptions source).
- `src/shared/blocker-chain.ts` — `classifyVerdict()` / `flattenBlockerChain` (pure, AI-free); the reachable predicate (D-10) lives alongside this family, NOT inside the pure engine if it would add a token (it won't — it's structural).

### The proven mutation + comment-write source Phase 14 REUSES (real paths read)
- `src/worker/handlers/situation-assign-owner.ts` — **THE handler template** (`wrapActionHandler`, `reqStr`, `leafIssueUuid` vs `leafIssueId` split, `actor = { actorUserId: userId }`, single `ctx.issues.update` call, structured `{error}` returns, human-key echo). `situation.replyAndResume` mirrors this.
- `src/worker/handlers/chat-send.ts` — **THE comment-write path** (`ctx.issues.createComment(issueId, body, companyId)` at L78; `messageUuid` dedup at L70-73; the fire-and-forget `requestWakeup` at L129-141; the SEND_FAILED-no-orphan discipline). The canonical Phase-4 comment identity.
- `src/worker/chat/topic-watchdog.ts` — the CTT-07 flip-off-terminal analog (`TERMINAL_OR_BLOCKED_STATUSES`, `NON_TERMINAL_CONVERSATION_STATUS = 'in_progress'`) and the cautionary tale (why a SILENT per-poll flip was banned vs the operator-attributed one-shot flip Phase 14 is authorized to do).
- `src/worker/bulletin/publish.ts` — a second live `ctx.issues.createComment` call site (L116) confirming the path + the `Partial<Pick<…,'createComment'>>` ctx-typing pattern.
- `node_modules/@paperclipai/plugin-sdk/dist/types.d.ts` (L1124 `createComment`, L1118 `requestWakeups` with `PluginIssueMutationActor`) — the SDK signatures: comments take no operator actor (D-13); update/wakeup do.

### The three surfaces that mount the ONE shared primitive (SC3)
- `src/ui/surfaces/situation-room/employee-row.tsx` — the needs_you cluster (L315-407); today renders the action-card sentence + Assign/Wake/Open buttons; Phase 14 adds `<ReplyInPlace>` for the `reply`/reachable case.
- `src/ui/surfaces/situation-room/needs-you-banner.tsx` — the always-visible banner (Phase 8) — verify whether the top action also offers reply (planner check).
- `src/ui/surfaces/reader/live-blocker-panel.tsx` — the Reader right-rail; today's `primaryActionLabel` maps `reply`→`Reply: <party>` (L57) but only navigates to chat; Phase 14 replaces that with the real `<ReplyInPlace>` dispatch. The CR-01 multi-hop no-button discipline (L261) carries over.
- `src/ui/surfaces/situation-room/blocked-backlog-expander.tsx` — the org-blocked backlog rows (L82-119); today each orphan row has Assign (gated on `actionAffordance==='assign'`) + Open↗; Phase 14 adds `<ReplyInPlace>` for the `reply`/reachable orphan rows.
- `src/ui/surfaces/situation-room/owner-picker-popover.tsx` — the dispatch template (`dispatchAssign` dispatches `leafIssueUuid ?? leafIssueId` + a structured-result guard); `<ReplyInPlace>`'s dispatch mirrors it.

### Worker registration + capabilities
- `src/worker.ts` — handler registration block (L200/L375 `registerSituationAssignOwner`); `situation.replyAndResume` registers here.
- `src/manifest.ts` — capabilities `issue.comments.create` (L699) + `issues.update` (L720) ALREADY declared; the `196`/`358` notes on `createComment` authorType. No new capability needed.

### Cross-cutting constraints + history
- `CLAUDE.md` — governance parity (Editor-Agent/agents = regular org-chart hires; no privileged bypass), NO_UUID_LEAK, additive-schema (plugin namespace `plugin_clarity_pack_cdd6bda4bd`; `public.issue_comments` is host-owned → writes via `ctx.issues.createComment`, NOT a migration), instance-agnostic (no company-prefix literals), same-origin trust model.
- `MEMORY.md` → `paperclip-issue-url-pattern.md` (Open↗ uses `/<prefix>/issues/<identifier>`, NOT the UUID), `beaaa-deploy-mechanics.md` (the R3 UUID-vs-human-key bug D-02 prevents; the BEAAA deploy Path A/B + version-bump-BOTH-files rule for the live ship), `chat-topics-issue-id-is-text.md` (the `i.id::text` cast if any plugin-namespace join is added for the dedup map).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (real files read, with paths)
- **`situation-assign-owner.ts`** — the exact core-issue-mutation handler template: `wrapActionHandler(ctx,'situation.assignOwner',…)`, `reqStr`, `leafIssueUuid`(mutation)/`leafIssueId`(echo) split, `actor:{actorUserId:userId}` on `ctx.issues.update`, structured `{error:'…'}` returns, single update call-site, zero `ctx.db`. `situation.replyAndResume` is a 1:1 structural mirror + a `createComment` call before the (conditional) update.
- **`chat-send.ts`** — the canonical `ctx.issues.createComment(issueId, body, companyId)` write (L78), the `messageUuid` idempotency dedup (L69-73, the chat_messages map), the SEND_FAILED-no-orphan rule, the fire-and-forget non-awaited `requestWakeup` (L129-141). Phase 14's handler reuses all four patterns.
- **`owner-picker-popover.tsx`** — the UI dispatch template: `usePluginAction('situation.assignOwner')`, `dispatchAssign` sends `leafIssueUuid ?? leafIssueId` + the structured-result `'ok' in result` guard + outside-click/Esc close. `<ReplyInPlace>` mirrors the dispatch + result-guard shape.
- **`employee-row.tsx` / `live-blocker-panel.tsx` / `blocked-backlog-expander.tsx`** — the three mount points; each already has an `openIssue(identifier)` → `/<prefix>/issues/<identifier>` callback (the Open↗ reuse, D-11) and reads the engine verdict (`actionAffordance`/`needsYou`). The reply primitive slots into each `reply`/reachable branch.
- **`live-blocker-panel.tsx` `primaryActionLabel`/`blockerLine` + the CR-01 multi-hop no-button logic (L261)** — the per-affordance render discipline + the honest-degrade-when-no-leaf-key rule `<ReplyInPlace>` inherits.
- **`topic-watchdog.ts`** — the status-flip analog + the CTT-07 cautionary boundary (silent per-poll flip = banned; operator one-shot flip = the authorized Phase-14 path).

### Established Patterns
- **Core-issue mutation discipline (CLAUDE.md hard rule):** mutate via the typed `ctx.issues.*` client with actor attribution; UUID first-arg; NEVER `ctx.db` for `public.issues`/`public.issue_comments`. assignOwner is the reference.
- **Split-identity / NO_UUID_LEAK:** UUID carried as dispatch arg, human key/scrubbed label rendered — `leafIssueUuid` vs `leafIssueId`; `targetIssueUuid`/`targetAgentUuid` vs `awaitedPartyLabel`. The render-scan UUID-pattern guard (Phase 11 11-07) extends to the new primitive.
- **Idempotent action via client `messageUuid`:** dedup-on-replay so a lost-ACK retry returns the original result without a double effect (chat.send CHAT-06).
- **Fire-and-forget non-fatal wake:** `requestWakeup` is unreliable on `paperclipai@2026.525.0`; never awaited, never fails the action; native wake (the comment) is the real trigger.
- **Verdict-gated affordances, never string-match:** every surface gates its single control off `actionAffordance`/`needsYou`/terminal kind (Phase 11/12) — the reachable predicate (D-10) follows this.
- **Await-confirm honesty:** the live-mutation surfaces show pending + an honest error on failure (employee-row's "host call pending — verify" toasts); no optimistic false-success.

### Integration Points
- **Consumes** the Phase 11 verdict + the Phase 13 `actionCard.decisionOptions` from `build-employees-rollup.ts` / `situation.snapshot` / `flatten-blocker-chain` (read-only).
- **New** `situation.replyAndResume` handler (`src/worker/handlers/situation-reply-and-resume.ts`) + its `worker.ts` registration + (lean) an additive `migrations/0016_*.sql` dedup map + `<ReplyInPlace>` (`src/ui/surfaces/_shared/reply-in-place.tsx`) + a pure `isReplyReachable(verdict)` helper (`src/shared/`).
- **Wires** `<ReplyInPlace>` into the three surfaces' `reply`/reachable branches; **reuses** each surface's existing `openIssue` for Open↗.
- **Touches NO** `blocker-chain.ts` logic, NO `public.*` schema, NO new capability (`issue.comments.create` + `issues.update` already declared).
</code_context>

<deferred>
## Deferred Ideas

- **Full Pulse header + Needs-you / In-motion / Watch tier IA + rich card LAYOUT** — **Phase 15** (COCK-01/02). Phase 14 wires the working primitive onto the existing surfaces; the screen redesign + the "unblocks → impact / running total" leverage prose land in Phase 15.
- **`issue.relations.write` capability + relation-blocked (`blockedByIssueIds`) edge clearing** — out of envelope (Phase 10 Shape C). Revisit only if real relation-blocks appear on the board (none in 200 issues at spike time) AND a governance review approves the cap. v1 scopes the loop to status/awaiting blocks; a relation-block surfaces as "resolve the blocker issue" (itself a Shape A/B reply).
- **`R3-SELF-01` (take-it-myself one-assignee guard)** — may fold in while reworking the action layer (REQUIREMENTS.md Future): clear-then-assign or "already owned by <agent>" messaging when the row is already agent-owned. Planner discretion whether to bundle.
- **Reworking the Bulletin "Requires Your Decision" inbox to share `<ReplyInPlace>`** — out of scope (separate surface, own Approve/Decline loop).
- **Operator-attributed comments (not worker-authored)** — blocked by the host SDK (`createComment` takes no operator actor). Revisit only if the host adds an actor param; until then the flip carries the attribution (D-13).

### Reviewed Todos (not folded)
None surfaced for Phase 14.
</deferred>

---

*Phase: 14-do-it-here-action-loop*
*Context gathered: 2026-06-02*
</content>
</invoke>
