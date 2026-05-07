# Platform Setup — pg_dump, pnpm, Node

Per-platform install instructions for the toolchain the safety CLI
depends on. The CLI itself is pure Node.js (no native modules at
runtime), but Postgres-mode snapshots require `pg_dump` and
`pg_restore` to be on PATH and to match the running Paperclip's
Postgres major version.

PGlite mode does NOT need `pg_dump`. If you are running Paperclip in
PGlite mode (the documented dev path), you can skip the Postgres
sections of this document.

---

## Required versions

| Tool      | Minimum version | Why                                                 |
|-----------|-----------------|-----------------------------------------------------|
| Node.js   | 20.x            | The safety CLI uses `AbortSignal.any` (Node 20.3+). |
| pnpm      | 9.x             | The repo's lockfile is pnpm v9 format.              |
| pg_dump   | matches server  | Must be the same MAJOR version as the running Postgres. Different majors fail with a custom-format mismatch error. |
| pg_restore | matches server  | Same constraint as `pg_dump`.                       |

The pg_dump major-version mismatch is fatal. It is a real footgun
because `pg_dump --version` will run cleanly even when the dump file
it produces cannot be restored by the server. The safety CLI checks
the version at snapshot time and refuses if the client major is older
than the server major. There is no warning — only a refusal. The
remediation in each platform section below is the install of a
correctly-versioned client.

---

## Windows

### Node.js

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download from https://nodejs.org/ (LTS channel, currently 20.x).
Restart your shell after installing.

Verify:

```
node --version
```

Expected: `v20.x.y` or higher.

### pnpm

```powershell
npm install -g pnpm
```

Or via the official installer:

```powershell
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

Verify:

```
pnpm --version
```

Expected: `9.x.y` or higher.

### pg_dump (Postgres mode only)

Choose ONE of the three install paths:

```powershell
# Option 1 — winget (cleanest)
winget install PostgreSQL.PostgreSQL.17

# Option 2 — scoop
scoop install postgresql

# Option 3 — chocolatey
choco install postgresql17
```

After install, the binary lives at
`C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`. The installer does
NOT always update PATH. Verify:

```powershell
pg_dump --version
```

If "command not found", manually add the bin dir to user PATH:

```powershell
[Environment]::SetEnvironmentVariable(
  'Path',
  [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\Program Files\PostgreSQL\17\bin',
  'User'
)
```

Restart your shell and retry. Expected:

```
pg_dump (PostgreSQL) 17.x
```

If you are running Paperclip against Postgres 16, install PostgreSQL
16 client tools instead (`winget install PostgreSQL.PostgreSQL.16`).
The major version on the dump client must match the server.

---

## macOS

### Node.js

```bash
brew install node@20
brew link --overwrite node@20
```

Verify:

```bash
node --version
```

### pnpm

```bash
brew install pnpm
```

Or:

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

Verify:

```bash
pnpm --version
```

### pg_dump (Postgres mode only)

```bash
brew install postgresql@17
```

Add to PATH (Apple Silicon):

```bash
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Add to PATH (Intel):

```bash
echo 'export PATH="/usr/local/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Verify:

```bash
pg_dump --version
```

For a Postgres 16 server, install `postgresql@16` instead.

---

## Linux

### Node.js

Ubuntu / Debian:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Fedora / RHEL:

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

Arch:

```bash
sudo pacman -S nodejs npm
```

### pnpm

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

Or via npm:

```bash
sudo npm install -g pnpm
```

### pg_dump (Postgres mode only)

Ubuntu / Debian:

```bash
sudo apt-get install -y postgresql-client-17
```

If your distro repo doesn't have version 17, add the official
PostgreSQL APT repo first:

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get install -y postgresql-client-17
```

Fedora / RHEL:

```bash
sudo dnf install -y postgresql17
```

Arch:

```bash
sudo pacman -S postgresql-libs
```

Verify:

```bash
pg_dump --version
```

For a Postgres 16 server, install `postgresql-client-16` (Debian) or
`postgresql16` (Fedora) instead.

---

## Verifying the major-version match

If you are running Paperclip against Postgres, you can check the
server's major version with:

```bash
psql -h <host> -U <user> -d postgres -c "SELECT current_setting('server_version_num')::int / 10000 as major;"
```

Compare to:

```bash
pg_dump --version
```

The first integer in `pg_dump (PostgreSQL) 17.x` is the major version.
It must match (or exceed) the server's major version. Older client
against newer server is fatal; newer client against older server is
generally fine but emits warnings.

---

## When PGlite is enough

PGlite mode bundles a WebAssembly Postgres into the Paperclip process.
There is no separate Postgres server, no `pg_dump` binary needed, no
network database. The safety CLI's snapshot uses
`@electric-sql/pglite`'s built-in `dumpDataDir('gzip')`. Restore loads
the gzipped data directory into the staging instance.

If you are running Paperclip locally for development (the documented
default for `pnpm onboard`), you are likely in PGlite mode and the
Postgres install steps above are irrelevant. The safety CLI's
`snapshot` and `restore` will Just Work without any Postgres tooling.

To check which mode your running Paperclip is in, inspect
`<paperclip-home>/instances/default/config.json`. PGlite mode shows
`"db": { "driver": "pglite" }` (or similar); Postgres mode shows
`"db": { "driver": "postgres", ... }`.
