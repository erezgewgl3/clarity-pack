# Clarity Pack

A Paperclip plugin that adds four user-facing surfaces and one Editor-Agent on top of an unmodified Paperclip install — built for solo founders running Paperclip's agent-driven org chart who need plain-English clarity on what every employee is doing, what's blocking, and where artifacts live.

**Core value: zero rabbit-holes.** Every cross-reference resolved inline; every blocker chain transitively flattened to a single named human action; every deliverable previewed in place.

## What it adds

| Surface | What you get |
|---------|--------------|
| **Reader view** (issue Detail tab) | Inline reference resolution, plain-English TL;DR, deliverable preview inline, goal ancestry breadcrumb, acceptance criteria checklist. |
| **Situation Room** | Live cockpit showing every agent's current state, plain-English blockers, transitively-resolved blocker chains ending in a single human action, artifact shelf. |
| **Daily Bulletin** | Auto-compiled morning editorial digest of yesterday's operations + today's awaiting-you items. Published at 06:30 ET. |
| **Employee Chat** | Hybrid real-time chat with each employee-agent; messages persist as comments on per-topic private issues. Reader↔Chat deep-link bridge ships in v0.9.x. |
| **Editor-Agent** | A regular Paperclip employee (org-chart hire) that compiles the TL;DRs, critical-path narratives, and bulletins. Heartbeat-driven via the standard agent registration path. |

## Install

```bash
pnpm paperclipai plugin install clarity-pack@1.0.0-rc.1
```

If `pnpm paperclipai plugin install` rejects the tarball with `Missing package.json` (it expects a package directory, not an npm tarball), use the bundled unpack helper:

```bash
bash <(curl -sL https://raw.githubusercontent.com/eric-g/clarity-pack/master/scripts/install-helper.sh) clarity-pack-1.0.0-rc.1.tgz
```

The helper unpacks the tarball into a temp directory and passes the directory path to `pnpm paperclipai plugin install`. It runs from the unpacked tree; `pnpm paperclipai` must be invoked from `~/paperclip` (Paperclip's workspace root).

## Opt in (per-user)

Clarity Pack defaults to **OFF** for every existing user. To enable it for your account:

1. Open the **profile/settings** page in Paperclip.
2. Toggle **Enable Clarity Pack surfaces** to ON.
3. Reload. The Reader view detail-tab, the Situation Room, the Daily Bulletin, and the Employee Chat surfaces will mount.

Toggling OFF leaves all plugin data intact — your `chat_topics`, TL;DRs, bulletins, and acceptance-criteria checklist state remain in their plugin-namespaced Postgres schema. Re-enabling restores everything exactly as it was.

## Rollback

Plugin upgrades and uninstalls on a live Paperclip instance MUST be bookended by a verified Postgres + filesystem snapshot. Clarity Pack ships the safety CLI for exactly this:

```bash
# 1. Snapshot before any mutation.
node scripts/safety/cli.mjs snapshot --db-url="$DB_URL" --instance="$INSTANCE_DIR"

# 2. Verify the snapshot is restorable (sandbox into paperclip_restoring).
# Pre-create the target DB the verify wants:
sudo -u postgres psql -c "DROP DATABASE IF EXISTS paperclip_restoring;"
sudo -u postgres psql -c "CREATE DATABASE paperclip_restoring;"
node scripts/safety/cli.mjs verify --db-url="$DB_URL" --snapshot=<snapshot-id>

# 3. Mutate (install / upgrade / disable / uninstall).
# ...

# 4. If the mutation fails, restore from the bookend snapshot:
node scripts/safety/cli.mjs restore --db-url="$DB_URL" --snapshot=<snapshot-id> --confirm-restore
```

The verify step is non-mutating (restores into `paperclip_restoring`, not `paperclip_<instance>`). Restore is destructive — it rolls the live instance back to the snapshot moment. Snapshots include both the Postgres dump and the instance filesystem tarball.

## Uninstall

**Default: data-preserving.**

```bash
cd ~/paperclip
pnpm paperclipai plugin uninstall clarity-pack
```

The plugin's namespaced Postgres schema (`plugin_clarity_pack_<hash>`) and its rows are left untouched. Re-installing restores everything (the host preserves the plugin-identity UUID across a disable/enable cycle).

**Destructive: `--purge` (opt-in only).**

`--purge` removes the plugin schema and all its data. There is no recovery path except restoring from a snapshot. Always bookend a `--purge` with the safety CLI's snapshot + verify-restore sequence (see Rollback above). The `--purge` flag is a Paperclip host capability; check `pnpm paperclipai plugin uninstall --help` for current support.

## Runbook

Operational guidance lives in [`.planning/`](.planning/) (project-local) and the safety CLI scripts:

| What | Where |
|------|-------|
| Bookended-snapshots discipline | [`CLAUDE.md`](CLAUDE.md) §Constraints |
| Safety CLI | [`scripts/safety/cli.mjs`](scripts/safety/cli.mjs) — `snapshot`, `verify`, `restore`, `gate` |
| Install helper (handles `pnpm paperclipai plugin install` tarball unpack) | [`scripts/install-helper.sh`](scripts/install-helper.sh) |
| Coexistence checks | [`scripts/coexistence-checks/`](scripts/coexistence-checks/) — nine pre-flight assertions that the host's `disable` preserves data |
| Phase history | [`.planning/ROADMAP.md`](.planning/ROADMAP.md), per-phase `SUMMARY.md` files under `.planning/phases/` |

## Trust model

Clarity Pack UI loads as same-origin trusted JavaScript inside Paperclip's main app (per `PLUGIN_SPEC.md` §19). It is NOT iframed or sandboxed. Capabilities declared in the manifest gate the worker-side host RPC calls, but the UI bundle has full access to Paperclip's HTTP APIs as the logged-in user. Treat your install of Clarity Pack with the same security posture you'd give any first-party Paperclip code.

Postgres migrations are additive-only and scoped to the plugin namespace. Plugin disable leaves data intact (coexistence guarantee #6); `--purge` is the documented opt-in escape hatch.

## Compatibility

- **Paperclip host**: tested against `paperclipai` master with `@paperclipai/plugin-sdk@2026.512.0`.
- **Runtime**: Node 20+ on the host (Paperclip's `engines.node`).
- **Database**: Postgres 17 (Paperclip's pin).
- **UI**: React 19 (host-supplied; do NOT bundle your own).

## License

Authored by Eric Gewirtzman (gl3 group). Internal use; not yet open-sourced.

## Status

Pre-1.0. Current line: `1.0.0-rc.1` (Phase 5 polish; release candidate). Production-deployed on the [Countermoves](https://countermoves.gl3group.com) Paperclip instance for live operator validation. See [`.planning/ROADMAP.md`](.planning/ROADMAP.md) for milestone status.
