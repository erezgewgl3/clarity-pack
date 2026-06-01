---
phase: 09-situation-room-actionable-cockpit
plan: 04
type: tdd
gap_closure: true
status: complete
ships_as: v1.3.0 (corrected build — no version bump)
requirements: [R3, R4]
verified_live: 2026-06-01
commits: [fbe3d00, 072dade, 53369c5, 34fff78]
---

# 09-04 SUMMARY — R3 leaf-UUID gap closure

## What this plan closed

The single blocking R3 gap from the live v1.3.0 BEAAA drill (2026-05-31): `situation.assignOwner`
passed the **human** issue key (`BEAAA-43`) to `ctx.issues.update`, which needs the issue **UUID**
→ host rejected → `ASSIGN_FAILED`. The fix carries `leafIssueUuid` separately from the display key
end-to-end so the mutation targets the right row while the human key stays display/log-only. This
un-gates R4 (the hero Assign-owner button now completes its effect).

## Tasks executed

| Task | Commit | Outcome |
|------|--------|---------|
| Task 1 — RED (worker tests) | `fbe3d00` | UUID-strict fake reproducing the live ASSIGN_FAILED + missing-`leafIssueUuid` reject; rollup `leafIssueUuid` asserts (FAILED against unmodified source) |
| Task 1 — GREEN (worker source) | `072dade` | rollup emits `leafIssueUuid` on `blockerChain` + `NeedsYou.topAction` (source: `leaf.id` / `leafNodeId` / `focusIssue.id`, never `.identifier`); handler reads `reqStr(params,'leafIssueUuid')` and mutates via the UUID; human key log/echo-only |
| Task 2 — UI (source + tests) | `53369c5` | shared `owner-picker-popover.tsx` dispatches `leafIssueUuid: leafIssueUuid ?? leafIssueId`; `employee-row.tsx` + `needs-you-banner.tsx` feed both props; `blocked-backlog-expander.tsx` unchanged (covered by the `?? leafIssueId` fallback); NO_UUID_LEAK preserved |
| Task 3 — gate set + build | `34fff78` | full gate set green; corrected over-specified `leafIssueUuid` test expectations to the plan's real UUID source; deferred a pre-existing watchdog flake |
| Task 4 — deploy + re-drill | (live) | corrected v1.3.0 to BEAAA (Path A); R3 agent-assign PASS + persisted; R4 un-gated; self-assign → follow-on gap |
| Task 5 — close-out | (this commit) | VERIFICATION/STATE/ROADMAP updated; follow-on gap logged; SUMMARY written |

## RED-was-real evidence

- **Task 1 (worker):** with the new `uuidStrictUpdate` fake (`issues.update` throws on a non-UUID
  first arg), the agent-assign + self-assign success tests FAILED against unmodified source — the
  handler passed the human key `BEAAA-43` → the strict fake threw → ASSIGN_FAILED (the exact live
  failure). A missing-`leafIssueUuid` payload also FAILED (pre-fix handler did not require the key).
  After GREEN: `ctx._issueUpdateCalls[0].issueId === <UUID>` for both branches; `result.leafIssueId`
  still echoes the human key.
- **Task 2 (UI):** the 8 new 09-04 assertions FAILED against unmodified UI source (popover did not
  dispatch `leafIssueUuid`; rows did not thread it). After GREEN: both UI test files pass.

## Gate tally (Task 3)

- `npx tsc --noEmit`: clean
- `node scripts/check-css-scope.mjs`: PASS (189 selectors, all `[data-clarity-surface]`-scoped)
- `node scripts/check-ui-bundle-size.mjs`: PASS (719.2 kB of 752,640-byte ceiling)
- Full suite: **2323 tests, 2320 pass, 1 fail, 2 skipped** — the single fail is a pre-existing
  `U7 WATCHDOG-FIRE-AND-FORGET` wall-clock timing flake in `test/worker/chat/chat-messages.test.mjs`
  (32/32 green in isolation; 09-04 touched zero chat files). Logged to `deferred-items.md`.
- Builds: `dist/worker.js` 2.5 MB, `dist/ui/index.js` 719.2 kB, `dist/manifest.js` 64,979 B
- Version/capability: `package.json` + `src/manifest.ts` UNCHANGED at 1.3.0; `issues.update` capability unchanged

## Wiring tie (the fix's load-bearing invariant)

```
owner-picker-popover.tsx:145:  leafIssueUuid: leafIssueUuid ?? leafIssueId,   ← popover DISPATCHES
situation-assign-owner.ts:70:  const leafIssueUuid = reqStr(params, 'leafIssueUuid');  ← handler READS
situation-assign-owner.ts:124: await ctx.issues.update(leafIssueUuid, …)      ← single update call site
```

## Live re-drill (2026-06-01, BEAAA, corrected v1.3.0)

- **Deploy:** Path A (scp `clarity-pack-1.3.0.tgz` sha256 `a36565e9…ca455` + here-string install as
  `beai-agent` + `pm2 restart paperclip`). `paperclipInvocation`×5 (SDK inlined). `status=ready
  version=1.3.0 id=a763176a` — plugin UUID preserved (COEXIST #6). SSH reachable (the earlier "hang"
  was sshd MaxStartups connection-burst throttling, not a fail2ban ban).
- **Live-worker marker:** `POST /data/situation.snapshot` → 200; `needsYou.topAction` carries BOTH
  `leafIssueId:"BEAAA-43"` AND `leafIssueUuid:"4290fb32-…"` — the field did not exist in the buggy build.
- **R3 agent-assign (HERO) — PASS + persisted:** `Assign owner ▾` on CFO/BEAAA-43 → pick CFO agent →
  `200 {"ok":true,"leafIssueId":"BEAAA-43","assignedTo":"301c968a-…"}` (no ASSIGN_FAILED). Independent
  core-API re-read `GET /api/issues/BEAAA-43` → `assigneeAgentId:"301c968a-…"`, operator-attributed,
  re-confirmed persisted. This is the precise issue + flow that failed on 2026-05-31.
- **R4 — PASS:** hero button completes its effect (un-gated). **R9 — PASS:** display stayed `BEAAA-NN`;
  UUID only ever an action arg.

## Follow-on gap (NOT this plan's bug)

**`R3-self-assign-one-assignee` (minor):** "Take it myself" (`assigneeUserId`) was exercised on
BEAAA-617 → host rejected with `"Issue can only have one assignee"` (host log `paperclip-out.log`
line 515778). The issue already had an `assigneeAgentId`; probing all six remaining Needs-you issues
showed **every one already carries an `assigneeAgentId`** — so there is no clean live self-assign
target on the BEAAA board. This is a host business-rule interaction (the UUID reaches the host
correctly — the same `ctx.issues.update(leafIssueUuid,…)` call the now-passing agent-assign uses),
NOT the leafIssueUuid bug. Task 1 unit tests cover both branches' UUID-arg behavior. Candidate
follow-on: clear-then-assign (displace the existing assignee), or surface "already owned by `<agent>`"
instead of generic ASSIGN_FAILED. Does not block Phase 9 closure.

## Files changed (11)

- `src/worker/situation/build-employees-rollup.ts`
- `src/worker/handlers/situation-assign-owner.ts`
- `src/ui/surfaces/situation-room/owner-picker-popover.tsx`
- `src/ui/surfaces/situation-room/employee-row.tsx`
- `src/ui/surfaces/situation-room/needs-you-banner.tsx`
- `test/worker/handlers/situation-assign-owner.test.mjs`
- `test/worker/situation/build-employees-rollup.test.mjs`
- `test/worker/situation/build-employees-rollup-needsyou.test.mjs`
- `test/ui/surfaces/situation-room/employee-row-actions.test.mjs`
- `test/ui/surfaces/situation-room/needs-you-banner.test.mjs`
- `.planning/phases/09-situation-room-actionable-cockpit/deferred-items.md`

## Self-check

- R3 root cause closed (agent-assign mutates via the UUID dispatched by the shared popover) — PASS, proven live + unit-tested
- Popover→action→handler wiring closed (dispatch key == handler read) — PASS
- Display contract intact (human BEAAA-NN only; NO_UUID_LEAK) — PASS
- No version/schema/capability change — PASS
- Live re-drill re-passes R3 (agent-assign) + R4 — PASS
- Self-assign branch — follow-on gap (host one-assignee rule), logged, not closed by this plan
