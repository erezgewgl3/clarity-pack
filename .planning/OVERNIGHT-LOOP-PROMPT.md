# How to start the overnight autonomous session

When you're ready to walk away from the keyboard:

1. Open a **fresh Claude Code session** in this project directory.
2. Run `/clear` to start clean.
3. Paste the **entire block below** as a single message — this triggers `/loop` mode with full self-contained context.
4. Walk away. The session will auto-pace itself until it produces `.planning/OVERNIGHT-REPORT.md` or hits its iteration cap.
5. In the morning, read `.planning/OVERNIGHT-REPORT.md` first. Then deploy any committed fixes via the Path B Web Console flow (flip repo public → run the same `BEAI_DEPLOY` heredoc → flip repo private).

---

## The prompt to paste

```
/loop You are running an autonomous overnight session to fix a known bug in clarity-pack v1.0.0 on BEAAA. The complete brief is at .planning/OVERNIGHT-FIX-BRIEF.md — read it first, in full, before any other action.

CONSTRAINTS (non-negotiable):
- NO production deploys. No scp, no ssh to ariclaw, no DO Web Console attempts.
- NO STATE.md / ROADMAP.md / REQUIREMENTS.md edits.
- NO repo visibility changes (repo is private; keep it private).
- NO destructive git ops; no force-push; no amend; no --no-verify.
- NO version bump on package.json or src/manifest.ts:337 (v1.0.0 is shipped).
- Respect Claude Code auto-mode classifier blocks. If blocked, stop and document. Do not work around.

TASK PRIORITY:
1. PRIMARY: fix the Reader crash on YAML-shaped artifact-spec issue bodies (BEAAA-828 repro). Per the brief — diagnose, add a regression test, defensive-fix the offending UI component, push to GitHub master.
2. SECONDARY: only after primary is shipped, investigate the "Compiling TL;DR…" placeholder never resolving (Editor-Agent compile job). If diagnosis exceeds ~2 cycles, document and stop.

SUCCESS = .planning/OVERNIGHT-REPORT.md written per the template in the brief, committed and pushed to GitHub master.

ITERATION CAP: 10 cycles. If you cannot reproduce or cannot fix within 10 cycles, document the partial progress in OVERNIGHT-REPORT.md and stop.

START NOW: read .planning/OVERNIGHT-FIX-BRIEF.md in full, then create a TodoWrite list, then proceed.
```

---

## What this prompt does

- `/loop` is Claude Code's dynamic-pacing autonomous mode. The agent self-schedules wake-ups (60s–60min) and continues working until you stop it or it finishes.
- The "read the brief first" instruction forces the agent to load full context before acting.
- The constraints prevent any production accidents while you sleep.
- The iteration cap prevents infinite loops on a wedged hypothesis.

## To stop the session early

When you're back, type any message in the same session window. The loop pauses for your input.

## What to check in the morning

```
# In PowerShell from the repo root:
type .planning\OVERNIGHT-REPORT.md
git log --oneline origin/master..HEAD ; git log --oneline -10
```

If OVERNIGHT-REPORT.md says SHIPPED:
- The fix is committed and pushed to GitHub
- Deploy via Path B: flip repo public → DO Web Console → paste the BEAI_DEPLOY heredoc → flip repo private
- Playwright-verify Reader renders on BEAAA-828

If OVERNIGHT-REPORT.md says PARTIAL or BLOCKED:
- Read the diagnosis section
- Decide whether to continue in a fresh session or hand to me with that context
