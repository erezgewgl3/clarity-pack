# Clarity Pack — Living Retrospective

## Milestone: v1.0.0 — v1 Final Internal

**Shipped:** 2026-06-01
**Phases:** 11 (1, 2, 3, 4, 4.1, 4.2, 5, 6.1, 7, 8, 9) | **Plans:** 67 | **Tasks:** 110
**Final version:** v1.3.0 (live on BEAAA / AriClaw) | **750 commits** · ~31,300 LOC TS/TSX · 219 test files · ~25 days

### What Was Built

Four user-facing Paperclip surfaces (Reader view, Situation Room, Daily Bulletin, Employee Chat) plus a governed Editor-Agent, on an unmodified Paperclip install. Same-origin trust model hardened, additive-only plugin-namespace schema, coexistence verified at the DB layer. The Situation Room evolved across four phases from a read-only status board into an actionable cockpit whose hero Assign-owner path performs the plugin's first live core-issue mutation.

### What Worked

- **Live drills as the real verification gate.** Every phase closed on a Playwright/operator drill against a live instance (Countermoves, then BEAAA), not just a green unit suite. This repeatedly caught defects that unit tests with permissive fakes missed — most sharply the Phase 9 R3 leaf-UUID bug (human-key vs UUID) that only the first *live* core-issue mutation exposed.
- **TDD RED-first reproduction of live failures.** The 09-04 fix wrote a UUID-strict fake that reproduced the live `ASSIGN_FAILED` before the source change — turning a live-only bug into a permanently-guarded unit test.
- **Bounded blast radius from day 1.** Phase 1's rehearsed snapshot/restore discipline meant every BEAAA deploy had a known rollback. No production scare across 11 phases.
- **Additive-namespace schema discipline.** "Plugin disable/uninstall preserves data" held across every coexistence drill (907 chat comments survived a disable unchanged).

### What Was Inefficient

- **Self-evaluation blind spots in subagents.** Executors reported "Self-Check: PASSED" on work that later needed live correction (Reader↔Chat bridge styling, the R3 mutation). The fix was always an independent drill, not more self-checks.
- **The Editor-Agent invocation saga (Phase 3, Plans 03-06→03-10).** Significant rework discovering that the host silently discards session prompts; the working pattern is an operation-issue + document-readback. Cost several gap-closure cycles.
- **Operator-environment friction during deploys.** sshd MaxStartups connection-burst throttling (misread as fail2ban) cost a detour mid-Phase-9 deploy; the fix was one persistent tunnel instead of rapid short-lived SSH connections.
- **Cross-platform tooling rough edges.** The open-artifact audit's `requireSafePath` wrapper false-flags complete quick-tasks on long Windows paths (root-caused at milestone close, not fixable without patching the plugin).

### Patterns Established

- **Display-id vs mutation-id separation** — human keys (`BEAAA-NN`) for display/log/echo; UUIDs for `ctx.issues.update`, carried as a sibling field, never derived from `.identifier` (NO_UUID_LEAK).
- **Shared dispatch component carries the action contract** — the owner-picker popover is the single dispatch site; threading a field into the rows but not the popover dispatch leaves it `undefined` at runtime (the 09-04 wiring-tie lesson).
- **Snapshot-bookended live deploys** with a verified rollback target as the standing release ritual.
- **`status:` frontmatter must be machine-readable** — prose/uppercase status lines defeat audit tooling.

### Key Lessons

1. A green unit suite with permissive fakes is necessary but not sufficient; the first *live* exercise of a new capability (especially a real write) is where the truth surfaces.
2. When closing a gap, prove the RED reproduces the *live* failure, not just a plausible one.
3. "Unowned" in a blocker-chain cockpit means the *blocker* is ownerless, not that the surfaced issue is unassigned — domain semantics matter for what a drill can even test (the self-assign one-assignee discovery).
4. Trust the operator's framing of environment problems ("it hangs forever") — it disambiguated throttling from a ban faster than my guessing did.

### Cost Observations

- Model mix: predominantly Opus (executor + orchestrator) with Sonnet for verification agents.
- Distribution stayed internal-only by decision — no npm/supply-chain surface for a one-operator audience.
- Most-iterated surface by far: the Situation Room (4 phases: 6.1 → 7 → 8 → 9).

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Final version | Headline |
|-----------|--------|-------|---------------|----------|
| v1.0.0 | 11 | 67 | v1.3.0 | Four surfaces + Editor-Agent live on BEAAA; Situation Room becomes an actionable cockpit |

*(First milestone — trends accumulate from here.)*
