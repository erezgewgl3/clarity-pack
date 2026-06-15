#!/usr/bin/env bash
# One-shot BEAAA deploy of clarity-pack v1.6.0 (Path A, single connection).
# Run as root on the box:  ssh ariclaw 'bash /tmp/deploy-1.6.0.sh'
set -uo pipefail

TGZ=/tmp/clarity-pack-1.6.0.tgz

echo "=== 0. chown tarball to beai-agent ==="
chown beai-agent:beai-agent "$TGZ" || { echo "CHOWN_FAILED"; exit 1; }
echo "tarball sha on box:"
sha256sum "$TGZ"

echo "=== 1. uninstall old clarity-pack ==="
sudo -u beai-agent bash -lc 'cd ~ && npx -y paperclipai plugin uninstall clarity-pack 2>&1' || echo "(uninstall returned non-zero; continuing)"

echo "=== 2. unpack + npm install + plugin install v1.6.0 ==="
sudo -u beai-agent bash -lc '
  set -e
  rm -rf /tmp/clarity-pack-build && mkdir -p /tmp/clarity-pack-build
  tar -xzf /tmp/clarity-pack-1.6.0.tgz -C /tmp/clarity-pack-build
  cd /tmp/clarity-pack-build/package
  npm install --no-fund --no-audit --no-progress 2>&1 | tail -3
  touch dist/manifest.js
  echo "--- migration 0018 present in build dir? ---"
  ls -la migrations/0018_structured_human_wait.sql
  echo "--- installing ---"
  npx -y paperclipai plugin install /tmp/clarity-pack-build/package 2>&1
'

echo "=== 3. reload worker ==="
sudo -u beai-agent pm2 restart paperclip 2>&1 || echo "PM2_RESTART_FAILED — see runbook section 5"

echo "=== 4. confirm registered (want status=ready version=1.6.0) ==="
sleep 5
sudo -u beai-agent bash -lc 'cd ~ && npx -y paperclipai plugin list 2>&1 | grep -i clarity-pack'

echo "=== DONE ==="
