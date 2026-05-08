# Hostinger / Countermoves — Production VPS State

**Date stamped:** end of 2026-05-08
**Purpose:** capture the production-grade Hostinger build for the Countermoves project. This box becomes (a) Countermoves' permanent home and (b) the production-shaped staging environment against which clarity-pack is developed and proven before deployment to BEAAA.

**Why this doc exists:** the previous plan (per `HANDOFF.md` written morning of 2026-05-08) assumed a "fresh local Paperclip on Eric's laptop" as the rehearsal target. That changed mid-day to "production Hostinger VPS for the new Countermoves project." This file captures the new reality.

---

## Project relationship

| Project | Lives where | Clarity-pack relationship |
|---|---|---|
| **BEAAA** (insurance) | Existing live Paperclip install — host TBD, **not** Hostinger, **not** under gl3group.com domain | Eventually receives clarity-pack as its own deployment exercise. Untouched today. |
| **Countermoves** (new) | This Hostinger VPS, `countermoves.gl3group.com` | Brand new. Becomes the production-shaped staging environment for clarity-pack. The first place clarity-pack runs end-to-end against real Paperclip + real Postgres + real TLS. |

The Countermoves box is genuinely production for Countermoves AND a faithful staging mirror for what clarity-pack will face when deployed to BEAAA. Single box, dual purpose, intentional.

---

## VPS facts

| Item | Value |
|---|---|
| Provider | Hostinger |
| Plan | KVM 4 (4 vCPU / 16 GB RAM / 200 GB NVMe) |
| OS | Ubuntu 24.04 LTS (no panel) |
| Default hostname | `srv1654080.hstgr.cloud` |
| Custom hostname | `countermoves` (via `hostnamectl`) |
| Public IPv4 | `82.29.197.74` |
| Public IPv6 | `2a02:4780:2d:1255::1` |
| Term | 24-month commit (expires 2028-05-08) |
| Backups | Hostinger weekly automated backups (in addition to clarity-pack's safety CLI snapshots once enabled) |

## DNS

- `countermoves.gl3group.com` A record → `82.29.197.74`
- TTL 600s (will raise to 3600s after the cert is stable)
- Hosted at GoDaddy (per `nslookup` confirmed propagation)

## SSH access

- **Key path on laptop:** `C:\Users\erezg\.ssh\countermoves_vps_ed25519` (private) and `.pub` (public). Server-specific ed25519 key — not reused for other servers.
- **User:** `eric` (sudo group); **root SSH login is disabled.**
- **Whitelist:** sshd config allows ONLY `eric` (`AllowUsers eric` in `/etc/ssh/sshd_config.d/99-countermoves.conf`).
- **Connect:** `ssh -i $HOME\.ssh\countermoves_vps_ed25519 eric@82.29.197.74` (PowerShell, Windows OpenSSH).
- **Recovery if eric's sudo password is lost:** Hostinger hPanel → VPS → Browser terminal → log in as root via console (root login is disabled for SSH but still works on local console) → `passwd eric`.

## OS hardening (Stage 4 — done)

- SSH lockdown: PermitRootLogin no, PasswordAuthentication no, KbdInteractiveAuthentication no, AllowUsers eric. Cloud-init's earlier drop-ins at `/etc/ssh/sshd_config.d/50-cloud-init.conf` and `60-cloudimg-settings.conf` were renamed to `.disabled` to remove the lexical-order conflict.
- UFW firewall: default deny incoming, allow outgoing. Allowed: 22, 80, 443 (both IPv4 and IPv6).
- fail2ban: SSH jail enabled, `bantime=1h findtime=10m maxretry=5`.
- Automatic security updates: `unattended-upgrades` configured via `/etc/apt/apt.conf.d/20auto-upgrades`. cloud-init is held back by Hostinger pinning (expected, ignore).
- Swap: 4 GB swap file at `/swapfile` (mode 600), persisted in `/etc/fstab`.
- Time sync: `systemd-timesyncd` active, UTC.
- Cloud-init: `preserve_hostname: true` set so the hostname doesn't revert on reboot.

## Application stack (Stage 5 — done)

| Component | Version | Source |
|---|---|---|
| Node | 20.20.2 | NodeSource APT repo (`deb.nodesource.com/setup_20.x`) |
| pnpm | 10.13.1 | npm global install (corepack disabled — its v11-default broke against Node 20) |
| git | 2.43.0 | Ubuntu default |
| build-essential | 12.10 | Ubuntu default (gcc 13 / g++ 13 / make) |
| PostgreSQL | 17.9 | PGDG APT repo (`apt.postgresql.org`) |
| Caddy | 2.11.2 | Caddy official APT repo (`dl.cloudsmith.io/caddy/stable`) |

Notable: `corepack` was disabled because its `pnpm@latest` resolved to `pnpm@11.0.8`, which requires Node 22.13+. We pinned `pnpm@10.13.1` via `npm install -g`. **Do not re-enable corepack** without simultaneously upgrading Node.

## PostgreSQL setup (Stage 6 — done)

- Cluster: `/var/lib/postgresql/17/main` (auto-created at install)
- Auth: `auth-local peer`, `auth-host scram-sha-256` (modern secure default)
- `listen_addresses = 'localhost'` (default, NOT exposed to the public network)
- Role: `paperclip` with LOGIN privilege, password in vault file
- Database: `paperclip_countermoves` owned by `paperclip`
- Schema: **82 Drizzle migrations applied** via `pnpm db:migrate` (Stage 8a today)
- Data page checksums: **disabled** (install-time default; would require cluster recreation to enable; not blocking, follow-up task)

## Caddy reverse-proxy + TLS (Stage 7 — done)

- Caddyfile at `/etc/caddy/Caddyfile`
- Domain: `countermoves.gl3group.com`
- Upstream: `127.0.0.1:3100` (Paperclip's default port, NOT 3000 as some Paperclip docs suggested)
- TLS: Let's Encrypt cert auto-fetched via HTTP-01 challenge — verified via `curl.exe -I https://countermoves.gl3group.com` (502 expected because Paperclip is not running yet)
- Security headers in both main response and `handle_errors` block: HSTS (1y, includeSubDomains), X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, `-Server` (best-effort; Caddy still adds `Server: Caddy` after middleware — accepted)
- Logs: journald (default). The custom file-logging block was removed because Caddy's systemd unit shipped by cloudsmith blocks writes outside its sandbox even when the directory has the right Unix permissions. Long-term fine.

## Vault file

`/etc/paperclip/db.env` — mode 600, owned by root.

```
DATABASE_URL=postgresql://paperclip:<32-char-alphanumeric>@127.0.0.1:5432/paperclip_countermoves
BETTER_AUTH_SECRET=<64-char-alphanumeric>
SERVE_UI=true
```

The DB password and auth secret were both generated with `openssl rand` constrained to alphanumeric (no special characters that would break shell quoting / paste flows). Both have been visible in chat scrollback during the build, so **rotate both before pointing real production data at this box.** For Countermoves' empty-test phase that's fine.

To use these env vars in eric's shell:
```bash
export $(sudo cat /etc/paperclip/db.env | xargs)
```

This is a per-shell export. When we convert Paperclip to a systemd service, we use `EnvironmentFile=/etc/paperclip/db.env` in the unit file — systemd reads it as root, drops privileges to the service user.

## Paperclip repo state

- Cloned to `~/paperclip` on the VPS (in eric's home dir)
- Branch: `master`, head at commit `0e1a5828`
- `pnpm install` clean (with one harmless `paperclip-plugin-dev-server` bin-creation warning that's a chicken-and-egg with the SDK build)
- `pnpm db:migrate` applied 82 migrations to `paperclip_countermoves`
- **Onboarding wizard NOT yet run.** That's tomorrow's first action.

Long-term we move this to `/opt/paperclip` and convert to a systemd service running as a dedicated `paperclip` system user. For now, eric ownership in `~/paperclip` is fine.

---

## Where we paused (end of day 2026-05-08)

| Stage | Status |
|---|---|
| 1 — Hostinger account | ✓ Done |
| 2 — VPS provision | ✓ Done |
| 3 — DNS A record | ✓ Done, propagated |
| 4 — SSH harden + UFW + fail2ban + auto-updates + swap + NTP | ✓ Done |
| 5 — Install stack (Node, pnpm, git, build-essential, Postgres 17, Caddy) | ✓ Done |
| 6 — Postgres role + database + vault file | ✓ Done |
| 7 — Caddy reverse-proxy + TLS | ✓ Done |
| 8a — Paperclip clone + `pnpm install` + `pnpm db:migrate` (82 migrations) | ✓ Done |
| 8b — `pnpm paperclipai onboard` (interactive wizard) | ⬜ **Tomorrow first thing** |
| 8c — Start Paperclip + verify `https://countermoves.gl3group.com` loads | ⬜ |
| 9 — First clean baseline snapshot via clarity-pack safety CLI | ⬜ |

## Tomorrow's first 30 minutes

```powershell
ssh -i $HOME\.ssh\countermoves_vps_ed25519 eric@82.29.197.74
```

In the SSH session:

```bash
cd ~/paperclip
export $(sudo cat /etc/paperclip/db.env | xargs)
pnpm paperclipai onboard
```

The wizard will ask reachability/mode/exposure questions. Pick the **Custom** path:
- Reachability / bind: `loopback` (Caddy is fronting)
- Mode: `authenticated`
- Exposure: `public`
- Public URL: `https://countermoves.gl3group.com`

Paste the wizard's first prompt back to Claude when you start, and Claude walks you through each answer. After onboard completes, `pnpm dev` (or eventually a systemd unit) starts Paperclip; `curl.exe -I https://countermoves.gl3group.com` from PowerShell should then return real content (not 502).

## Open follow-ups (track but not blocking)

1. **Rotate DB password and BETTER_AUTH_SECRET before live data.** Both are in chat scrollback from the build. `ALTER ROLE paperclip PASSWORD '...'` for the DB; regenerate auth secret and re-write to vault.
2. **Convert Paperclip to a systemd service** running as a dedicated `paperclip` system user (not eric). Move repo to `/opt/paperclip`. Configure `EnvironmentFile=/etc/paperclip/db.env` so the service reads vault as root then drops privileges.
3. **Enable Postgres data-page checksums** (requires cluster recreation, planned during a maintenance window before going live).
4. **Hostinger panel auto-renew check** — the VPS expires 2028-05-08 (24-month term). Confirm auto-renew is on or set a calendar reminder.
5. **Ubuntu Pro / ESM** — irrelevant until April 2029 when standard 24.04 support ends. Set a reminder for early 2029.
6. **Caddy file-logging** — currently logging to journald only; works fine. If we ever need file logs (e.g., for log shipping), revisit the systemd sandbox restriction with a `ReadWritePaths` override.

## Reference: docs we relied on today

- `~/paperclip/doc/DEPLOYMENT-MODES.md` — auth modes, exposure, reachability table
- `~/paperclip/doc/DATABASE.md` — three DB modes, `DATABASE_URL` switching, Drizzle migration command
- `~/paperclip/doc/OPENCLAW_ONBOARDING.md` — confirmed default port 3100 and `/api/health` endpoint (despite the file's name, not the Paperclip-self onboarding doc)
- `~/paperclip/.env.example` — confirmed env var names: `DATABASE_URL`, `PORT`, `SERVE_UI`, `BETTER_AUTH_SECRET`

---

*Last updated: end of day 2026-05-08, after Stage 8a (DB migrations applied, vault complete). Supersedes the morning HANDOFF.md's "rehearsal against fresh local Paperclip" plan.*
