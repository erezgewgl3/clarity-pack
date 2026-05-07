#!/usr/bin/env bash
# macOS / Linux launcher for clarity-safety snapshot.
# Forwards all args to `node <repo>/scripts/safety/cli.mjs snapshot`.
exec node "$(dirname "$0")/../scripts/safety/cli.mjs" snapshot "$@"
