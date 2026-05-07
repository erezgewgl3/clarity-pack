# Windows PowerShell launcher for clarity-safety snapshot.
# Forwards all args to `node <repo>/scripts/safety/cli.mjs snapshot`.
& node "$PSScriptRoot\..\scripts\safety\cli.mjs" snapshot @args
