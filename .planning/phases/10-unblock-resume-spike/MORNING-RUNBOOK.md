# Phase 10 Spike — Morning Runbook (handoff 2026-06-01 night)

**Read me first.** Overnight I completed everything that does NOT touch live production. The live BEAAA run is the only thing left, and it needs you for ~5 minutes because the harness has a hard guardrail: **an autonomous agent cannot write to live prod, and cannot grant itself permissions — even with chat approval.** That's by design (it's exactly what a prompt-injection would attempt). So I prepped it all and stopped at the wall.

---

## What's DONE (committed locally, NOT yet pushed — push is also gated)

| Commit | What |
|---|---|
| `1a7fbd3` | Probe harness skeleton (Task 1) |
| `05680e2` | Dry-confirm A1/A3 + D-02 read-only stubs filled |
| `251cec1` | A1 422 fix — create needs `assigneeAgentId` + capture failure body |
| `589a5a6` | A1 assigns ONLY to sacrificial `SPIKE_PROBE_AGENT_ID` (never a real agent — D-02) |
| `656c43b` | Shape A + Shape B probes (three-signal + D-08 ladder) |
| `45c4a28` | Shape C + three-shape `main()` + teardown |

The probe (`scripts/spike/unblock-resume-spike-probe.mjs`, ~1766 lines) is fully armed: it runs the three shapes only when `SPIKE_PROBE_AGENT_ID` is set, judges every PASS by the three-signal rule, climbs the D-08 ladder minimal-first, and tears down all `[SPIKE 10]` residue.

## What we ALREADY learned (live dry-confirm, real data — see `10-03-SPIKE-FINDINGS.md`)

- **A3: agents are NOT mintable via bearer REST** (POST agents → 400 Validation error). You must hand-mint ONE sacrificial agent.
- **D-02 fidelity (200 issues scanned):** histogram `{done:166, in_review:10, blocked:13, in_progress:2, todo:2, cancelled:6, backlog:1}`. **Shape B (bare `status='blocked'`, empty `blockedByIssueIds`) is real and dominant — 13 of them** (e.g. BEAAA-1602). Shape A real (BEAAA-1047, in_progress-awaiting). **Shape C has NO real relation in the sample → construct synthetically.**
- **A1 is still inconclusive** only because the first create 422'd (missing assignee); the fix is in, and A1 gets answered the instant the sacrificial agent exists.

---

## THE MORNING: two ways to finish

### Option A — let me finish it (recommended; ~5 min of your time)

1. **Add this to `.claude/settings.local.json`** `permissions.allow` array (I couldn't write my own permissions — you must). This lets me run ssh/scp/git-push/browser without per-command denials:
   ```json
   "Bash(ssh:*)",
   "Bash(scp:*)",
   "Bash(git push:*)",
   "PowerShell(ssh:*)",
   "PowerShell(scp:*)",
   "mcp__plugin_playwright_playwright__browser_navigate",
   "mcp__plugin_playwright_playwright__browser_snapshot",
   "mcp__plugin_playwright_playwright__browser_click",
   "mcp__plugin_playwright_playwright__browser_type",
   "mcp__plugin_playwright_playwright__browser_fill_form",
   "mcp__plugin_playwright_playwright__browser_take_screenshot",
   "mcp__plugin_playwright_playwright__browser_evaluate",
   "mcp__plugin_playwright_playwright__browser_wait_for",
   "mcp__plugin_playwright_playwright__browser_press_key"
   ```
   (Or just start the session with the permission mode that lets me act, and stay nearby to approve the first prompt.)
2. **Hire ONE sacrificial agent** in the Paperclip UI (this is the one thing only you can do — A3 proved REST can't): name it exactly `Spike10 Sacrificial Probe [SPIKE 10]`, any role (individual contributor), report to anyone. *(If you'd rather I drive the browser to hire it via Playwright, say so — but the UI hire is 60 seconds for you and avoids flakiness.)*
3. **Tell me "continue."** I'll then: deploy the fixed probe (scp), run the dry-confirm (answer A1), run the full three-shape live run, write `10-03-SPIKE-FINDINGS.md`, close Phase 10, push to master, and start Phase 14.

### Option B — you run it yourself (no permission change)

1. Hire the `[SPIKE 10]` agent (step 2 above).
2. **Deploy the fixed probe** (LOCAL PowerShell):
   ```powershell
   scp "C:\Users\erezg\Documents\Claude\Projects\Clarity Pack\scripts\spike\unblock-resume-spike-probe.mjs" ariclaw:~/
   ```
3. **Run the full spike** (on the box, `root@AriClaw`) — auto-finds the agent by name, pins it, runs dry-confirm + all three shapes (~15-20 min incl. the 8-min reply windows):
   ```bash
   AUTH=/home/beai-agent/.paperclip/auth.json
   KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=Object.values(a.credentials||{})[0]||{};process.stdout.write(v.token||v.accessToken||v.bearerToken||v.apiKey||Object.values(v).filter(x=>typeof x==="string").sort((p,q)=>q.length-p.length)[0]||"")' "$AUTH")"
   PROBE_AGENT="$(curl -s -H "authorization: Bearer $KEY" "http://localhost:3100/api/companies/59f8876e-e729-4dda-98f9-1317c2b50492/agents" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a;try{a=JSON.parse(s)}catch{a=[]}const arr=Array.isArray(a)?a:(a.items||a.agents||a.data||[]);const m=arr.find(x=>/spike\s*10/i.test(x&&x.name||""));process.stdout.write(m&&m.id?m.id:"")})')"
   echo "probe agent: ${PROBE_AGENT:-NOT FOUND}"
   if [ -n "$PROBE_AGENT" ]; then
     PAPERCLIP_API_URL=http://localhost:3100 PAPERCLIP_API_KEY="$KEY" \
     PAPERCLIP_COMPANY_ID=59f8876e-e729-4dda-98f9-1317c2b50492 \
     SPIKE_PROBE_AGENT_ID="$PROBE_AGENT" \
       node ~/unblock-resume-spike-probe.mjs > 10-02-probe-output.txt 2>&1
     cat 10-02-probe-output.txt
   fi
   ```
4. **Paste the JSON back** — I'll write `10-03-SPIKE-FINDINGS.md`, close Phase 10, and move to Phase 14.

---

## Honest expectation-setting

- The **spike** (Phase 10) will finish fast once unblocked — minutes of compute.
- **Phase 14 (the actual unblock-resume feature) built + deployed by morning is not realistic in one unattended night** — it's a full implementation phase that the spike exists to de-risk, and I was wall-blocked from the live run for most of the night. I'll start it the moment the spike closes and push hard, but I won't pretend a deployed feature will be waiting. What WILL be waiting: a closed, honestly-recorded spike + a clear Phase 14 plan.
- Everything I did is confined to local code; **zero writes hit BEAAA or GitHub** (both gated). Your board is untouched.

— Claude, overnight 2026-06-01
