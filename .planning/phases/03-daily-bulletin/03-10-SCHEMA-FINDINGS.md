# Plan 03-10 — Live Paperclip Schema Findings (Standing-Number Drift)

**Captured:** 2026-05-17
**Source:** `\d` introspection of the live Countermoves Paperclip instance (`paperclip_countermoves`, run as the `postgres` role) — ground truth, not the host repo or a guess.
**Purpose:** Replace the invented column references in `STANDING_NUMBER_SLOTS` that failed the Plan 03-09 closure drill. This file is the planner's and plan-checker's authoritative schema reference — **no column may be used that is not confirmed present below.**

---

## 1. What failed (Plan 03-09 closure re-drill, 2026-05-17)

`verifyDraft` pass-2 ran the 5 standing-number `ctx.db.query` calls; all 5 failed at the host RPC layer:

| Slot | SQL referenced | Failure |
|---|---|---|
| `mrr` | `companies.active_subscription_cents` | `column "active_subscription_cents" does not exist` |
| `briefs_sent_week` | `issues.tags` | `column "tags" does not exist` |
| `reply_rate_7d` | `issues.tags`, `issue_comments.author_role` | `column "tags" does not exist` |
| `discoveries_7d` | `issues.tags` | `column "tags" does not exist` |
| `refund_rate_30d` | `issues.tags` | `column "tags" does not exist` |

Root cause: the 5 slots were written against a **CRM/SaaS-business mental model** (recurring revenue, cold-email outreach, discovery calls, refunds). Paperclip is an **agent-orchestration platform** — its schema models agents, issues, heartbeat runs, costs, and budgets. It has no customer, subscription, or sales data. `standing-numbers.ts` itself flagged this: *"the EXACT column references below are sensible v1 defaults … Plan 03-03's Countermoves dry-run validates the real schema and refines the SQL."* That validation pass never landed.

This is **sanctioned by `03-CONTEXT.md` line 92**: *"the planner picks the actual 4–6 numbers for v1 based on what Paperclip core tables actually expose (TBD via Phase 3 research). All must be SQL-derivable."* The 5 numbers are **not locked** — only the registry SHAPE and BULL-05 (SQL-derivable, grep-able, never LLM-generated) are.

---

## 2. Verified live schema (columns confirmed present)

### `public.companies`
`id` uuid · `name` text · `description` text · `status` text · **`budget_monthly_cents` integer** · **`spent_monthly_cents` integer** · `created_at` · `updated_at` · `issue_prefix` text · `issue_counter` integer · `require_board_approval_for_new_agents` bool · `brand_color` · `pause_reason` · `paused_at` · `feedback_data_sharing_*` · `attachment_max_bytes` integer

> **No revenue/subscription/MRR column exists.** `budget_monthly_cents` / `spent_monthly_cents` are the company's *agent-spend budget*, not customer revenue.

### `public.issues`
`id` uuid · **`company_id` uuid** · `project_id` · `goal_id` · `parent_id` · `title` · `description` · **`status` text** (default `'backlog'`) · **`priority` text** (default `'medium'`) · `assignee_agent_id` uuid · `created_by_agent_id` · `created_by_user_id` · `request_depth` int · `billing_code` text · `started_at` tstz · **`completed_at` tstz** · `cancelled_at` tstz · **`created_at` tstz** · **`updated_at` tstz** · `issue_number` int · `identifier` text · **`hidden_at` tstz** · `origin_kind` text · `origin_id` · `work_mode` text · (+ execution_*, monitor_*, checkout/execution run cols)

> **No `tags`, `labels`, `category`, or JSONB `metadata` column.** Issue categorization, if any, is via the `issue_labels` join table (see §3 — empty on Countermoves).
> Verified `status` value domain (from index predicates): `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`. "Open" = `status NOT IN ('done','cancelled')`.

### `public.issue_comments`
`id` uuid · `company_id` uuid · `issue_id` uuid · `author_agent_id` uuid · `author_user_id` text · `body` text · `created_at` tstz · `updated_at` tstz · `created_by_run_id` uuid · **`author_type` text** · `presentation` jsonb · `metadata` jsonb

> **No `author_role` column.** There is `author_type` (values not enumerated here — likely `agent`/`user`/`system`; no CRM "prospect" concept exists).

### `public.finance_events`
`id` · `company_id` · `agent_id` · `issue_id` · `project_id` · `goal_id` · `heartbeat_run_id` · `cost_event_id` · `billing_code` · `description` · `event_kind` text · `direction` text (default `'debit'`) · `biller` text · `provider` · `model` · `quantity` int · `unit` · **`amount_cents` integer** · `currency` text · `estimated` bool · `external_invoice_id` · `metadata_json` jsonb · **`occurred_at` tstz** · `created_at`

> This is **agent-cost accounting** (LLM/compute debits), not SaaS revenue. Usable as a *spend* source if desired; **not** an MRR/refund source.

### `public.labels` / `public.issue_labels`
`labels`: `id` · `company_id` · `name` text · `color` text · timestamps.
`issue_labels`: `issue_id` · `label_id` · `company_id` · `created_at` (PK = `issue_id, label_id`).

> **Both tables are EMPTY on Countermoves (0 rows).** No label has ever been created. Any standing number derived from a `labels` join would return a permanent zero. Label-based business metrics are **not viable** for v1.

---

## 3. Conclusion — the pivot

There is **no customer/revenue/sales data in Paperclip's schema**. The Standing Numbers must measure **agent operations** — what Paperclip natively tracks. There is no genuine product fork here; the data dictates it.

## 4. Recommended replacement set (planner finalizes per CONTEXT line 92)

All 5 use **only columns confirmed in §2**. `$1` = `companyId` (the sole bound param — keep the T-03-10 SQL-injection invariant: static module-constant strings, no template literals).

| key | displayName | format | SQL (`$1` = companyId) |
|---|---|---|---|
| `open_issues` | Open issues | `count` | `SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status NOT IN ('done','cancelled') AND hidden_at IS NULL` |
| `completed_7d` | Issues completed · 7d | `count` | `SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'done' AND completed_at >= now() - interval '7 days'` |
| `blocked_issues` | Blocked · awaiting action | `count` | `SELECT COUNT(*)::int AS value FROM public.issues WHERE company_id = $1 AND status = 'blocked' AND hidden_at IS NULL` |
| `agent_spend_mtd` | Agent spend · MTD | `currency` | `SELECT ROUND(COALESCE(spent_monthly_cents,0) / 100.0)::bigint AS value FROM public.companies WHERE id = $1` |
| `budget_used_pct` | Budget used · MTD | `pct` | `SELECT CASE WHEN COALESCE(budget_monthly_cents,0) = 0 THEN 0 ELSE spent_monthly_cents::numeric / budget_monthly_cents::numeric END AS value FROM public.companies WHERE id = $1` |

`blocked_issues` deliberately ties to Clarity Pack's core value ("what's blocking, what awaits you"). The set avoids `agents` and `heartbeat_runs` **on purpose** — their columns were not introspected, so using them would reintroduce the invented-column risk. If the planner wants an "active agents" number it MUST first obtain `\d public.agents` from a live query; do not guess.

### Currency-format note (latent bug to fix, not carry forward)
`facts-table.ts` `formatFact` for `'currency'` does `Intl.NumberFormat(..., {style:'currency'})` on `Number(value)` — i.e. it treats the value as **dollars**. The old `mrr` slot passed **cents** (`SUM(active_subscription_cents)`) straight in — a latent ×100 error. The `agent_spend_mtd` SQL above converts cents→dollars (`/ 100.0`) so the formatter is correct. Keep that conversion.

---

## 5. Scope of Plan 03-10 (tight — do NOT widen)

**In scope:**
- Rewrite `STANDING_NUMBER_SLOTS` in `src/worker/bulletin/standing-numbers.ts` — 5 new slot defs (keys/displayNames/SQL/format) per §4. This single array is the shared source of truth for **both** `computeStandingNumbers` and `bulletin-verifier.ts` `verifyDraft`, so the verifier is fixed automatically.
- Update tests that assert the old keys (`mrr`/`briefs_sent_week`/…): `test/worker/bulletin/standing-numbers*.test.mjs`, the standing-numbers source-grep test (the `/\$\{[^}]*\}/` no-template-literal assertion still must hold), and any verifier/compile-pass fixture keyed to the old slot names.
- Check the pass-1 compile prompt / Editor-Agent instructions for **hardcoded references to the old slot keys or CRM number names** — the facts table is built from `STANDING_NUMBER_SLOTS` results, so the keys flow through automatically, but any prose example or schema doc naming `mrr` etc. must be updated.
- Version bump (`0.5.0` → `0.6.0`) in `src/manifest.ts` + `package.json`; rebuild all three artifacts; `npm pack`.
- A blocking `checkpoint:human-verify` closure re-drill on Countermoves (the only proof — the local suite's host-faithful fakes return canned `db.query` results and CANNOT catch schema drift; that is exactly how this bug and the 03-08 bug both reached a live drill green-locally).

**Explicitly OUT of scope — do NOT reopen:**
- `facts-table.ts` — verified pure (no SQL, no columns); untouched.
- The Option B document-handoff (Plan 03-08) and the structure-only readback (`validateDraftStructure`, Plan 03-09) — both FULLY PROVEN live on the 2026-05-17 drill. Untouched.
- `verifyDraft`'s strict reject-on-`query_failed` behaviour — correct (BULL-05/06: a wrong/unverifiable number must never publish). The fix is correct SQL, not laxer verification.

**Requirements:** Plan 03-10 closes the standing-numbers defect in **BULL-05** (SQL-derived numbers) and **BULL-06** (verifier pass-2 re-runs the SQL); a passing closure drill unblocks Phase 3 / BULL-09 closure.
