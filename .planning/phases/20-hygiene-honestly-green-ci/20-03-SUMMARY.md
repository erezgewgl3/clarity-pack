---
plan: 20-03
phase: 20
title: Verify two-source version 1.8.0 + confirm automated DO backups (HYG-04)
status: complete
completed: 2026-06-15
requirements: [HYG-04]
autonomous: false
---

# Plan 20-03 SUMMARY — HYG-04 closed

## Task 1 — Version label verify (read-only, no re-bump)
- `package.json` `version` === **1.8.0**; `src/manifest.ts` literal === **1.8.0**. Two sources agree; neither modified (D-02 honored — verify, not bump). Live BEAAA `plugin list` now also reads `version=1.8.0` after the 19-05 deploy.

## Task 2 — DO-backup confirmation (operator, the continuous-deploy bookend)
- **Operator confirmed automated DO backups are ON** for the AriClaw droplet with a recent successful snapshot (DigitalOcean → Droplets → AriClaw → Backups). The box has no safety-CLI / no psql, so the DO automated daily backup IS the rehearsed rollback bookend — and it was the verified bookend for the 19-05 v1.8.0 deploy.

HYG-04 fully closed: version label refreshed (1.8.0) AND automated DO backups confirmed ON.
