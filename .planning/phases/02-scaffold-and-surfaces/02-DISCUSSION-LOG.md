# Phase 2: Scaffold + Primitives + Reader View + Situation Room + Editor-Agent + Opt-In — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 02-scaffold-and-surfaces
**Areas discussed:** SPEC conflicts (blocking), Editor-Agent skeleton boundaries, Plan decomposition strategy
**Skipped (Claude's Discretion):** Day-1 trust-model hardening (defaults to research recommendations)

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Three SPEC conflicts (BLOCKING) | Slot identity, migrations approach, refresh cadence — must resolve before code | ✓ |
| Editor-Agent skeleton boundaries | Token cap, self-loop filter, circuit breaker, pause-banner UX | ✓ |
| Day-1 trust-model hardening | Bridge-only, ESLint, CSS scope, postinstall policy | — (deferred to Claude's Discretion) |
| Plan decomposition strategy | Smoke spike sequencing, plan count, wave parallelism | ✓ |

---

## Three SPEC Conflicts (Blocking)

### Reader view slot identity

| Option | Description | Selected |
|--------|-------------|----------|
| `detailTab` + `entityTypes:["issue"]` (Recommended) | Generic tab slot, filter to issues only. PLUGIN_SPEC §10.1. Verify in Plan 02-01 smoke. | ✓ |
| `taskDetailView` | Task-specific slot. Less documented; risk of slot drift. | |
| You decide — pick after smoke spike | Defer to Plan 02-01 smoke spike. | |

**User's choice:** `detailTab` + `entityTypes:["issue"]` (Recommended)
**Notes:** Choice is provisional — Plan 02-01 smoke spike must verify against fresh local Paperclip clone before locking. Captured as verification gate in D-01.

### Plugin migrations approach

| Option | Description | Selected |
|--------|-------------|----------|
| `database.migrationsDir` + plugin namespace (Recommended) | Plain SQL files scoped to `ctx.db.namespace`. Satisfies coexistence #3 + #6. Verify Phase 2.0 with minimal `001_init.sql`. | ✓ |
| `plugin_state` KV table only — no DDL | Stay strictly within PLUGIN_SPEC §21.5 letter. Serialize all state into JSON blobs. | |
| Hybrid — `plugin_state` for prefs, migrations for everything else | Mixed strategy. Complexity tax for marginal safety. | |

**User's choice:** `database.migrationsDir` + plugin namespace (Recommended)
**Notes:** PLUGIN_AUTHORING_GUIDE + working SDK code are authoritative over PLUGIN_SPEC §21.5's "out of scope" wording. Verification gate in D-02 requires a minimal `001_init.sql` (single `clarity_user_prefs` table) to apply cleanly via `paperclipai plugin install` in Plan 02-01.

### Situation Room refresh cadence

| Option | Description | Selected |
|--------|-------------|----------|
| 60s default, configurable via `instanceConfigSchema` (Recommended) | Conservative on agent budget. Matches PROJECT.md Decision #6. Active-viewer guard means polling only runs when needed. | ✓ |
| 30s default, configurable | Matches mockup. Doubles snapshot cost. | |
| 60s default, no `instanceConfigSchema` for v1 | Simpler; promote to configurable in Phase 5 polish. | |

**User's choice:** 60s default, configurable via `instanceConfigSchema` (Recommended)
**Notes:** Eric can tune via instance config without recompile if 60s feels stale during BEAAA dogfood.

---

## Editor-Agent Skeleton Boundaries

### Self-loop filter mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Filter by `author_id == editor_agent_id` (Recommended) | Cheapest, most deterministic. Drop rows where author equals agent before LLM. | |
| Filter by activity tag (`clarity:editor-write`) | Tag every write; filter by tag on read. Flexible for future multi-agent setups. | |
| Both — `author_id` check + tag belt-and-suspenders | Defense in depth. ~10 LOC, no downside. | ✓ |

**User's choice:** Both — `author_id` check + tag belt-and-suspenders
**Notes:** Tag will inherit naturally when Phase 4 chat-agent lands; pays the cost once.

### `max_tokens` hard cap per LLM call

| Option | Description | Selected |
|--------|-------------|----------|
| 4000 tokens (Recommended for v1) | Conservative for TL;DR + critical-path narratives. | |
| 2000 tokens | Aggressive cap; risk of truncation on complex issues. | |
| 8000 tokens | Headroom for long blocker chains. Costlier. | |
| You decide — measure first, set after Phase 2 dogfood | Ship 4000 placeholder, instrument, lock before Phase 3. | ✓ |

**User's choice:** You decide — measure first, set after Phase 2 dogfood
**Notes:** Captured as Claude's Discretion in D-05. Ship with 4000 placeholder; instrument P50/P95 token counts during Phase 2 dogfood; lock final value before Phase 3.

### Circuit breaker behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Set `agent.paused=true` via `ctx.agents.pause()`, banner until human resumes (Recommended) | Governance parity. Eric must explicitly resume in classic agent panel. | ✓ |
| Exponential backoff, no pause | Self-healing without intervention. Conflicts with SC#4's explicit pause language. | |
| Pause + auto-resume after 1 hour | Compromise. Adds clock dependency. | |

**User's choice:** Set `agent.paused=true` via `ctx.agents.pause()`, banner shown until human resumes (Recommended)
**Notes:** Uses Paperclip's standard pause primitive — no special privileges. "Failure" defined as: LLM call threw, OR token cap exceeded, OR output failed schema validation.

### Pause-banner UX

| Option | Description | Selected |
|--------|-------------|----------|
| Footer of every Clarity surface + classic agent panel pill (Recommended) | Discoverable from anywhere. Editorial Desk persona naming. | ✓ |
| Classic agent panel pill only | Stay minimalist on Clarity surfaces. Risks silent staleness for non-power-users. | |
| Situation Room footer + Reader view 'last compiled' staleness chip | Distributed UX; more code. | |

**User's choice:** Footer of every Clarity surface + classic agent panel pill (Recommended)
**Notes:** Footer is dismissible-per-session but reappears on next page load while paused. Persona name "Editorial Desk" per Decision #8.

---

## Plan Decomposition Strategy

### Phase 2.0 smoke spike

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — Plan 02-01 is smoke spike only (Recommended) | Minimal manifest + worker + `001_init.sql` + hello-world `detailTab`. No feature code. Empirically resolves three SPEC conflicts. | ✓ |
| Fold smoke into Plan 02-01 alongside scaffold | Faster end-to-end if everything works first try. Risk: bad outcome forces primitive rewrite. | |
| No spike — trust the recommendations and ship | Saves time. High blast radius if recommendations are wrong. | |

**User's choice:** Yes — Plan 02-01 is smoke spike only (Recommended)
**Notes:** ~3-5 days. Acceptance bar: plugin installs cleanly, tab renders on issue page, migration creates table in plugin namespace, plugin disable preserves table data. Bookended by snapshot/restore per Phase 1 protocol.

### Plan count for the rest of Phase 2

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans: scaffold+primitives, Editor-Agent+Reader, Situation Room+opt-in+CI (Recommended) | Inside-out per research SUMMARY.md. ~16 reqs each. Independent rehearsals. | ✓ |
| 2 plans: primitives, then both surfaces+editor+opt-in+CI | Tighter; lower commit count; harder rollback per surface. | |
| 4 plans: split surfaces, isolate CI as its own plan | Most granular; cleanest rollback; more session overhead. | |

**User's choice:** 3 plans: scaffold+primitives, Editor-Agent+Reader, Situation Room+opt-in+CI (Recommended)
**Notes:** Final plan count = 4 (smoke spike + 3 build plans).

### Coexistence verification CI placement

| Option | Description | Selected |
|--------|-------------|----------|
| Final plan of Phase 2, runs in CI from that plan forward (Recommended) | All six guarantees testable by then. One-time setup. Phase 3+ extends. | ✓ |
| First plan after smoke, runs in CI from day 1 | Half the checks would be NO-OP stubs. Higher early ceremony. | |
| Spread across plans — each plan adds its relevant checks | Distributed; matches deliverables; more CI config churn. | |

**User's choice:** Final plan of Phase 2 (02-04), runs in CI from that plan forward (Recommended)

---

## Claude's Discretion

- **Day-1 trust-model hardening details** — user opted not to discuss; research-recommended defaults apply (bridge-only host RPC, ESLint `no-raw-fetch-in-ui`, CSS scope via `[data-clarity-surface]`, pinned `pnpm-lock.yaml`, zero postinstall scripts). Surface to user in Plan 02-02 execution if implementation surfaces ambiguity.
- **`max_tokens` final value** — placeholder 4000 in v1, instrument and lock before Phase 3.
- **Loading skeletons, exact spacing, typography** within mockup tolerance.
- **TL;DR compile cadence details** beyond self-loop filter (debounce on rapid edits, max compiles per issue per hour).
- **Reader view "Anchored to" quote extraction algorithm** (length cap, ellipsis placement, multi-ref ordering).

---

## Deferred Ideas

- Reader view UX refinements beyond the mockups (drag-to-reorder AC, click-to-resolve blocker terminals) — Phase 5 or v1.x.
- Situation Room leader-election fallback for missing BroadcastChannel — Plan 02-04 detects and falls back to per-tab polling; deeper UX deferred.
- Opt-in CTA placement variants (single per-surface vs global top-bar vs first-time onboarding) — mockups imply per-surface; refine post-dogfood.
- `paperclip_restoring` DB auto-create in `restore.mjs` — Phase 1 deferred; v2 work.
- Plan 02-01 to add "Phase 2 install rehearsal" entry to `runbook/REHEARSAL.md` — note for Plan 02-01 author.
- AC auto-status promotion — Phase 5 work.
- Full-fidelity previewers (xlsx/pdf/md/png) — Phase 5 work.
