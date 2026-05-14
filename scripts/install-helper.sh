#!/usr/bin/env bash
#
# scripts/install-helper.sh — Plan 02-03b Task 2.
#
# One-shot local-path Paperclip plugin install. Replaces the 3-line manual
# extract/npm-install/install dance from the 2026-05-13 drill, which exposed
# that `paperclipai plugin install <local-dir>` does NOT symlink the host's
# node_modules into the extracted tarball — the worker boot then fails with
# ERR_MODULE_NOT_FOUND on @paperclipai/plugin-sdk.
#
# Usage:
#   scripts/install-helper.sh <path-to-tarball.tgz>
#
# What it does (each step idempotent):
#   1. Resolve absolute path to the tarball; exit 2 if missing.
#   2. Extract into a deterministic dir under /tmp/clarity-pack-build/<basename>.
#      The dir is wiped on each invocation so stale artifacts can't linger.
#   3. cd into the extracted "package/" dir and run npm install with devDeps
#      so the SDK + every other build-time dep is materialised. Uses
#      --no-fund --no-audit for less output noise, --include=dev to override
#      a NODE_ENV=production environment if present.
#   4. Bump dist/manifest.js mtime so any mtime-cache the host keeps invalidates.
#   5. Invoke `paperclipai plugin install <extracted-dir>`. Streams the host's
#      stdout/stderr verbatim; this script's exit code is the host's exit code.
#
# Exit codes:
#   0 — install succeeded.
#   2 — tarball arg missing or file not found.
#   3 — extraction failed.
#   4 — npm install failed.
#   5 — paperclipai plugin install failed; rerun manually after diagnosing.
#
# This script is designed to live on the operator's box (Hostinger Countermoves
# or local Paperclip clone) and be invoked AFTER `scp`-ing a tarball produced
# by `npm pack` on the developer's machine.

set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "usage: $0 <path-to-tarball.tgz>" >&2
  exit 2
fi

TARBALL="$1"

if [[ ! -f "$TARBALL" ]]; then
  echo "tarball not found: $TARBALL" >&2
  exit 2
fi

ABS_TARBALL="$(readlink -f "$TARBALL" 2>/dev/null || realpath "$TARBALL")"
BASENAME="$(basename "$ABS_TARBALL" .tgz)"
EXTRACT_ROOT="/tmp/clarity-pack-build/${BASENAME}"

echo "==> Cleaning extraction dir: $EXTRACT_ROOT"
rm -rf "$EXTRACT_ROOT"
mkdir -p "$EXTRACT_ROOT"

echo "==> Extracting $ABS_TARBALL"
if ! tar -xzf "$ABS_TARBALL" -C "$EXTRACT_ROOT"; then
  echo "extraction failed" >&2
  exit 3
fi

# npm pack puts everything in package/
PKG_DIR="${EXTRACT_ROOT}/package"
if [[ ! -d "$PKG_DIR" ]]; then
  # Some packers extract directly without a wrapper; fall back to root.
  PKG_DIR="$EXTRACT_ROOT"
fi

echo "==> Running npm install in $PKG_DIR"
pushd "$PKG_DIR" >/dev/null
if ! npm install --no-fund --no-audit --include=dev; then
  popd >/dev/null
  echo "npm install failed" >&2
  exit 4
fi

# Touch dist/manifest.js to invalidate any mtime-based caches the host keeps.
if [[ -f dist/manifest.js ]]; then
  touch dist/manifest.js
fi
popd >/dev/null

echo "==> Invoking paperclipai plugin install"
if ! paperclipai plugin install "$PKG_DIR"; then
  echo "paperclipai plugin install failed" >&2
  exit 5
fi

echo "==> install-helper.sh complete: $PKG_DIR"
