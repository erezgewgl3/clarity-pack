#!/usr/bin/env bash
set -uo pipefail
OUT=/home/beai-agent/.pm2/logs/paperclip-out.log
echo "=== total clarity op-issue creations since v1.5.1 restart ==="
grep -c "created operation issue" "$OUT"
echo "=== op-issue creations (kinds/assignees) ==="
grep "created operation issue" "$OUT" | tail -8
echo
echo "=== clarity op-issue document-write rejections (403/422)? ==="
grep -E "documents/.*(403|422)" "$OUT" | tail -5
echo "(empty above = no write rejections)"
echo
echo "=== successful compile-result document writes (201) ==="
grep -c "documents/compile-result 201" "$OUT"
echo
echo "=== kill-switch / suppress / ceiling events? ==="
grep -iE "kill-switch engaged|ceiling|wake suppressed" "$OUT" | tail -5
echo "(empty above = governor never suppressed)"
echo
echo "=== worker cpu sampled 3x over 30s ==="
for n in 1 2 3; do
  sudo -u beai-agent pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);for(const p of a){const mb=Math.round((p.monit&&p.monit.memory||0)/1000000);console.log("sample cpu="+(p.monit&&p.monit.cpu)+"% mem~"+mb+"MB")}})'
  sleep 10
done
echo
echo "=== tidy drill scripts (keep dev-watched install dir + tarball) ==="
rm -f /tmp/drill.sh /tmp/trigger.sh /tmp/poll.sh /tmp/inspect.sh /tmp/r.json /tmp/reader-out.json /tmp/snap-out.json
echo "scripts removed"
