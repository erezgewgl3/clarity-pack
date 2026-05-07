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

## Requirements

### Validated

(None yet — ship to validate)

### Active

<!-- v1 scope. Roadmap will decompose these across phases. -->

- [ ] **Surface 1 — Task Detail Reader view** added as an additional tab on issue pages (does not replace classic UI). Inline reference resolution, plain-English TL;DR, deliverable preview inline, goal ancestry breadcrumb, acceptance criteria auto-status.
- [ ] **Surface 2 — Situation Room** route renders live agent state for every Paperclip employee; transitively-resolved blocker chain panel; critical-path strip; artifact shelf. Auto-recompute every 60s on view.
- [ ] **Surface 3 — Daily Bulletin** auto-compiled at 06:30 ET each morning; editorial digest of yesterday's operations + today's awaiting-you items; "Requires Your Decision" inbox.
- [ ] **Surface 4 — Employee Chat** hybrid surface: real-time UI; messages persist as ordinary issue comments on per-topic private issues; attachments stored as work-products; per-employee linear timeline + global search.
- [ ] **Editor-Agent** ships as a regular Paperclip org-chart hire under standard agent governance (same budget caps, pause/terminate, audit log). Heartbeat-driven; produces TL;DRs, critical-path narratives, and the daily bulletin.
- [ ] **Per-user opt-in** via Paperclip profile toggle; default OFF for existing users; classic Paperclip dashboard remains the default landing surface.
- [ ] **Schema is additive-only**; plugin disable leaves data intact; clean uninstall preserves data; `--purge` flag is opt-in only.
- [ ] **Plugin distribution** as an npm package installable via `paperclipai plugin install clarity-pack`; v1 audience is Eric on BEAAA only (Clipmart submission is deferred).

### Out of Scope

- **Replacing the original Paperclip UI** — Reader view is an additional tab, never a replacement. *Why:* coexistence guarantee; Eric's daily flow on BEAAA must not break.
- **Forking Paperclip core** — all functionality must live inside the plugin manifest's contribution surface. *Why:* enables clean uninstall and Clipmart shipping without merge debt.
- **Multi-tenant isolation work for v1** — Paperclip today is single-tenant, self-hosted, single-node. Clarity Pack v1 inherits that. *Why:* matches PLUGIN_SPEC.md's stated deployment model; broadening it is a separate project.
- **Default-on for existing users** — opt-in toggle is mandatory. *Why:* coexistence guarantee #1.
- **Special privileges for Editor-Agent** — must obey same budget caps, pause/terminate, audit log as any other employee. *Why:* coexistence guarantee #4 (governance parity).
- **Real-time chat protocol that does NOT persist to issue comments** — chat must be durable as ordinary threaded comments. *Why:* hybrid model decision (Decisions #1, #5); guarantees data survives plugin disable.
- **Clipmart submission criteria for v1** — accessibility audit, theming portability, multi-tenant safety, and public support story are deferred. *Why:* user picked "Just me on BEAAA" as v1 audience; Clipmart-readiness becomes its own milestone.
- **Plugin UI sandboxing posture beyond Paperclip's default** — PLUGIN_SPEC.md states plugin UI bundles run as same-origin trusted JavaScript. Clarity Pack inherits that posture. *Why:* matches PLUGIN_SPEC.md; tighter sandboxing is a Paperclip-core change, not a plugin choice.

## Context

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
- Plugin spec: https://github.com/paperclipai/paperclip/blob/main/doc/plugins/PLUGIN_SPEC.md (re-read full spec during research; partial read already done — see Constraints below)
- Related: `doc/SPEC.md`, `doc/SPEC-implementation.md`, `doc/PRODUCT.md`, `doc/CLI.md`, `doc/DATABASE.md`, `doc/CLIPHUB.md`, `doc/execution-semantics.md`, `doc/memory-landscape.md`

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
- **PLUGIN_SPEC.md re-read required before SPEC.md is finalized for Phase 1.** Partial read already done; full spec was 64KB and must be revisited to surface any missed constraints. — **Why:** flagged action item in PRIOR-DECISIONS.md.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Plugin form factor (no Paperclip fork) | Enables clean uninstall, Clipmart shipping later, zero merge debt against upstream. | — Pending |
| Hybrid chat (real-time UI, durable as issue comments) | Captures both the immediacy of chat and Paperclip's auditability of issue comments without doubling storage. | — Pending |
| Editor-Agent as regular org-chart hire | Reuses existing agent governance; avoids special-case code paths and unaudited privilege. | — Pending |
| Default landing = Paperclip classic dashboard | Coexistence — Clarity views are opt-in clicks, never overrides; existing users see no change unless they enable the toggle. | — Pending |
| v1 audience = Eric on BEAAA | Scope discipline — Clipmart-readiness pulls in accessibility audit, theming portability, multi-tenant safety, and public support story; not a v1 fight. | — Pending |
| Editor-Agent named persona ("Editor-Agent") | Mockups already use editorial voice ("Compiled by Editor-Agent", "Editorial Desk · Internal"); a single named persona reads more coherently than a utility "Compiler" label. | — Pending |
| Bulletin cadence = 06:30 ET scheduled + on-view recompute every 60s for Situation Room | Bulletin is editorial; daily cadence matches reading habit. Situation Room is operational; near-live cadence matches need without overwhelming compute. | — Pending |

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
*Last updated: 2026-05-07 after initialization*
