# Morning Handoff — Clarity Pack

**Date stamped:** 2026-05-07 overnight session
**Prepared for:** Eric (you)
**Prepared by:** Claude Opus 4.7 (autonomous overnight run, option C — no live host)
**Read time:** ~5 minutes
**Context expectation:** read this first; PROJECT.md and ROADMAP.md if you want more depth

---

## Where we ended

**`/gsd:new-project` is complete.** Six commits walked the project from idea to a 5-phase roadmap with 79 v1 requirements, all mapped, with research grounded against the live Paperclip repo (`master` branch, full PLUGIN_SPEC.md re-read, plus PLUGIN_AUTHORING_GUIDE.md, the kitchen-sink example, and the orchestration-smoke example).

**Phase 1 (Pre-Install Safety) is structurally complete with one non-autonomous step pending — your morning rehearsal drill.** All five SAFE requirements have landed code:

| Req | What | Status |
|---|---|---|
| SAFE-01 | One-command snapshot script | ✓ Done — `scripts/safety/cli.mjs snapshot` |
| SAFE-02 (a) | One-command restore script | ✓ Done — `scripts/safety/cli.mjs restore` |
| SAFE-02 (b) | **Restore rehearsed at least once** | ⚠ **Awaiting you (~30 min today)** |
| SAFE-03 | Smoke-test script | ✓ Done — `scripts/safety/cli.mjs smoke` + `verify` |
| SAFE-04 | Plain-English runbook | ✓ Done — `runbook/` (8 markdown files) |
| SAFE-05 | Pre-flight gate refusing stale-snapshot installs | ✓ Done — `scripts/safety/cli.mjs gate` |

**103/103 tests pass.** No partial work, no broken state.

---

## What you do today (before any clarity-pack action against your real BEAAA install)

**The rehearsal drill is the gate that unlocks Phase 2.** It must run against a non-production Paperclip — the fresh local clone you said you'd set up.

The full step-by-step is in [`runbook/rehearsal-drill.md`](runbook/rehearsal-drill.md) (15 numbered steps, ~30 minutes). The condensed version:

1. **Set up a fresh local Paperclip clone.** Use Paperclip's `pnpm onboard` for PGlite mode (the simplest path — no Postgres install required). Note the instance directory it creates (typically `~/.paperclip/instances/<id>/`).
2. **Take a snapshot of the fresh install:** `pnpm clarity-safety snapshot --paperclip-dir ~/.paperclip/instances/<id>`
3. **Modify state** so you can later prove restore worked (e.g., create a test issue in the local Paperclip).
4. **Stop the local Paperclip.**
5. **Restore the snapshot to a sibling staging dir** (the CLI does this automatically — your live `<id>/` is never touched): `pnpm clarity-safety restore <snapshot-id>`
6. **Start a sibling Paperclip on port 3101** pointing at the staged dir (the runbook walks you through this — Paperclip can run two instances side-by-side because they're filesystem-isolated).
7. **Verify the staging:** `pnpm clarity-safety verify <snapshot-id> --smoke-api-url http://localhost:3101` — this runs the 5-check smoke test, confirms plugin-list set-equality and version equality vs the manifest, and (only on PASS) atomically writes `verifiedAt` back into the snapshot manifest.
8. **Test the gate:** run `pnpm clarity-safety gate -- echo install-would-run-here` — should succeed (snapshot is fresh and verified). Then artificially age the snapshot's `verifiedAt` (the runbook shows you how) and re-run — should refuse.
9. **Append today's dated row to [`runbook/REHEARSAL.md`](runbook/REHEARSAL.md)** in the documented 9-column format (`| 2026-05-08 | 1 | Eric | <snapshot-id> | <restore-time> | PASS | <notes> |` etc.).

The signal that Phase 1 is fully closed: `grep -qE '^\| 20[0-9]{2}-' runbook/REHEARSAL.md` exits 0. Right now it exits 1 — that's the empty-template state.

**If anything fails:** capture the failure, stop, and tell me. I'll route to `/gsd:plan-phase 1 --gaps` to revise the relevant plan.

**If everything passes:** reply "approved — drill clean" and we move to Phase 2.

---

## What's in the repo right now

**21 commits.** Plus three pending changes (CLAUDE.md, config.json, HANDOFF.md) that I'm committing as the final overnight commit.

```
~ Documents/Claude/Projects/Clarity Pack/
├── .planning/
│   ├── PROJECT.md                           ← what + why + locked decisions + constraints
│   ├── REQUIREMENTS.md                      ← 79 v1 reqs across 11 categories, all mapped
│   ├── ROADMAP.md                           ← 5-phase plan (Phase 1 = SAFETY)
│   ├── STATE.md                             ← live project state
│   ├── config.json                          ← workflow config (YOLO, Quality/Opus, parallel, all gates on)
│   ├── PRIOR-DECISIONS.md                   ← your pre-project notes (preserved as input)
│   ├── HANDOFF.json                         ← harness-managed handoff state
│   ├── research/                            ← project-level research synthesis
│   │   ├── STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md
│   └── phases/01-pre-install-safety/
│       ├── 01-RESEARCH.md                   ← Phase 1 research (Opus)
│       ├── 01-01-PLAN.md, 01-01-SUMMARY.md  ← snapshot/restore plan + executor report
│       ├── 01-02-PLAN.md, 01-02-SUMMARY.md  ← smoke/verify plan + executor report
│       └── 01-03-PLAN.md, 01-03-SUMMARY.md  ← gate/runbook plan + executor report
├── scripts/safety/                          ← Phase 1 deliverable (NOT plugin code — runs standalone)
│   ├── package.json                         ← @clarity-pack/safety, ESM, Node ≥20
│   ├── cli.mjs                              ← entry: pnpm clarity-safety <subcommand>
│   ├── lib/                                 ← 11 .mjs source files
│   │   ├── manifest.mjs, paths.mjs, mode-detect.mjs
│   │   ├── snapshot.mjs, restore.mjs
│   │   ├── list.mjs, prune.mjs
│   │   ├── paperclip-api.mjs, paperclip-cli.mjs
│   │   ├── smoke.mjs, verify.mjs
│   │   └── gate.mjs
│   └── test/                                ← 11 test files, 103 tests, all passing
│       ├── *.test.mjs (one per lib module + cli)
│       └── fixtures/                        ← stub-paperclip-server + fake-instance trees
├── runbook/                                 ← the human-facing safety docs (8 files)
│   ├── README.md                            ← entry point
│   ├── install-walkthrough.md               ← every clarity-pack install bookended by snapshot
│   ├── rollback-walkthrough.md              ← if anything goes wrong
│   ├── rehearsal-drill.md                   ← TODAY'S TASK (15 steps, ~30 min)
│   ├── PLATFORMS.md                         ← Windows / macOS / Linux specifics
│   ├── REHEARSAL.md                         ← drill log (currently empty template)
│   ├── snapshot.sh, snapshot.ps1            ← one-command launchers
├── sketches/                                ← the four mockups (visual contract for Phases 2-4)
├── CLAUDE.md                                ← project context for future Claude sessions
└── HANDOFF.md                               ← this file
```

---

## Architectural decisions you should know about (so you can sanity-check tomorrow)

These came out of research and shaped the code:

1. **Paperclip's default branch is `master`, not `main`.** Every doc URL in PROJECT.md and PRIOR-DECISIONS.md was corrected. Don't re-introduce `/blob/main/...` references.
2. **Per-user opt-in for clarity-pack must be plugin-implemented, not host-toggled.** PLUGIN_SPEC §8 has no per-user install scope and no `user` scope in `plugin_state`. Phase 2 will create a `clarity_user_prefs` table.
3. **Editor-Agent must be a managed agent** (`agents[]` + `agents.managed` + `reconcile()`), NOT a DIY heartbeat loop. Coexistence guarantee #4 (governance parity) comes for free if we follow this.
4. **Same-origin trust model is the largest footgun.** Plugin UI runs as same-origin trusted JS — manifest capabilities gate worker calls but NOT direct UI fetch. Phase 2 day-1 work includes an ESLint rule failing CI on raw `fetch()` to host paths from `src/ui/**`. Codified in `SCAF-05`.
5. **`@paperclipai/mcp-server@^0.1.0` already exists** and exposes the Editor-Agent's read needs. The plugin doesn't import the MCP server as a library — it launches it as a child stdio process via `npx -y @paperclipai/mcp-server`.
6. **Stack pins are non-negotiable** (forced by plugin contract): React 19 (peer-only, never bundled), TS ^5.7.3, esbuild ^0.27.3, ESM-only, Node ≥20, shadcn `new-york`/neutral/lucide. Don't bundle Tailwind — inherit host CSS.
7. **CVE-2026-31802 is real** — node-tar before 7.5.11 has a Windows path-traversal vulnerability. Phase 1's restore code pins `tar@^7.5.15` AND rejects `SymbolicLink` and `Link` entries at extract time. There's a hand-crafted-malicious-archive test (R5/R6) that proves this.

---

## Phase 1 Plan-2 work that survived three deviations

Plan 01-01's executor caught and fixed three real bugs in the planned spec while implementing — these are documented in `.planning/phases/01-pre-install-safety/01-01-SUMMARY.md` under "Deviations from Plan":

1. **DSN password leak in pg_dump argv** — fix routes password via `PGPASSWORD` env, username via `PGUSER`, sanitized DSN to argv. Test S5 catches it.
2. **Sibling-staging design wiped live dir before restore** — fix extracts into `<home>/.clarity-safety-restore-<id>/` (a true tmp dir under home) and renames the inner subtree to staging; live dir is never touched. Test R3 catches it.
3. **node-tar swallows sync throws inside `onentry`** — fix records the violation + calls `entry.ignore()`, re-throws after `tar.x` resolves. Tests R5/R6 catch it.

All three are corrections from the planned design to safer real-world behavior. They're worth a 30-second skim before tomorrow's drill so the actual code matches your mental model.

---

## What's next after the drill

Once you reply "approved — drill clean":

1. **`/gsd:plan-phase 2`** in a fresh chat (`/clear` first — phase boundaries are the cleanest place to reset context).
2. Phase 2 is the BIG phase: 48 requirements covering scaffold + trust-model hardening + opt-in + shared primitives (reference resolver + deterministic blocker chain) + Editor-Agent skeleton + Reader view + Situation Room. Six of the seven internal sub-phases (scaffold, primitives, Editor-Agent, Reader view, Situation Room, opt-in) are unblocked the moment Phase 1 closes.
3. Phase 2's research will need a working local Paperclip to spike three open conflicts before the planner runs:
   - `detailTab` vs `taskDetailView` slot identity (which renders next to classic Paperclip tabs)
   - Plugin-owned migrations vs `plugin_state` (PLUGIN_SPEC §21 says out-of-scope; PLUGIN_AUTHORING_GUIDE.md and PR #5205 added them — verify by running a minimal migration)
   - Heartbeat cadence (verify empirically before TL;DR freshness SLA is set)
4. After Phase 2 ships and Reader view + Situation Room are running on your fresh Paperclip with you opted-in, Phases 3 (Bulletin), 4 (Chat), and 5 (Polish + Distribution) follow in sequence.

---

## Time-and-token receipt

| Stage | Wall-clock | Notes |
|---|---|---|
| `/gsd:new-project` | ~30 min | 4 parallel research agents, synthesis, requirements, roadmap |
| Phase 1 plan | ~25 min | research → planner → checker (1 revision) |
| Phase 1 execute | ~90 min | 3 plans, 9 tasks, 103 tests, 12 commits |
| Documentation + handoff | ~5 min | this file + final commit |

Total: ~2.5 hours of compute, ~21 commits, ~3000 lines of code, ~1500 lines of runbook prose. Zero changes to your live BEAAA Paperclip.

---

*Read `runbook/rehearsal-drill.md` next.*
