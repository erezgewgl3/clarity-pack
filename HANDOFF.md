# Handoff — Clarity Pack

**Last updated:** end of day 2026-05-08
**Read this first.** Then `HOSTINGER-COUNTERMOVES.md` if you want the production-VPS detail. Then `PROJECT.md` / `ROADMAP.md` if you want the clarity-pack-product detail.

---

## Plain-English status

- **Clarity Pack as a product:** Phase 1 (Pre-Install Safety) was structurally completed overnight 2026-05-07 with **103/103 tests passing**. The CLI ships at `scripts/safety/` and the human-facing runbook ships at `runbook/`. The only piece still pending is **the rehearsal drill itself** — a ~30-min manual run of `snapshot → restore-to-staging → smoke → verify → gate-test` that proves the safety discipline works end-to-end against a real Paperclip install.
- **The rehearsal target shifted today.** Original plan was "fresh local Paperclip on Eric's laptop via PGlite." The actual plan is now: **Hostinger VPS running production-grade Paperclip for a new project called Countermoves.** That box is more valuable as a rehearsal target because it mirrors what BEAAA's eventual production looks like (real Postgres, real TLS, real domain) instead of a throwaway local instance.
- **Where we paused:** end of Stage 8a on the Countermoves Hostinger setup. Infrastructure is fully prepped; Paperclip code is cloned and the database schema is applied (82 Drizzle migrations against `paperclip_countermoves`); the env vault has all three required variables (`DATABASE_URL` / `BETTER_AUTH_SECRET` / `SERVE_UI=true`); the only remaining step before Paperclip can start is the interactive `pnpm paperclipai onboard` wizard.

## Tomorrow's first 30 minutes

Open PowerShell:
```powershell
ssh -i $HOME\.ssh\countermoves_vps_ed25519 eric@82.29.197.74
```

In the SSH session:
```bash
cd ~/paperclip
export $(sudo cat /etc/paperclip/db.env | xargs)
pnpm paperclipai onboard
```

When the wizard's first prompt appears, paste it back to Claude. Pick the **Custom** path with:
- Bind: `loopback`
- Mode: `authenticated`
- Exposure: `public`
- Public URL: `https://countermoves.gl3group.com`

After onboard completes, start Paperclip (`pnpm dev` for now; systemd service later) and verify `https://countermoves.gl3group.com` loads from your laptop browser. Then take the first clean baseline snapshot via the clarity-pack safety CLI — that's the real Phase 1 rehearsal-drill execution.

## Two phases of work, in case you forget

1. **Build out the Countermoves Hostinger box.** Continues tomorrow with the onboard wizard, then Paperclip start, then snapshot baseline. Once `https://countermoves.gl3group.com` loads cleanly and a baseline snapshot is in the bag, this phase is done. **You're 80% of the way through.**

2. **Develop clarity-pack against Countermoves.** Phase 2 of the GSD plan — scaffold + primitives + Reader view + Situation Room + Editor-Agent skeleton + opt-in. ~48 requirements. Starts after phase 1 closes (rehearsal drill PASS recorded in `runbook/REHEARSAL.md`). Use `/clear` and run `/gsd:plan-phase 2` when you're ready.

## What does NOT change

- Phase 1 of clarity-pack is structurally complete. `scripts/safety/` ships ~3000 lines of code with 103 tests, all passing. The runbook is in place. Code is committed across 12 atomic commits ending at `9c3148d` (the SUMMARY for Plan 01-01 wave); subsequent plan-02 / plan-03 commits land at `f5e52c4` and `6d6b795` per the in-repo `.planning/phases/01-pre-install-safety/` SUMMARY files.
- BEAAA stays on its existing host. We don't touch BEAAA today, tomorrow, or until clarity-pack is proven on Countermoves.
- The Phase 1 deliverables remain reusable: when the time comes for BEAAA, we run the same safety CLI against BEAAA's host with the same runbook.

## Repo state at end of day 2026-05-08

```
24 git commits on master.
Working tree at end of session: HANDOFF.md updated, HOSTINGER-COUNTERMOVES.md added.
.planning/HANDOFF.json (harness-managed) and .gitignore (transient) flagged as modified by Git but managed externally — leave them.
```

The 24th commit is the morning handoff from yesterday plus the sketches commit. Today's work was overwhelmingly on the Hostinger VPS (a different machine entirely), not in this repo. The two new files in this commit (HOSTINGER-COUNTERMOVES.md + this updated HANDOFF.md) are the durable record of what happened on the remote box today.

## Detailed references

- **`HOSTINGER-COUNTERMOVES.md`** — every fact about the Hostinger box (IP, hostname, SSH key path, vault file, Postgres credentials, Caddy config, security posture, follow-up items). **Read this if anything goes weird with the VPS.**
- **`runbook/rehearsal-drill.md`** — the 15-step drill. Tomorrow we run this against the Countermoves Hostinger box (NOT a fresh local PGlite as it currently reads — the steps still apply, just point at the Hostinger Paperclip).
- **`.planning/PROJECT.md`** — clarity-pack project context, locked decisions, constraints.
- **`.planning/ROADMAP.md`** — the 5-phase roadmap; we're between Phase 1 and Phase 2.
- **`.planning/phases/01-pre-install-safety/01-0{1,2,3}-SUMMARY.md`** — per-plan executor reports including the 3 deviations Plan 01-01 caught and auto-fixed (DSN password leak, sibling-staging directory wipe, node-tar onentry sync-throw).

## Open follow-ups (carried forward)

1. Rotate the DB password and `BETTER_AUTH_SECRET` on the Hostinger box before any real Countermoves data lands. Both are in chat scrollback from today.
2. Convert Paperclip on the Hostinger box to a systemd service running as a dedicated `paperclip` system user.
3. Enable Postgres data-page checksums (requires cluster recreation; pre-go-live maintenance window).
4. Confirm Hostinger VPS auto-renew or calendar a reminder; expires 2028-05-08.
5. Update `runbook/rehearsal-drill.md` to reflect that the rehearsal target is the Countermoves Hostinger box (not a local PGlite). One markdown update.
6. Ubuntu Pro / ESM — revisit early 2029.

---

*If you `/clear` and start a fresh chat tomorrow: read this file, then say "I'm ready to resume on the Countermoves Hostinger box at the onboarding wizard step." Future Claude will pick up cleanly. Memory palace also has the build state under the `clarity_pack` and `countermoves` wings.*
