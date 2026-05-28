# SPEC — On-demand "Generate bulletin now" button (with dedupe)

**Written:** 2026-05-28, end of the multi-fix session. **Do this AFTER the pause-banner fix (#1)** in `.planning/NEXT-SESSION-BRIEF.md` is shipped — it is an independent feature and touches different files, so there is no conflict, but #1 is the higher priority.

Same project facts as `NEXT-SESSION-BRIEF.md` §0 (BEAAA box, stable-path deploy in §5, migration-validator rules, etc.). clarity-pack stays **v1.0.0** (no version bump).

---

## Why
1. The Daily Bulletin compiles once/day (06:30 Asia/Jerusalem). The operator wants to pull one **on demand** to see current state without waiting.
2. It is also the clean way to "see a bulletin now" — replaces the dead-end DB-write force (the embedded-PG password is host-held and not accessible).

The minutely `compile-bulletin` poll is NOT wasteful — each tick is a ~45 ms "is it due?" check (a couple of indexed SELECTs); the LLM compile only fires once/day. So this feature is additive, not a rewrite of the scheduler.

---

## Behavior (the contract)
A **"Generate bulletin now"** button on the Bulletin page (`/<companyPrefix>/bulletin`). On click:
1. Runs the SAME compile pipeline the daily cron uses, for the **current company**, **bypassing the `now >= next_due_at` gate**.
2. **DEDUPE (operator-required):** if the freshly-compiled draft's `content_hash` equals the most-recent published bulletin's `content_hash` for this company, do **NOT** publish a new bulletin. Return a "no changes since the last bulletin (No. N, <date>)" result and surface the existing one. Only publish a new cycle when the content actually changed.
3. Must NOT disturb the daily schedule — leave the scheduled `next_due_at` pointer untouched (the 06:30 daily publish continues independently).
4. If the Editor-Agent is paused/unavailable, surface that clearly (the compile would otherwise time out via `deliveryLlmAdapter`).

UI states: idle button → "Compiling…" (disabled) → one of: "Published Bulletin No. N", "No changes since Bulletin No. N (<date>)", or an error ("Editorial Desk unavailable — resume it in the Agents panel").

---

## Design decisions (recommendations — confirm while implementing)
1. **Dedupe mechanic.** Compute the draft + its `content_hash` (the compile already does this). Query the latest *published* bulletin for the company (`bulletins-repo.ts` already has a "latest" read). If `content_hash` matches → return `{ kind: 'no-change', cycleNumber, publishedAt }` and do NOT write a row. Else publish a new cycle. This is application-level dedupe on top of the existing DB `UNIQUE (company_id, next_due_at, content_hash)`.
2. **Cycle numbering.** A genuinely-new on-demand bulletin gets `MAX(cycle_number)+1` per company (same as scheduled — `upsertBulletin` already derives this). On-demand and scheduled share one per-company cycle sequence.
3. **`next_due_at` for the on-demand row.** The bulletins row needs a `next_due_at` value (it is part of the unique key + NOT NULL). Use the compile timestamp (or the current scheduled `next_due_at`) for the on-demand row, but DO NOT advance the *schedule pointer* the daily poll reads (`getNextDueAtForCompany` reads the MAX(cycle_number) row — be careful the on-demand row does not move the daily schedule forward/backward). Verify against `compile-bulletin.ts` step 7 (`advanceScheduleForCompany`) — the on-demand path must skip that advance.
4. **Concurrency.** Guard against a double-click and against an on-demand compile racing the scheduled one: the `content_hash` + `ON CONFLICT (company_id, next_due_at, content_hash) DO NOTHING` give DB-level safety; add a UI "compiling" disabled state. A second identical click → dedupe → "no changes".
5. **Governance.** On-demand compile is an explicit operator action → fine (same budget caps / audit as the scheduled compile). The agent must be active.

---

## Implementation sketch
- **Worker:** register a `bulletin.compileNow` action (mirror how existing actions register — search for `ac-toggle` registration in `worker.ts`/handlers). It should reuse the EXISTING per-company compile logic in `src/worker/jobs/compile-bulletin.ts` — if that per-company body is not already a callable function, extract it into one (e.g. `compileBulletinForCompany(ctx, company, { force: true })`) so the cron and the action share one code path (no duplicated pipeline). The `force` flag bypasses the `next_due_at` gate and skips the schedule advance; the dedupe check stays active.
- **UI:** add the button to `src/ui/surfaces/bulletin/index.tsx`, wired via `usePluginAction('bulletin.compileNow')` with `{ companyId, userId }`. Render the three result states. Refresh the bulletin view (`usePluginData('bulletin.byCycle' / 'bulletin.latestCompileStatus')` `.refresh()`) on success so the new bulletin appears without a manual reload.
- **Reuse, don't fork:** the verify + publish steps (`compile-pass-1.ts`, `bulletin-verifier.ts`, `publish.ts`) are shared with the cron. The action must go through `publishBulletin` so the company-scoped idempotency keys (from migration 0014) apply.

---

## Tests
- Worker: an action test (host-faithful-ctx pattern) — (a) fresh content → publishes cycle N; (b) **identical content_hash to the last published → returns no-change, writes no row** (the dedupe contract); (c) paused/unavailable agent → graceful error; (d) the daily `next_due_at` schedule pointer is unchanged after an on-demand compile.
- UI: source-grep that the button exists, calls `usePluginData`/`usePluginAction('bulletin.compileNow')`, and renders the three states.
- Run the bulletin suite (`test/worker/bulletin/*`) + full suite; deploy per `NEXT-SESSION-BRIEF.md` §5 (no migration needed — 0014 already covers the schema).

---

## One-line summary
Add a "Generate bulletin now" button → new `bulletin.compileNow` worker action that reuses the existing per-company compile pipeline with a force flag, **dedupes on `content_hash` (no new bulletin when nothing changed)**, and leaves the daily 06:30-Israel schedule untouched.
