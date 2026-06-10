#!/usr/bin/env bash
# LOOP-07 live drill helper — run on the BEAAA box (as root; self-sudo's to beai-agent).
set -uo pipefail
OUT=/home/beai-agent/.pm2/logs/paperclip-out.log
PID=a763176a-2f4d-4986-b190-b5151e42cc00
CID=59f8876e-e729-4dda-98f9-1317c2b50492

echo "=== plugin version ==="
sudo -u beai-agent bash -lc 'cd ~ && npx paperclipai plugin list 2>&1 | grep -i clarity'

echo
echo "=== recent BEAAA issues (id|key|title via --json) ==="
sudo -u beai-agent bash -lc "cd ~ && npx paperclipai issue list --company-id $CID --json 2>/dev/null" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{let j=JSON.parse(d);let a=Array.isArray(j)?j:(j.issues||j.data||[]);a.slice(0,8).forEach(i=>console.log((i.id||"?")+"|"+(i.key||i.identifier||"?")+"|"+String(i.title||"").slice(0,50)))}catch(e){console.log("JSON_PARSE_FAIL:"+e.message)}})'

echo
echo "=== clarity worker activity (last 800 lines) ==="
echo "-- op-issue creations / Editor operations --"
tail -n 800 "$OUT" | grep -iE "operation|op-issue|clarity-pack:operation|startAgentTask" | tail -15
echo "-- governed wake / requestWakeup / governor --"
tail -n 800 "$OUT" | grep -iE "requestWakeup|wake|governor|suppress|kill-switch" | tail -15
echo "-- write rejections (403/422/status_only/recovery) --"
tail -n 800 "$OUT" | grep -iE "403|422|status_only|recovery|allowDocumentUpdates|deliverable" | tail -15
echo "-- tldr / reader persist --"
tail -n 800 "$OUT" | grep -iE "tldr|reader|persist|summary compiled" | tail -10
