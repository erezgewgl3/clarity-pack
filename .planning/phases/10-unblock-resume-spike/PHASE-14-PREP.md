# Phase 14 (unblock-resume feature) — integration prep

> Reversible scouting done overnight 2026-06-01 so Phase 14 can start the instant the spike closes.
> **Do NOT build Phase 14 until the three-shape live verdicts in `10-03-SPIKE-FINDINGS.md` are filled** —
> the recipe (which transition, what order) is the spike's whole output. This note is just the map.

## Where the feature lands

**New worker action handler** — mirror `src/worker/handlers/situation-assign-owner.ts`:
- That handler is the proven template: `wrapActionHandler(ctx, 'situation.assignOwner', …)`, reads
  `leafIssueUuid` (the UUID — Plan 09-04 R3 fix; `leafIssueId` is the human key, log/echo only),
  calls `ctx.issues.update(leafIssueUuid, {…}, companyId, actor)`.
- Phase 14 adds e.g. `situation.unblock` / `situation.resume` the same way: take `leafIssueUuid`,
  apply the spike's locked recipe (status flip + comment ± wakeup), echo a UI toast result.
- **Critical:** mutate via the UUID, never the human `BEAAA-NN` key (Phase 9 R3 bug — see
  MEMORY `beaaa-deploy-mechanics` / 09-VERIFICATION). The shared dispatcher provides `leafIssueUuid`.

## Reusable building blocks (all declared caps)

| Need | Existing code to reuse |
|---|---|
| Status flip to un-terminal a blocked issue | `topic-watchdog.ts` — `ctx.issues.get → status-check → ctx.issues.update IF status ∈ TERMINAL_OR_BLOCKED_STATUSES` (the CTT-07 recovery dance; closest analog to Shape B recipe) |
| Post the answer/resume comment | `ctx.issues.createComment` — `bulletin/publish.ts:116`, `chat/comment-classify.ts` |
| Wake the agent (fire-and-forget) | `agent-task-delivery.ts:405-422` — `ctx.issues.requestWakeup(id, companyId, {reason, idempotencyKey})`, REST-unreliable, non-fatal |
| Mark done / status transitions | `editor.ts:663`, `bulletin-gloss.ts` — `ctx.issues.update(id, {status}, companyId)` |

## Recipe → implementation mapping (fill once the spike locks verdicts)

- **Shape B (dominant real case):** if the spike confirms comment-alone is insufficient and the
  `{status:'in_progress'}` flip is required, Phase 14's handler does flip+comment in the **proven
  ordering** (flip-before vs flip-after — the spike records which). This is a deliberate CTT-07
  exception (operator-attributed, audited) — own it explicitly, don't bury it.
- **Shape A:** likely comment-alone (native wake) — may need no new transition at all.
- **Shape C:** cascade-on-answer if it works; otherwise out of envelope (needs `issue.relations.write`,
  undeclared) — scope decision for Phase 14, not an auto-build.

## UI surface
- The Situation Room hero/leaf already renders the assign-owner action (Phase 9). The unblock-resume
  control sits in the same surface — add a button wired to the new action via `usePluginAction`,
  mirroring the assign-owner UI wiring.

## Deploy
- Per `DEPLOY-RUNBOOK.md` (MemPalace `clarity_pack/runbook`): build-worker + build-ui + tsc manifest +
  npm pack → Path A (scp tarball + SSH install) when `ssh ariclaw whoami`→root, else Path B
  (DO console + GitHub clone + build-on-box). Version bump BOTH `package.json` and `src/manifest.ts`.
