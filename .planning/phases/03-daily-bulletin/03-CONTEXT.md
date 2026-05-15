# Phase 3: Daily Bulletin — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Synthesized from ROADMAP success criteria + REQUIREMENTS BULL-01..09 + research/PITFALLS.md (pitfalls #9, #10, #14) + research/SUMMARY.md Phase 3 build plan + sketches/paperclip-fix-bulletin.html + Phase 2 carryover decisions. No `/gsd:discuss-phase 3` was run — Eric instructed `/gsd:plan-phase 3` directly under yolo mode. BULL requirements are highly locked already (DST-safe, idempotent, SQL-grep'able numbers, two-pass verifier, errata first-class) — gray areas isolated and called out under Claude's Discretion below.

<domain>
## Phase Boundary

Editor-Agent **compiles a Daily Bulletin** every morning at 06:30 America/New_York (DST-safe) and an opted-in user **opens the Bulletin route** to see:

1. A **masthead** ("The Bulletin · Vol. I · No. N · {day} · {date} · 06:30 ET · prepared for Eric G., Editor-in-Chief · Operations Cycle N · Auto-compiled") matching `sketches/paperclip-fix-bulletin.html`.
2. A **"Requires Your Decision" inbox** at the top with one card per outstanding decision (dept tag + age + summary + Approve / Open / Decline affordances; Approve and Decline are bridge actions that perform the underlying Paperclip mutation).
3. **Department sections** ("Yesterday's Operations · {date}") — Production, Sales, Customer, Builder for v1 — each with item rows + an Editorial-prose summary + a lineage thread (the agent-by-agent compile graph terminating in a single terminal node).
4. A **"Standing Numbers" panel** in the right rail where **every number is grep-able to a SQL query** against Paperclip core tables. No LLM-generated numbers.
5. A **failed-compile banner** at the top ("Bulletin compile failed at HH:MM · retrying at NN") when the most recent compile attempt failed; never silent failures.
6. **Errata footer** appended (not rewriting the prior text) when an erratum is added to a published bulletin; subscribers see it on the next view.

Behind the scenes:

- **Worker-managed `next_due_at`** in plugin state — computed via `date-fns-tz` or `luxon` in `America/New_York`. The Paperclip `routines[]` cron field, if used at all, is a **hint only**; the worker reads `next_due_at` on every heartbeat tick and fires only when `now >= next_due_at`. Re-firing the same `next_due_at` is a no-op (idempotency key = `(next_due_at, content_hash)`).
- **Two-pass compile**: pass 1 produces a draft (LLM prose + structured numeric slots); pass 2 is a deterministic verifier that re-runs every SQL query for every numeric slot and rejects the draft on any mismatch. Only verified output publishes.
- **Persisted as a Paperclip issue** named `Bulletin No. N` (canonical) so plugin disable leaves every prior bulletin searchable in classic Paperclip. The plugin's own table holds bulletin metadata (cycle number, compile timestamps, lineage threads, errata pointers) — bulletin **body** lives only in the Paperclip issue.

**Scope anchor:** Phase 3 ships the Bulletin **only**. Employee Chat (Phase 4) and Distribution polish (Phase 5) are out of scope.

**What stays from Phase 2 (do NOT rebuild):**
- Editor-Agent declaration, `ctx.agents.managed.reconcile`, self-loop filter, max_tokens cap, circuit breaker, pause banner.
- Reference resolver (`src/shared/reference-resolver.ts`) — reused for ref-chips inside bulletin item rows.
- Opt-in gate (`useOptIn` + `clarity_user_prefs` + server-side guard) — bulletin page gated identically to Reader / Situation Room.
- Theme tokens / state pill / ref chip primitives — bulletin reuses them; new bulletin-only styling (Fraunces + Newsreader fonts, warm-paper palette, masthead chrome) lives in a scoped surface stylesheet under `[data-clarity-surface="bulletin"]`.
- Same-origin trust model — bulletin UI uses `usePluginData` / `usePluginAction` only; ESLint `no-raw-fetch-in-ui` still in force.

</domain>

<decisions>
## Implementation Decisions

### Scheduling

- **D-12: Worker-managed `next_due_at` is the source of truth**, not Paperclip's `routines[]` cron. Manifest declares a `routines[]` entry as a documentation/hint (e.g. `0 30 6 * * *`) but the worker job ignores the cron string and uses its own `next_due_at` row in plugin state. On every heartbeat tick: read `next_due_at`; if `now >= next_due_at`, run compile, then recompute the NEXT `next_due_at` via `luxon` (or `date-fns-tz`) in `America/New_York`. **Library choice = `luxon`** — slightly larger than `date-fns-tz` but has explicit `setZone("America/New_York")` semantics that round-trip cleanly across both DST transitions; no ambiguity for the 1am–2am fall-back hour.
  - **Why:** PITFALLS.md #9 (DST drift) — bare cron strings interpreted as UTC fire at the wrong wall-clock time on DST boundaries.
  - **Verification gate (must be a plan task):** CI tests fake the system clock to 2026-03-08 (day before spring-forward), 2026-03-09 (day of), 2026-11-01 (day before fall-back), 2026-11-02 (day of). Assert: exactly one bulletin compiles per calendar day, at 06:30 wall-clock. The fall-back fixture must include the duplicated 01:00–02:00 hour without triggering a second compile.

- **D-13: Idempotency key for compile = `(next_due_at_iso, content_hash)`.** Re-firing the same `next_due_at` with the same input hash is a no-op; re-firing with the same `next_due_at` but different input hash (e.g. retry after a transient failure with new data) produces a NEW compile attempt, NOT a republish (errata is the only way to amend a published bulletin).

### Two-pass verifier

- **D-14: Structured numeric slots in the draft, NOT prose-extracted numbers.** Pass-1 LLM output is a structured object: `{ masthead: {...}, action_inbox: [...], departments: [...], standing_numbers: [{key, sql, value, format}], lineage_threads: [...] }`. The `standing_numbers[*].value` field is filled by the LLM ONLY as a placeholder claim; pass-2 verifier re-executes `standing_numbers[*].sql` against `ctx.db.query()` and rejects if the actual SQL result differs from the claimed value beyond a configurable tolerance (default: exact match for integers; ±0.01 for percentages).
  - **Why:** PITFALLS.md #10 (hallucinated bulletin summaries). Allowing the LLM to write free-form prose with numbers inline guarantees eventual drift — every Slack-AI / Notion-Recap research source flagged this.
  - **Pass-1 also extracts a "facts table"** from the source data BEFORE prose generation; the LLM prose CAN reference these facts but every `{{NUMBER:key}}` placeholder in the prose is checked by pass-2 against the facts table.

- **D-15: Pass-2 verifier is deterministic code, not an LLM.** Verifier is `src/worker/bulletin-verifier.ts` — pure function `(draft, sqlClient) → VerifierResult`. Rejection produces a typed error (`{kind: "NUMBER_MISMATCH", slot, claimed, actual}` etc.) that is logged to the bulletin's audit trail. Three consecutive verifier rejections trip the Editor-Agent's existing circuit breaker (Phase 2 D-06).

### Persistence model

- **D-16: Canonical body = Paperclip issue.** Each compiled bulletin is a Paperclip issue created via the existing Paperclip REST API (or `ctx.issues.create` if the SDK exposes it — verify in Phase 3 smoke task) with:
  - Title: `Bulletin No. {N} — {weekday}, {YYYY-MM-DD}`
  - Author: the Editor-Agent (governance parity — no special privileges)
  - Body: rendered markdown of the verified draft (masthead + action inbox stub + department sections + standing numbers + lineage threads)
  - Tags: `clarity:bulletin`, `clarity:bulletin-issue` (used by self-loop filter), `cycle:{N}`
- **D-17: Plugin-namespace table `bulletins`** stores metadata only (cycle_number PK, next_due_at, compiled_at, verified_at, published_issue_id FK to public.issues.id, compile_status enum, content_hash, lineage_thread_json, errata_ids[]). Coexistence guarantee #2 + #3 satisfied — body lives in public.issues; metadata lives in plugin namespace.
- **D-18: Errata are first-class** — separate plugin-namespace table `bulletin_errata` (id, bulletin_cycle_number, added_at, added_by_user_id, body_md). On Bulletin view, errata for that cycle render as a footer block BELOW the main body, never inline-rewriting; on next compile cycle, the errata snapshot from cycle N is appended to cycle N's persisted issue as a comment via `ctx.issues.comments.create` (no rewrites to the issue body).

### Action Inbox

- **D-19: "Requires Your Decision" cards source = Paperclip issues with state `awaiting_human` AND `assignee.user_id === viewer.user_id`**, scoped to the last 30 days. Each card's Approve / Decline / Open buttons are bridge actions:
  - **Approve** = action handler that calls Paperclip's existing issue-resolution endpoint with `resolution: "approved"`; revalidates the bulletin's action-inbox query.
  - **Decline** = same, with `resolution: "declined"`.
  - **Open** = SPA navigation via `useHostNavigation().linkProps()` to the issue detail page (the same page Reader view tabs into).
  - Age is computed worker-side (`now - issue.awaiting_since`) and rendered as "{N}h" / "Yesterday · HH:MM ET".

### Department sections

- **D-20: Departments are configurable via `instanceConfigSchema`** with a v1 default = `["Production", "Sales", "Customer", "Builder"]`. Mapping from a Paperclip employee to a department is held in plugin state (`clarity_department_membership` table — employee_user_id PK, department text) populated by an idempotent reconcile pass on the first compile of each cycle. v1 default reconcile = parse the employee's role label (e.g. role contains "Sales" → Sales dept); fall back to "Builder" if no match. Eric can override via a settings UI affordance (deferred to v2 — for v1 he can update the table directly or via SQL).

### Lineage threads

- **D-21: Lineage thread data source = Paperclip activity log filtered by `cycle_window` (yesterday 06:30 ET → today 06:30 ET) AND `actor_type=agent`.** The compile job collects all agent activity rows in that window, groups by "trace" (a connected sub-graph in the agent-handoff DAG — using activity rows where `caused_by_activity_id` is set), and produces one lineage_thread per terminal node. Threads are rendered in the bulletin's footer (matches sketch ll. 195–230). Empty days render the "quiet day" prose ("· no items ·") per sketch ll. 151–156.

### Failed-compile banner

- **D-22: Banner state machine** = `{ kind: "ok" } | { kind: "failed", attempt_at, next_retry_at, reason }`. Compile failures (LLM call threw, verifier rejected 3 times, SQL error in standing numbers) write a `compile_failure` row to plugin state; the bulletin UI page reads the most recent row via `usePluginData("getLatestCompileStatus")` and renders the banner when `kind === "failed"` AND `next_retry_at > now`. Retries are spaced 15 minutes apart, capped at 3 retries per cycle, after which Editor-Agent circuit-breaker pauses (Phase 2 D-06) and the banner stays visible.

### Claude's Discretion

The following details are NOT pinned to a specific value here; the planner / executor may choose pragmatic values within these constraints:

- **Exact `luxon` vs `date-fns-tz` choice** — D-12 recommends luxon; planner may downgrade to `date-fns-tz` if bundle-size impact > 30KB minified. Test fixture for both DST transitions is required either way.
- **Pass-1 LLM prompt shape** — temperature, system-prompt phrasing, few-shot examples, output schema (JSON Schema or zod). Constraint: output MUST be parseable into the structured draft object; reject on unparseable.
- **Standing-Numbers panel content for v1** — the SUMMARY.md and sketch mention MRR, briefs sent, reply rate, refund rate. The planner picks the actual 4–6 numbers for v1 based on what Paperclip core tables actually expose (TBD via Phase 3 research). All must be SQL-derivable.
- **Bulletin-issue tag taxonomy** beyond the three required (`clarity:bulletin`, `clarity:bulletin-issue`, `cycle:{N}`).
- **Errata UI affordance** — whether errata are added via a button on the bulletin page (opted-in editor) or only via a worker action; v1 default = settings-page form (low velocity expected).
- **Lineage-thread compaction** — if more than N=8 agent handoffs in a single trace, planner may choose to summarize with "…and 3 more steps" rather than show every node. Sketch shows 8 nodes.
- **Cycle numbering — when does cycle 1 start?** Recommend: cycle number = days since `bulletins.first_compiled_at` plus 1; backfill of historical days NOT in scope for v1.
- **Plan decomposition** — recommend 3-4 plans: (i) scheduling spike + bulletins schema, (ii) compile pipeline (LLM pass-1 + verifier pass-2), (iii) bulletin page UI + action inbox + standing-numbers panel + lineage footer, (iv) errata + failed-compile banner + DST CI tests. Wave assignment per planner's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Project-level (locked decisions + requirements)

- `.planning/PROJECT.md` — Core value, 10 locked decisions, constraints, coexistence guarantees
- `.planning/REQUIREMENTS.md` — Phase 3 = BULL-01..09 (9 requirements). Every BULL-NN must be addressed by exactly one plan's `requirements` field.
- `.planning/ROADMAP.md` §"Phase 3: Daily Bulletin" — Goal + 5 success criteria + depends-on (Phase 2) + requirements list
- `.planning/STATE.md` — Accumulated locked decisions (Decision #6: 06:30 ET cadence; Decision #3: Editor-Agent governance parity)

### Research synthesis (Phase-3-relevant sections)

- `.planning/research/SUMMARY.md` §"Phase 2: Daily Bulletin" *(numbering pre-roadmap-split; this is now Phase 3)* — Key additions (compile-bulletin.ts routine, two-pass compile, DST-safe next-due-at, SQL-derived numbers, errata, failed-compile banner); pitfalls 9, 10, 14, 6
- `.planning/research/ARCHITECTURE.md` §"Phase 2 build order" — Bulletin doc compiler lives inside Editor-Agent; bulletin layout primitives in a new theme; build dependencies from Phase 2 primitives
- `.planning/research/FEATURES.md` §"Surface C — Daily Bulletin" — Table-stakes: action inbox, dept sections, standing numbers, lineage threads; "Hard:" lineage at scale + grounding to avoid hallucinated numbers; "facts table" pre-render step
- `.planning/research/PITFALLS.md` §"Pitfall 9" (DST drift), §"Pitfall 10" (hallucinated bulletin summaries — verifier pass + citation-required test + errata workflow test), §"Pitfall 14" (TL;DR transcription drift — verbatim-invariant test)
- `.planning/research/STACK.md` §"plugin manifest extensions" — `routines[]` declaration; `database.migrationsDir`; `agents[]` for Editor-Agent (already declared in Phase 2 — extending, not redeclaring)

### Phase 2 closure context (what already exists, do not rebuild)

- `.planning/phases/02-scaffold-and-surfaces/02-09-SUMMARY.md` — Final test suite 422 tests / 420 pass / 0 fail / 2 skip; dist/ui/index.js 67.8 KB; dist/worker.js 38.9 KB; useResolvedUserId resolver pattern for wrapped handlers
- `src/manifest.ts` — current manifest (will extend with new `routines[]` entry + `bulletin` page slot; do NOT redeclare Editor-Agent)
- `src/worker.ts` — current worker entry (will register new `compile-bulletin` job + `getBulletinByCycle` / `getLatestCompileStatus` / `addErratum` handlers)
- `src/shared/reference-resolver.ts`, `src/shared/blocker-chain.ts` — reused as-is
- `src/shared/use-resolved-user-id.ts` (Phase 2 Plan 02-09) — pattern for opt-in-gated handlers in this codebase
- `migrations/` — append-only; Phase 3 adds `0002_*.sql` and `0003_*.sql` (or similar), NEVER touching prior migration files
- `runbook/` — Phase 1 snapshot/restore/smoke discipline still applies for any Phase 3 install/migration against BEAAA. Bookend with `clarity-safety snapshot` + `clarity-safety gate` per Plan 01-03 protocol.

### Visual contract (non-throwaway design ground truth)

- **`sketches/paperclip-fix-bulletin.html`** — Layout truth-of-record. Plans MUST match: masthead (Fraunces font, "The Bulletin · Vol. I · No. N · {weekday} · {date} · 06:30 ET · prepared for Eric G., Editor-in-Chief"), Action Inbox card grid, two-column "Yesterday's Operations" main + "Standing Numbers" right rail, drop-cap on first department, dotted-rule between item rows, lineage thread as 8-column grid in the footer with arrow connectors, terminal node inverted (paper-on-ink), colophon footer matching `Compiled by Editorial-Desk` (PROJECT.md Editor-Agent rename rule).
- Warm-paper palette (paper/paper-2/ink/ink-2/muted/rule/terracotta/moss/gold). Fonts: Fraunces (display) + Newsreader (body) + JetBrains Mono (meta). Surface stylesheet scoped to `[data-clarity-surface="bulletin"]` per Phase 2 SCAF-06 / D-09.
- `sketches/paperclip-fix-task-detail.html` + `sketches/paperclip-fix-situation-room.html` — reference for how Phase 2 surfaces look in the same codebase (consistency across surfaces is a value driver per CLAUDE.md).

### Paperclip host docs (external — fetch from `paperclipai/paperclip` `master` branch)

- `doc/plugins/PLUGIN_SPEC.md` §10 — `page` slot (Bulletin route); §15 — capabilities (need: `data.read`, `actions.invoke`, `db.read`, `db.write` for plugin-namespace only); §17 — `routines[]` cron declaration (used as HINT only — D-12); §21.5 — migrations clause (still authoritative-guide-over-spec per Phase 2 D-02)
- `doc/plugins/PLUGIN_AUTHORING_GUIDE.md` — `routines[]` mechanics; `ctx.agents.managed.reconcile()` (Editor-Agent already reconciled in Phase 2; do not re-reconcile); `ctx.issues.create`, `ctx.issues.comments.create` (verify SDK shape during Phase 3 research)
- `packages/mcp-server/README.md` — Editor-Agent's MCP tools for reads; bulletin compile may need ADDITIONAL tools for: list activities in time window, list issues by state, run SQL against core tables. Verify in research.

</canonical_refs>

<specifics>
## Specific Ideas

- **Mockup is non-negotiable visual contract.** Plans must reference `sketches/paperclip-fix-bulletin.html` line numbers when specifying layout (see Phase 2 02-CONTEXT.md for the pattern).
- **DST test fixtures** must use `vi.setSystemTime()` (vitest) and the standard `luxon` `DateTime` interface. Test must run inside the existing `test/` directory structure (Phase 2 established the convention).
- **Standing Numbers panel content for v1** (suggested — planner refines per Phase 3 research into Paperclip core tables): MRR (sum of active subscriptions), Briefs Sent (count of `issue.type=trial-brief` resolved yesterday), Reply Rate (replies / outreach issues), Refund Rate (refunds / paying customers).
- **Self-loop filter** already filters `actor_id == editor_agent_id`; extend it to ALSO filter `cycle_window` activity rows that have `clarity:bulletin-*` tags so the next day's compile doesn't see yesterday's bulletin as "agent activity."
- **Errata UX** — minimum viable v1: a settings-page form (`/clarity-pack/settings`) with a "Add erratum to Bulletin No. {N}" affordance for the opted-in editor. Inline-on-bulletin UI is a v2 nice-to-have.
- **Cycle window edge cases:** if the prior cycle is missing (first ever compile, or compile gap), the lineage threads section renders a "First Edition" empty-state per the sketch's quiet-day pattern.

</specifics>

<deferred>
## Deferred Ideas

- **Inline-on-bulletin errata composer** — v2; v1 uses settings-page form
- **Multi-recipient bulletin (email / PDF send)** — v2 (`BULL-V2-01` in REQUIREMENTS.md)
- **Configurable cycle cadence** (twice-daily, weekly) — out of scope; 06:30 ET daily is locked in PROJECT.md Decision #6
- **Auto-promotion of "Requires Your Decision" cards** to Reader view's right-rail blocker panel — possible future linkage; out of scope here
- **Bulletin search across cycles** — handled by classic Paperclip issue search since bulletins persist as issues (D-16). No clarity-pack-specific search needed for v1.
- **Compile-on-demand** (Eric clicks "Compile now") — out of scope; the cron-driven cadence is the contract for v1
- **Department reconcile UI** — v1 fills the membership table via heuristic + manual SQL override; UI affordance deferred

</deferred>

---

*Phase: 03-daily-bulletin*
*Context synthesized 2026-05-15 from upstream artifacts (no /gsd:discuss-phase 3 run — yolo mode planning).*
