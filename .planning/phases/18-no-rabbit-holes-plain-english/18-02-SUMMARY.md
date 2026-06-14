---
phase: 18-no-rabbit-holes-plain-english
plan: 02
subsystem: legibility-scrub
tags: [leg-02, no-uuid-leak, scrub, agent-fallback, chat-chips, rescrub, beaaa-972, plain-english]
requires:
  - "11-04/11-06 scrubHumanAction + UUID_RE/UUID_RE_G (the existing 4-step scrub in src/shared/scrub-human-action.ts)"
  - "flatten-blocker-chain.ts scrubResultLabel (worker write-time scrub, consumed at read by the three surfaces)"
provides:
  - "AGENT_FALLBACK ('an agent') — the single plain-English fallback vocabulary; every scrub fallback emits it (never agent#<hex>)"
  - "PARTIAL_HEX_RE (/\\bagent#[0-9a-f]{6,}\\b/i) — the anchored partial-hash guard shared by guard-tests AND the runtime rescrub"
  - "rescrubPersisted(text) — read-time, additive, idempotent re-scrub of persisted UUID/partial-hash leaks (zero new DB fetches)"
  - "humanizeChatChip(chip) — the single chat-chip vocabulary (CHT-<8> -> topic.title; run-<8> -> agent name/role or 'an agent')"
affects:
  - src/shared/scrub-human-action.ts (new exports + six fallback sites swapped)
  - src/ui/surfaces/chat/topic-strip.tsx (chtLabel humanized)
  - src/ui/surfaces/chat/message-thread.tsx (run_link chip humanized)
  - src/ui/surfaces/reader/live-blocker-panel.tsx (read-time re-scrub on blockerLine)
  - src/ui/surfaces/situation-room/employee-row.tsx (read-time re-scrub on focusLine/card/chain)
  - src/ui/surfaces/bulletin/department-section.tsx (read-time re-scrub on editorial prose)
  - "downstream 18-04 (live BEAAA drill — confirms BEAAA-972 Reader reads a human name or 'an agent', no hash)"
tech-stack:
  added: []
  patterns:
    - "single fallback literal (AGENT_FALLBACK) referenced at every emission site — no inline `agent#${uuid.slice(0,8)}` template anywhere"
    - "guard-test inversion as proof: a runtime-only change leaves the OLD blessing assertions failing (the inversion IS the proof, landmine #4)"
    - "anchored partial-hash regex (agent# prefix) imported by both guard-tests and runtime so they can never drift — NOT a blanket /[0-9a-f]{8,}/ (landmine #5)"
    - "read-time re-scrub over already-in-hand strings (regex over in-memory, idempotent, zero new DB fetches — landmine #3)"
key-files:
  created:
    - test/shared/rescrub-persisted.test.mjs
    - test/ui/surfaces/chat/chat-chip-humanized.test.mjs
  modified:
    - src/shared/scrub-human-action.ts
    - src/ui/surfaces/chat/topic-strip.tsx
    - src/ui/surfaces/chat/message-thread.tsx
    - src/ui/surfaces/reader/live-blocker-panel.tsx
    - src/ui/surfaces/situation-room/employee-row.tsx
    - src/ui/surfaces/bulletin/department-section.tsx
    - test/shared/scrub-human-action.test.mjs
    - test/worker/handlers/flatten-blocker-chain-scrub.test.mjs
    - test/ui/surfaces/situation-room/employee-row-no-uuid-leak.test.mjs
    - test/ui/surfaces/situation-room/pulse-header-no-uuid-leak.test.mjs
    - test/ui/surfaces/_shared/reply-in-place-no-uuid-leak.test.mjs
    - test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs
decisions:
  - "The UNCLASSIFIED double-scrub (old :65-66) collapses to ONE pass — name-or-AGENT_FALLBACK — since there is no longer a partial-hash second pass to mop up"
  - "Read-time re-scrub is applied at the SINGLE display-string composition point per surface (blockerLine IIFE result on Reader; each render expr on SR; editorialSummary on Bulletin) — never on the snapshot fetch path (zero new DB queries)"
  - "A4 outcome: the chat run_link payload (SectionRow) carries runId + title but NO agent name (name lives on agent_link rows). The run chip therefore resolves to AGENT_FALLBACK ('an agent') per D-09 last-resort. The worker-side payload COULD later carry the agent name (D-08 escape hatch) but a worker change was NOT needed — the hard requirement (zero raw hex) is met without it."
metrics:
  duration: ~55m
  tasks_completed: 3
  files_created: 2
  files_modified: 12
  tests_passing: "39 (18-02 owned: 29 scrub/rescrub/flatten + 7 chat-chip + 3 added guard cases) / 283 across all touched surface suites"
  completed: 2026-06-14
---

# Phase 18 Plan 02: LEG-02 plain-English identifier scrub Summary

Eliminated every raw or partial agent/UUID identifier from human-facing text across all four surfaces, single-sourced in `src/shared/scrub-human-action.ts`. The six `agent#${uuid.slice(0,8)}` fallbacks all now emit the literal `'an agent'` (real name/role still resolved first); the anchored `PARTIAL_HEX_RE` + idempotent `rescrubPersisted` read-time pass + `humanizeChatChip` were added; the tests that previously *blessed* `agent#<hex>` were INVERTED to assert it FAILS; the three `*-no-uuid-leak` render-scan guards were extended (anchored, no blanket short-hex); and the chat `CHT-<8>` / `run·<8>` chips were humanized. The live anchor — Reader BEAAA-972 reading "...CEO stuck on agent#04fcac7c is stuck" — now resolves to a human name or "an agent" with no hash.

## What Was Built

### Task 1 — Extend scrub module + swap fallback + invert guard tests (commit 6e3da62)
- `src/shared/scrub-human-action.ts`: added `AGENT_FALLBACK = 'an agent'`, `PARTIAL_HEX_RE = /\bagent#[0-9a-f]{6,}\b/i`, `rescrubPersisted(text)` (replace `UUID_RE_G` + `PARTIAL_HEX_RE` → AGENT_FALLBACK; idempotent; pure), and `humanizeChatChip(chip)` (the single chat-chip vocabulary).
- Swapped all six fallback emission sites (steps 2/3/4/5; the UNCLASSIFIED double-scrub collapsed to one pass) from `agent#${uuid.slice(0,8)}` to `AGENT_FALLBACK`. Resolution-first preserved (`nameOf(uuid) ?? AGENT_FALLBACK`). Doc-comments updated from "agent#<8> fallback" to "'an agent' fallback / never a raw UUID or partial hash".
- INVERTED the three blessing assertions in `scrub-human-action.test.mjs` (AWAITING_AGENT_STUCK, EXTERNAL, belt-and-suspenders) and the `agents.get throws` assertion in `flatten-blocker-chain-scrub.test.mjs`: now `doesNotMatch(/agent#[0-9a-f]{6,}/i)` + `match(/an agent/)`.
- NEW `test/shared/rescrub-persisted.test.mjs`: 14 cases — partial-hash + bare-UUID replacement, idempotency, and the anchored PARTIAL_HEX_RE non-match on bare git SHAs / hex colors / `agent#<hex{<6}>`.
- Verified: zero `agent#${` template literals remain in the scrub module.

### Task 2 — Humanize chat chips (commit 188d09d)
- `topic-strip.tsx` `chtLabel`: the non-ordinal `topicId` path NO LONGER returns `id.slice(0,8).toUpperCase()` — it resolves to `topic.title` via `humanizeChatChip`. The legitimate `CHT-NN` / numeric ordinal branches are preserved.
- `message-thread.tsx` run_link chip: `run · {runId.slice(0,8)}` replaced with `run · {humanizeChatChip({ kind: 'run', agentName: row.name, title: row.title })}`; the optional ` · {title}` suffix preserved.
- NEW `test/ui/surfaces/chat/chat-chip-humanized.test.mjs`: humanizeChatChip behavior + source-grep proving zero `.slice(0,8)` chip renders remain and the helper is wired in both files.

### Task 3 — Extend anchored NO_UUID_LEAK guards + wire read-time re-scrub (commit 67414c0)
- The three `*-no-uuid-leak.test.mjs` guards (employee-row, pulse-header, reply-in-place) now `import { PARTIAL_HEX_RE }` from `scrub-human-action.ts` (single anchor — guard and runtime can never drift) and assert no `agent#<hex>` partial hash + no bare UUID in source AND in the behavioral render, plus an explicit assertion that the guard defines no blanket `/[0-9a-f]{8,}/` rule.
- Read-time `rescrubPersisted` wired over strings ALREADY in hand (zero new DB fetches, idempotent):
  - Reader `live-blocker-panel.tsx` — the `blockerLine()` result (all 8 kinds covered at one composition point; the switch reads `data.awaitedPartyLabel`/`data.degradeReason`, never the raw engine label).
  - Situation Room `employee-row.tsx` — `focusLine`, action-card `namedAction`/`awaitedParty`, both-tier `chain.awaitedPartyLabel`, and the `ReplyInPlace` `awaitedPartyLabel`/`namedAction` props.
  - Bulletin `department-section.tsx` — the editorial-prose `editorialSummary`.
- Updated `employee-row-reply-in-place.test.mjs` for the wrapped prop (intent unchanged: the string is still sourced from `chain.awaitedPartyLabel`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adjusted two pre-existing source-grep tests to match the read-time re-scrub wrapping**
- **Found during:** Task 3 (full touched-suite run).
- **Issue:** `employee-row-reply-in-place.test.mjs` (asserted `awaitedPartyLabel={chain.awaitedPartyLabel}` verbatim) and the `t.label`-in-comment in `live-blocker-panel.tsx` collided with the CR-01 `doesNotMatch(/\bt\.label\b/)` guard in `reader-view.test.mjs` / `employee-row-actions.test.mjs`.
- **Fix:** updated the reply-in-place assertion to the wrapped form `awaitedPartyLabel={rescrubPersisted(chain.awaitedPartyLabel)}` (same intent — string sourced from the chain) and removed the literal `t.label` from the new comment in `blockerLine`. The CR-01 guard still extracts the full `blockerLine` body and confirms it reads `data.awaitedPartyLabel`, never the raw engine label.
- **Files modified:** test/ui/surfaces/situation-room/employee-row-reply-in-place.test.mjs, src/ui/surfaces/reader/live-blocker-panel.tsx
- **Commit:** 67414c0

## A4 Outcome (chat run_link payload)

**Does the run_link payload carry an agent name? NO.** The `SectionRow` shape in `message-thread.tsx` carries `runId` + `title` for run_link rows; the agent `name` field is populated only on `agent_link` rows. Per D-09 last-resort, the run chip therefore resolves to `AGENT_FALLBACK` ("an agent"). A worker-side payload addition (D-08 escape hatch) was NOT required — the hard requirement (zero raw hex slice) is met. If a future plan wants the actual agent name on the run chip, the worker classifier can add `name` to the run_link row and `humanizeChatChip` will pick it up with no UI change.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired components introduced. `humanizeChatChip`'s "this topic" / "an agent" outputs are intentional degrade floors (a missing title/name is plain-English, not a stub).

## Verification

- `node --test test/shared/scrub-human-action.test.mjs` — green WITH the three inverted assertions.
- `node --test test/shared/rescrub-persisted.test.mjs` — green (idempotency + anchored non-match on git SHAs / hex colors).
- `node --test test/worker/handlers/flatten-blocker-chain-scrub.test.mjs` — green with the inverted `agent#` assertion.
- `node --test "test/ui/surfaces/**/*-no-uuid-leak.test.mjs"` — green with PARTIAL_HEX_RE + bare-UUID assertions; no blanket short-hex rule.
- `node --test test/ui/surfaces/chat/chat-chip-humanized.test.mjs` — green.
- `npx tsc --noEmit` — clean across all six changed source files.
- grep: zero `agent#${` in scrub-human-action.ts; zero `.slice(0, 8)` hex chip renders in chat; no blanket short-hex guard in any test.
- 283 tests pass across all touched surface suites (situation-room, reader, bulletin, chat, _shared, reader-view).
- Live (deferred to Plan 18-04 drill): BEAAA-972 Reader reads a human name or "an agent", no hash; a historical `body LIKE '%agent#%'` row reads clean on next render via `rescrubPersisted`.

## Deferred Issues

Pre-existing test-env dependency gaps (NOT caused by 18-02): a full `node --test "test/**/*.test.mjs"` reports 58 module-load failures, ALL `ERR_MODULE_NOT_FOUND` for declared-but-uninstalled deps (`date-fns-tz` 3.2.0, `react`, `playwright`, `xlsx`, `esbuild`). None are assertion failures and none are in 18-02-touched files. Root cause: local `node_modules` is incomplete (run `pnpm install`). Logged in `deferred-items.md`. Out of scope for 18-02 (environment only — no code change).

## Self-Check: PASSED

All created/modified files verified on disk; all three task commits (6e3da62, 188d09d, 67414c0) verified in git log.
