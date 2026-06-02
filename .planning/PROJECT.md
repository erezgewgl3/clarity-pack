# Clarity Pack

## What This Is

A **Paperclip plugin** named `clarity-pack` that adds four user-facing surfaces and one Editor-Agent on top of an unmodified Paperclip install. It is built for a solo founder running Paperclip's agent-driven org chart who needs plain-English clarity on what every employee is doing, what's blocking, and where artifacts live — without forking Paperclip.

The four surfaces are:

1. **Task Detail "Reader view"** — inline reference resolution, plain-English TL;DR, deliverable preview inline, goal ancestry breadcrumb, acceptance criteria auto-status.
2. **Situation Room** — live cockpit showing every agent's current state, plain-English blockers, transitively-resolved blocker chains ending in a single human action, artifact shelf.
3. **Daily Bulletin** — auto-compiled morning editorial digest of yesterday's operations + today's awaiting-you items.
4. **Employee Chat** — hybrid real-time UI where messages persist as comments on per-topic private issues; attachments stored as work-products.

The fifth piece is the **Editor-Agent** — a heartbeat-driven Paperclip employee (regular org-chart hire) that compiles the TL;DRs, critical-path narratives, and bulletins. The mockups already use the "Editor" / "Editorial Desk" voice; the Situation Room footer's prior `Compiled by Compiler-Agent` is renamed to match.

## Core Value

**Zero rabbit-holes.** Every cross-reference resolved inline, every blocker chain transitively flattened to a single named human action, every deliverable previewed in place. If anything else fails, this must hold: Eric should never have to click through three levels of unresolved task references to find out what one of his agents is stuck on.

## Current Milestone: v1.4.0 Truthful Situation Room

**Goal:** Make the Situation Room the one screen that truthfully tells Eric what's going on in the company — and lets him do what needs him, in place.

**Target features:**
- Honest blocker taxonomy (deterministic engine) — recognizes agent ownership, flattens transitively to the human at the end, classifies each blocked item instead of dumping everything to "unowned → assign owner."
- Editor-Agent named single action — grounded plain-English "what unblocks this + who + ~time," with a stale→degrade guardrail (never blanks, never fabricates urgency).
- Cockpit IA redesign — Pulse (one-line company status + vitals) → Needs-you (ranked by what it unblocks) → In-motion (calm) → Watch (quietly stalled).
- Reply-in-place + quick-decision chips that actually unblock + resume the agent.
- Kill the false "Assign owner" affordance except on genuinely-unowned / stuck-agent rows.

**Seed:** `docs/superpowers/specs/2026-06-01-situation-room-truthful-cockpit-design.md` (approved design).
**Open risk to de-risk first (spike):** does answering an agent (a comment) actually unblock + resume it, or is a status transition also required?

## Requirements

### Validated

<!-- All v1 scope shipped and live-verified on BEAAA across Phases 1–9. Final shipped version v1.3.0. -->

- ✓ **Surface 1 — Task Detail Reader view** — v1.0 (Phase 2), evolved through v1.2.2 no-rail redesign (Phase 9 rider). Additional tab on issue pages; inline ref-resolution, plain-English TL;DR, deliverable preview, goal ancestry, AC auto-status. Instance-agnostic ref-resolver landed Phase 7.
- ✓ **Surface 2 — Situation Room** — v1.0 (Phase 2) → spec-complete owner-resolution (Phase 6.1) → people-first cockpit v1.2.0 (Phase 8) → actionable cockpit v1.3.0 (Phase 9, hero Assign-owner mutates the real issue). Live agent state, transitively-flattened blocker chains ending in a named human action.
- ✓ **Surface 3 — Daily Bulletin** — v1.0 (Phase 3). DST-safe 06:30-ET two-pass compile (SQL-grounded facts → LLM pass-1 → deterministic verifier), Requires-Your-Decision inbox, lineage threads, errata first-class. Bulletin lineage filter + gloss landed Phase 7.
- ✓ **Surface 4 — Employee Chat** — v1.0 (Phase 4) + true-task (Phase 4.1) + Reader↔Chat bridge (Phase 4.2). Messages persist as ordinary `public.issue_comments`; optimistic send; attachments as work-products. 907 chat comments survived a plugin-disable coexistence drill.
- ✓ **Editor-Agent** — v1.0 (Phase 2). Managed Paperclip org-chart hire under standard governance (self-loop filter, token cap, circuit breaker, pause/terminate). Compiles TL;DRs, critical-path narratives, daily bulletin.
- ✓ **Per-user opt-in** — v1.0 (Phase 2). Profile toggle, default OFF; server-side opt-in check in every data/action handler; classic dashboard stays the default landing.
- ✓ **Schema is additive-only** — v1.0 (all phases). Plugin-namespace migrations only; disable/uninstall leaves data intact; `--purge` opt-in only. Verified at the DB layer (row counts byte-identical across disable/enable).
- ✓ **Plugin distribution** — v1.0. Installable via `paperclipai plugin install`. *Adjusted:* distribution is internal-only (local-tarball install); npm publish was dropped by decision — v1 audience is Eric on BEAAA.
- ✓ **Pre-install backup, snapshot, and rollback discipline** — v1.0 (Phase 1). Snapshot/restore/smoke-test CLI + rehearsed restore drill (Countermoves 2026-05-13 PASS). For BEAAA, the bookend is the DigitalOcean droplet backup + plugin-reinstall rollback (safety-CLI not installed on that box).
- ✓ **Honest blocker taxonomy (engine)** — Validated in Phase 11 (2026-06-02). Deterministic, agent-aware terminal taxonomy (8 kinds: awaiting-human / agent-working / agent-stuck / self-resolving / external / cycle / genuinely-unowned / unclassified) flattened transitively to the human at the end; degrade-safe per row; the single `verdict` source every surface reads. NO_UUID_LEAK enforced at every chain producer (scrub-before-return) with a render-scan regression guard. Verification 5/5 must-haves; gap-closure (CR-01 + WR/IN warnings) closed in 11-05..07.

### Active

<!-- v1.4.0 Truthful Situation Room. Detailed REQ-IDs + traceability in .planning/REQUIREMENTS.md. -->

- [ ] **"Needs you" tells the truth** — lists only human-actionable items; agent-working and self-resolving items are excluded.
- [ ] **Editor-Agent named single action** — grounded plain-English action + who + estimate, with stale→degrade fallback to the deterministic line.
- [ ] **Cockpit IA** — Pulse + Needs-you (ranked by what it unblocks) + In-motion (calm, legible) + Watch (quietly stalled).
- [ ] **Reply-in-place + quick-decision chips** that post to the agent and actually unblock + resume it.
- [ ] **Assign-owner suppression** — the control appears only on genuinely-unowned / stuck-agent rows.

Candidate follow-on (may fold in while reworking the action layer):
- [ ] **`R3-self-assign-one-assignee`** (minor) — "Take it myself" trips the host "one assignee" rule on already-agent-owned rows. Candidate fix: clear-then-assign, or "already owned by <agent>" messaging. Tracked in `phases/09-.../09-VERIFICATION.md`.

### Out of Scope

- **Replacing the original Paperclip UI** — Reader view is an additional tab, never a replacement. *Why:* coexistence guarantee; Eric's daily flow on BEAAA must not break.
- **Forking Paperclip core** — all functionality must live inside the plugin manifest's contribution surface. *Why:* enables clean uninstall and Clipmart shipping without merge debt.
- **Multi-tenant isolation work for v1** — Paperclip today is single-tenant, self-hosted, single-node. Clarity Pack v1 inherits that. *Why:* matches PLUGIN_SPEC.md's stated deployment model; broadening it is a separate project.
- **Default-on for existing users** — opt-in toggle is mandatory. *Why:* coexistence guarantee #1.
- **Special privileges for Editor-Agent** — must obey same budget caps, pause/terminate, audit log as any other employee. *Why:* coexistence guarantee #4 (governance parity).
- **Real-time chat protocol that does NOT persist to issue comments** — chat must be durable as ordinary threaded comments. *Why:* hybrid model decision (Decisions #1, #5); guarantees data survives plugin disable.
- **Clipmart submission criteria for v1** — accessibility audit, theming portability, multi-tenant safety, and public support story are deferred. *Why:* user picked "Just me on BEAAA" as v1 audience; Clipmart-readiness becomes its own milestone.
- **npm public-registry publish** — *invalidated during v1.0.0.* Distribution is internal-only via local-tarball install; the package is never published to npm and there is no public repo. *Why:* v1 audience is Eric on BEAAA only; a public package adds supply-chain and support surface with zero v1 benefit (see decision in `MEMORY.md` / `feedback_clarity-pack-internal-only-no-npm`).
- **Plugin UI sandboxing posture beyond Paperclip's default** — PLUGIN_SPEC.md states plugin UI bundles run as same-origin trusted JavaScript. Clarity Pack inherits that posture. *Why:* matches PLUGIN_SPEC.md; tighter sandboxing is a Paperclip-core change, not a plugin choice.

## Context

**Current state (after v1.0.0, 2026-06-01).** All four surfaces + the Editor-Agent are built, shipped, and live-verified on BEAAA (AriClaw DO droplet) at version **v1.3.0** — plugin UUID `a763176a-2f4d-4986-b190-b5151e42cc00`, additive-only plugin-namespace schema, coexistence proven (disable/uninstall preserves data). ~31,300 LOC TypeScript/TSX, 219 test files (~2,320 passing), 750 commits over ~25 days across 11 phases. Distribution is internal-only (local tarball; no npm). The Situation Room is the most-iterated surface (read-only board → owner-resolution → people-first → actionable cockpit where Assign-owner writes the real Paperclip issue). Known minor follow-on: self-assign on already-owned rows (`R3-self-assign-one-assignee`).

**Why this exists, in operational terms.** Paperclip's public roadmap explicitly lists five surfaces as ⚪ unbuilt: Artifacts & Work Products, Enforced Outcomes, Deep Planning, CEO Chat, Memory / Knowledge. Eric runs Paperclip on the BEAAA insurance project today and finds:

- The existing UI causes a "rabbit hole" of clicking through unresolved task references to understand any one task.
- Deliverable storage is unclear — where does the artifact live? which revision is current?
- "Where is each employee, what are they stuck on" is not surfaced — you have to hunt.
- Long blocker chains are not flattened — you can't see at a glance that a six-link chain ends with one decision Eric owes.

Clarity Pack closes those gaps without forking Paperclip.

**Existing artifacts in this repo.** Four non-throwaway HTML mockups in `sketches/` define the visual contract and information architecture for each surface — they are the design ground truth, not exploratory sketches:

- `sketches/paperclip-fix-task-detail.html` — Reader view of a task (Surface 1)
- `sketches/paperclip-fix-situation-room.html` — Live ops cockpit (Surface 2)
- `sketches/paperclip-fix-bulletin.html` — Editorial daily bulletin (Surface 3)
- `sketches/paperclip-fix-employee-chat.html` — Hybrid chat surface (Surface 4)

The mockups establish a consistent dark editorial aesthetic (Geist + Geist Mono + Instrument Serif fonts, warm-dark palette, no neon). Frontend phases must honor this visual contract.

**Reference repo and docs (Paperclip itself).**

- Source: https://github.com/paperclipai/paperclip
- Plugin spec: https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md (full spec re-read during project research — see `.planning/research/`)
- Authoring guide: https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_AUTHORING_GUIDE.md
- Related: `doc/SPEC.md`, `doc/SPEC-implementation.md`, `doc/PRODUCT.md`, `doc/CLI.md`, `doc/DATABASE.md`, `doc/CLIPHUB.md`, `doc/execution-semantics.md`, `doc/memory-landscape.md`
- **Branch note:** Paperclip's default branch is `master`, not `main`. Earlier project notes that referenced `/blob/main/...` URLs return 404 — always use `/blob/master/...` when fetching docs.

**Pre-project decisions locked in conversation** (now durable here):

| # | Decision | Where it shows up |
|---|---|---|
| 1 | Chat = hybrid (real-time UI, durable as issue comments + work-product attachments) | Surface 4 |
| 2 | Compile cadence = scheduled (06:30 daily Bulletin) + on-view recompute every 60s in Situation Room | Surface 2, Surface 3 |
| 3 | MVP scope = Reader view + Situation Room + Editor-Agent skeleton | Phase 1 of roadmap |
| 4 | Chat history UX = per-employee linear timeline + global search | Surface 4 |
| 5 | Default landing = Paperclip classic dashboard (clarity views are opt-in clicks) | Coexistence guarantee |
| 6 | Editor-Agent governance = standard agent rules (same caps, pause/terminate, audit log) | Editor-Agent |
| 7 | v1 audience = Eric on BEAAA only | This project's milestone |
| 8 | Editor-Agent has a named persona ("Editor-Agent" / Editorial Desk) | All four surfaces |

## Constraints

- **Tech stack**: TypeScript plugin, React + shadcn UI contributions (matches `ui/components.json` in paperclipai/paperclip). — **Why:** integrate into Paperclip's existing UI runtime without introducing a second framework.
- **Distribution**: npm package + `paperclipai plugin install clarity-pack`. Clipmart submission deferred. — **Why:** matches PLUGIN_SPEC.md install model and v1 audience scope.
- **Trust model**: Plugin UI bundles run as **same-origin JavaScript inside the main Paperclip app — treated as trusted code, not sandboxed**. Manifest capabilities gate worker-side host RPC calls but do NOT prevent plugin UI code from calling Paperclip HTTP APIs directly. — **Why:** stated in PLUGIN_SPEC.md; tightening it is out of scope.
- **Deployment model inherited from Paperclip**: single-tenant, self-hosted, single-node, filesystem-persistent. Runtime installs assume writable local filesystem + npm available + reachable package registry. — **Why:** PLUGIN_SPEC.md describes this as today's model; v1 will not broaden it.
- **Database**: Postgres migrations must be additive-only; plugin disable leaves data intact. — **Why:** coexistence guarantee #3 + #6.
- **Coexistence guarantees** (hard, all testable, must appear in Phase 1 SPEC.md):
  1. Per-user opt-in via profile toggle; default OFF for existing users.
  2. Original UI never replaced; Reader view is an additional tab.
  3. Schema is additive-only; plugin disable leaves data intact.
  4. Editor-Agent is a regular org-chart hire (no special privileges).
  5. Chat messages render as ordinary threaded comments in classic Paperclip UI.
  6. Clean uninstall preserves data; `--purge` flag is opt-in only.
- **Editor-Agent integration**: a Paperclip employee whose worker uses an MCP server package for issue/activity reads. Subject to standard agent budget caps and pause/terminate. — **Why:** governance parity (Decision #6).
- **Visual contract**: must match the four mockups in `sketches/`. — **Why:** non-throwaway design ground truth; consistency across surfaces is a value driver.
- **Bookended-by-snapshots rule**: every clarity-pack install, upgrade, schema migration, or agent registration that runs against the live BEAAA Paperclip instance MUST be bookended by a verified Postgres + filesystem snapshot taken immediately before, and a working rollback path verified at least once before any feature work ships. — **Why:** Paperclip is single-tenant filesystem-persistent (PLUGIN_SPEC.md's stated deployment model); the same-origin trust model means a misbehaving plugin can hit Paperclip APIs directly; uninstall semantics for additive Postgres migrations are not yet host-enforced (PLUGIN_SPEC §21 vs PR #5205 contradict each other per Pitfalls research). The cost of "I'll restore from backup" with no rehearsed restore path is unbounded; with a rehearsed path, it is bounded at minutes.
- **Stack pins are forced by the plugin contract** (per Stack research): React 19 (peer-only — do NOT bundle), TypeScript ^5.7.3, esbuild ^0.27.3, ESM-only, Node ≥20, shadcn `new-york`/neutral/lucide. Tailwind is inherited from host CSS — Clarity Pack does NOT ship its own Tailwind. — **Why:** PLUGIN_SPEC + ui/components.json + plugin-kitchen-sink-example dictate this; deviating breaks the same-origin trust model and bloats the bundle.
- **PLUGIN_SPEC.md re-read completed** during project research (full 1720-line spec read against `master` branch). Findings live in `.planning/research/` and must be reflected in Phase 1 SPEC.md.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Plugin form factor (no Paperclip fork) | Enables clean uninstall, Clipmart shipping later, zero merge debt against upstream. | ✓ Good — shipped entirely inside the manifest contribution surface; disable/uninstall preserve data (coexistence drills PASS). |
| Hybrid chat (real-time UI, durable as issue comments) | Captures both the immediacy of chat and Paperclip's auditability of issue comments without doubling storage. | ✓ Good — 907 chat comments survived a plugin disable unchanged; canonical write is `public.issue_comments`. |
| Editor-Agent as regular org-chart hire | Reuses existing agent governance; avoids special-case code paths and unaudited privilege. | ✓ Good — managed agent with self-loop filter + token cap + circuit breaker; no special privileges. Required an operation-issue/document-readback pattern (sessions were silently discarded) — see Phase 3 debug. |
| Default landing = Paperclip classic dashboard | Coexistence — Clarity views are opt-in clicks, never overrides; existing users see no change unless they enable the toggle. | ✓ Good — opt-in gate enforced server-side in every handler. |
| v1 audience = Eric on BEAAA | Scope discipline — Clipmart-readiness pulls in accessibility audit, theming portability, multi-tenant safety, and public support story; not a v1 fight. | ✓ Good — kept scope tight; also drove the npm-drop decision. |
| Editor-Agent named persona ("Editor-Agent") | Mockups already use editorial voice ("Compiled by Editor-Agent", "Editorial Desk · Internal"); a single named persona reads more coherently than a utility "Compiler" label. | ✓ Good — shipped as Editorial Desk across all surfaces. |
| Bulletin cadence = 06:30 ET scheduled + on-view recompute every 60s for Situation Room | Bulletin is editorial; daily cadence matches reading habit. Situation Room is operational; near-live cadence matches need without overwhelming compute. | ⚠️ Revisit — the Situation Room 60s materialized-snapshot job is dead-on-cold-start; the cockpit renders fresh-per-request instead (works, but the cache path is vestigial). Bulletin cadence good (DST-safe gate fixed a same-day string-compare bug). |
| Pre-install backup + rollback discipline before any production action | Paperclip is single-tenant filesystem-persistent and the plugin trust model is same-origin; the cost of an unrehearsed restore is unbounded. A first phase delivering snapshot/restore scripts and a working rollback drill caps that risk before any feature code touches BEAAA. | ✓ Good — Phase 1 CLI + rehearsed restore (Countermoves PASS). BEAAA itself uses DO-droplet-backup + plugin-reinstall rollback (safety-CLI absent on that box). |
| Distribution = internal-only (no npm publish) | v1 audience is one operator on one box; a public npm package adds supply-chain + support surface for zero v1 benefit. | ✓ Good (added v1.0.0) — ship via local-tarball `paperclipai plugin install`; no public repo. |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-02 — Phase 11 (Honest blocker taxonomy engine) complete and verified 5/5; gap closure 11-05..07 landed the NO_UUID_LEAK scrub-before-return fix.*
