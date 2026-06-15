# Phase 21: Stuck-Agent Reply-In-Place - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Source:** V1.6-SEED.md + live codebase grounding (orchestrator-read source before planning)

<domain>
## Phase Boundary

Extend the Do-It-Here reply loop so the operator can **reply-in-place to resume a STUCK agent** (`AWAITING_AGENT_STUCK`), exactly as Phase 14 shipped reply-in-place for `AWAITING_HUMAN`. The mechanism already exists end-to-end; v1.6.0 activates the **dormant-but-reserved `'nudge'` affordance** for the stuck kind and surfaces the existing `<ReplyInPlace>` primitive on those rows.

In scope: STUCK-01..06 (REQUIREMENTS.md). Out of scope: opt-in toggle UI, Phase-4.2 power features, R3-self-assign, any new Postgres migration, any AI/LLM logic in the engine.

## Why this is wiring, not invention (verified against code)

- **Handler is already terminal-kind-agnostic.** `src/worker/handlers/situation-reply-and-resume.ts` (`situation.replyAndResume`, Plan 14-01) does NOT inspect `terminal.kind`. It posts the operator's reply as a canonical `public.issue_comments` comment (the native resume trigger for BOTH Shape A awaiting-answer and Shape B `status='blocked'`), then applies the operator-attributed `{status:'in_progress'}` flip ONLY when the caller passes `needsDurabilityFlip:true`. **No handler change is required** for the stuck path — a stuck row that is `status='blocked'` is Shape B and already resumes correctly through this handler.
- **Resume recipe proven for the stuck shape.** The Phase-10 spike (`.planning/phases/10-unblock-resume-spike/`) proved a plain comment resumes an agent in BOTH the awaiting-answer AND `status='blocked'` cases — the latter IS the dominant stuck shape.
- **The `'nudge'` affordance was reserved for exactly this.** `src/shared/types.ts:69` declares `actionAffordance: 'reply' | 'nudge' | 'assign' | 'open' | 'none'`. `blocker-chain.ts:84` comment: *"The 'nudge' affordance is reserved for the Phase 14 reply/nudge loop (D-06 — dormant, not deleted from the union)."* v1.6.0 is the activation of that dormant slot.

## SEED CORRECTION (honest divergence — surface in SUMMARY)

The seed (V1.6-SEED.md) asserted "blocker-chain.ts stays untouched" and "Worker eligibility — loosen any terminal-kind gate in situation-reply-and-resume.ts." Live-code grounding shows the opposite is the correct, minimal design:
- The handler needs **no** change (it never gated on terminal kind).
- The real gate is the engine **verdict mapping** in `blocker-chain.ts` + the **`isReplyReachable` predicate** in `reply-reachable.ts`, both of which deliberately routed `AWAITING_AGENT_STUCK` to `'assign'` / `false` under the **Phase-12 D-05 lock**. v1.6.0 reverses that lock for the reply path. The engine change is purely structural (a verdict triple + a boolean) — it remains AI-free / pure / I/O-free, honoring the engine's purity boundary.

</domain>

<decisions>
## Implementation Decisions (LOCKED)

### D-1 — Engine verdict flip (`src/shared/blocker-chain.ts`, `classifyVerdict`, ~line 80-86)
Change `AWAITING_AGENT_STUCK` from `{ tier: 'watch', actionAffordance: 'assign', needsYou: false }` to `{ tier: 'watch', actionAffordance: 'nudge', needsYou: false }`.
- **`tier` stays `'watch'` and `needsYou` stays `false`** — a stuck agent NEVER enters the loud Needs-you list (Phase-15 / Phase-12 D-04 lock preserved). Reply-to-unstick is a QUIET Watch-tier affordance, not a promotion to Needs-you.
- Update the D-05 comment to record the reversal (Phase-21 activates the reserved nudge slot; cite this CONTEXT).
- Keep the exhaustive `switch` + `never` guard intact; this is a one-triple edit, no new kind.

### D-2 — Reply-reachable predicate (`src/shared/reply-reachable.ts`, `isReplyReachable`)
Change `case 'AWAITING_AGENT_STUCK': return false;` → `return true;`. A stuck agent's blocked issue resumes via the same answer-comment recipe (Phase-10 Shape B proven). Update the comment block (remove the "DEFERRED / Phase 12 D-05 LOCK" rationale; cite Phase-21 activation). Purity unchanged (input is the kind discriminant alone).

### D-3 — UI gate: mount `<ReplyInPlace>` on the `'nudge'` affordance (both surfaces)
- **Situation Room** (`src/ui/surfaces/situation-room/employee-row.tsx`): add `const showNudge = chain?.actionAffordance === 'nudge';` alongside the existing `showReply`/`showAssign`. Mount the SAME `<ReplyInPlace>` primitive for `showNudge`. **Critical constraint:** stuck rows render in the QUIET **Watch-tier body** (`visualTierOf` → `'watch'`), NOT the loud Needs-you cluster. So the nudge `<ReplyInPlace>` must be wired into the Watch-tier body path — a contained, quiet affordance ("Nudge to unstick") — without promoting the row to Needs-you. Do NOT move the row between tiers.
- **Reader** (`src/ui/surfaces/reader/live-blocker-panel.tsx`): the panel already switches on `actionAffordance` with an exhaustive `switch` (line ~302) and a `never` guard (line ~346). Add a `case 'nudge':` that mounts `<ReplyInPlace>` (mirror the `'reply'` branch's render path, `isReplyBranch`-style). The `never` guard will force this — a missing case is a compile error.
- **Reachable:** both surfaces already compute `isReplyReachable(terminalKind)` and pass it to the primitive. With D-2, a stuck row returns `reachable:true` → Send renders (not a dead Open↗).

### D-4 — Stuck-context copy (distinct from the human-decision wording)
- The `<ReplyInPlace>` primitive renders the `namedAction` sentence + a fixed "Send"-style button; there is no copy/placeholder prop today (`ReplyInPlaceProps`, reply-in-place.tsx:45-75).
- **Decision:** add an OPTIONAL, backward-compatible `variant?: 'answer' | 'nudge'` prop (default `'answer'`) to `ReplyInPlaceProps`. `variant='nudge'` changes ONLY the affordance copy — button/placeholder/label text → stuck-context wording ("Nudge to unstick" / "Reply to unstick — your note resumes {awaitedPartyLabel}"). It must NOT change any dispatch/behavior. AWAITING_HUMAN callers omit the prop and keep today's exact wording (no regression).
- Surfaces pass `variant='nudge'` on the `'nudge'` branch and compute a stuck-context `namedAction` sentence.

### D-5 — `needsDurabilityFlip` flows unchanged
The worker rollup/backlog already emits `needsDurabilityFlip` from the leaf issue's `status` at build time (Plan 14-04). A stuck row with `status='blocked'` → `needsDurabilityFlip:true` → handler applies the operator-attributed in_progress flip → durable resume. No new plumbing; confirm the rollup emits the field for `'nudge'` rows the same way it does for `'reply'`/`'assign'` (it is status-derived, not affordance-derived, so it already does — verify in plan).

### D-6 — action-cards affordance mapping (`src/worker/agents/action-cards.ts`, `actionKindFromAffordance`)
`'nudge'` currently falls through to `default → 'none'`. The 0015 migration CHECK constraint enumerates `action_kind` ∈ {`answer`,`assign`,`decide`,`none`}. **To avoid a new migration (out of scope), map `case 'nudge': return 'answer';`** — a nudge IS an answer-comment. Action-cards are flag-gated (Phase 19) but correctness still matters. NO migration.

### D-7 — Audit every `actionAffordance === 'assign'` consumer for the now-missing stuck rows
Grounding found `build-employees-rollup.ts:916` counts `r.blockerChain.actionAffordance === 'assign'`. After D-1, stuck rows are `'nudge'`, not `'assign'`. The planner MUST audit each `'assign'` reader (rollup counts, backlog, action-cards, any UNOWNED-vs-STUCK assumption) and confirm the semantics stay correct — UNOWNED still carries `'assign'`; only stuck moved to `'nudge'`. Update any count/branch that intended to include stuck.

### D-8 — Tests (extend, don't rewrite)
- Verdict-consistency matrix `test/worker/blocked-no-edge-verdict-consistency.test.mjs` (the 4-surface × 8-kind matrix, Plan 17-05) asserts `AWAITING_AGENT_STUCK → 'assign'`. Update the expected cell to `'nudge'` and assert one consistent verdict across all four surfaces.
- `reply-reachable` test: assert `AWAITING_AGENT_STUCK → true` (flip the existing expectation).
- Extend the Phase-14 reply-and-resume tests to cover the stuck/nudge render + dispatch path (Send mounts, dispatch carries `needsDurabilityFlip`, await-confirm honesty).
- **Degrade-safe**: a chainless / null-leaf stuck row degrades to named action + (Open↗ when a leaf human key exists) — never a dead Send, never a throw.
- **NO_UUID_LEAK**: the new `'nudge'` render paths must keep the existing render-scan guard green (only `leafIssueId`/`awaitedPartyLabel` render; `*Uuid` dispatch-only).

### D-9 — No new migration / no new capability
`issue.comments.create` + `issues.update` are already declared (Plan 14, D-14). No schema change. If the planner believes a migration is needed, STOP and flag — it would contradict the locked scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Engine (pure, AI-free — keep that boundary)
- `src/shared/blocker-chain.ts` — `classifyVerdict` verdict mapping (D-1 edit at the `AWAITING_AGENT_STUCK` case); exhaustive-switch idiom.
- `src/shared/reply-reachable.ts` — `isReplyReachable` predicate (D-2 edit).
- `src/shared/types.ts` — `actionAffordance` union (already includes `'nudge'`); `Terminal` kinds; `BlockerChainResult`.

### Worker
- `src/worker/handlers/situation-reply-and-resume.ts` — the `situation.replyAndResume` handler (terminal-kind-agnostic; NO change expected — read to confirm).
- `src/worker/situation/build-employees-rollup.ts` — rollup that emits `blockerChain` + `needsDurabilityFlip` per row; `actionAffordance === 'assign'` count at ~line 916 (D-5/D-7).
- `src/worker/handlers/org-blocked-backlog.ts` — backlog rows (carry terminalKind + needsDurabilityFlip).
- `src/worker/agents/action-cards.ts` — `actionKindFromAffordance` (D-6); flag-gated.

### UI
- `src/ui/surfaces/_shared/reply-in-place.tsx` — the ONE shared primitive (D-4 optional `variant` prop).
- `src/ui/surfaces/situation-room/employee-row.tsx` — `showReply`/`showAssign` gates + Watch-tier body (D-3).
- `src/ui/surfaces/reader/live-blocker-panel.tsx` — exhaustive `actionAffordance` switch + `never` guard (D-3 new `case 'nudge'`).

### Prior-phase proof / templates
- `.planning/phases/10-unblock-resume-spike/` — the comment-resumes-a-blocked-agent spike (Shape A + Shape B).
- `.planning/phases/14-*/` — reply-and-resume plans + tests (the template being extended).

### Project rules
- `CLAUDE.md` — stack pins, coexistence guarantees, bookended-by-snapshots, NO_UUID_LEAK, additive-only schema.

</canonical_refs>

<specifics>
## Specific Ideas

- Reuse the SINGLE `<ReplyInPlace>` primitive everywhere (no copies — the Phase-14 SC3 rule). The only primitive change is the optional `variant` copy prop (D-4).
- The Reader panel's `never` guard is a free safety net: adding `'nudge'` to the engine union without a `case 'nudge':` in the panel is a compile error — let the build enforce coverage.
- Stuck rows stay in **Watch** (quiet) — the affordance is "nudge to unstick", visually calm, NOT a red Needs-you card. Preserve the Phase-15 tier partition (`visualTierOf` is the single source — do not fork it).
- No-auto-resume (STUCK-04): resume happens ONLY on an explicit operator Send. Loading/viewing a stuck row must perform zero mutation (the primitive already dispatches only on Send — confirm no effect fires on mount).

## Live drill (success criterion, not a REQ-ID)

Bookended BEAAA deploy + a real stuck-agent reply→resume:
- Two-source version bump (package.json + src/manifest.ts); current live = **v1.8.0** → bump to **v1.8.1** (UI/handler gate, no migration) unless the planner justifies v1.9.0.
- Bookend = confirmed automated DO backup (AriClaw droplet; no doctl/psql on box).
- fail2ban: ONE deliberate SSH connection per step; detached (`setsid`) jobs. AriClaw root `/` HOT (~98%) → temp/artifacts to `/mnt/paperclipdata`. `plugin upgrade` registry-only → uninstall-then-install from extract-dir.
- BEAAA plugin id `a763176a-2f4d-4986-b190-b5151e42cc00`, CID `59f8876e-e729-4dda-98f9-1317c2b50492`.

</specifics>

<deferred>
## Deferred Ideas

- Keeping BOTH an assign (owner-picker) AND a nudge affordance on a stuck row — deferred. The engine is one-affordance-per-row; stuck → `'nudge'` (reply) is the chosen lower-friction first response. Owner reassignment stays reachable via Open↗ → the leaf issue page. Revisit only if the live drill shows operators need in-row reassignment for stuck rows.
- Per-user opt-in toggle UI, Phase-4.2 power features, R3-self-assign — explicitly dropped by Eric for v1.6.0.

</deferred>

---

*Phase: 21-stuck-agent-reply-in-place*
*Context gathered: 2026-06-15 via orchestrator codebase grounding (seed + live source read)*
