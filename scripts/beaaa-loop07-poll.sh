#!/usr/bin/env bash
# LOOP-07 decisive proof: poll until the TL;DR persists; trace the op-issue dispatch + write outcome; storm check.
set -uo pipefail
OUT=/home/beai-agent/.pm2/logs/paperclip-out.log
PID=a763176a-2f4d-4986-b190-b5151e42cc00
CID=59f8876e-e729-4dda-98f9-1317c2b50492
ISSUE_UUID=fd895c74-8c56-4b55-ac85-b554d127bcd6   # BEAAA-143
OPISSUE=dcf08299-4dc5-4c2f-9e57-db0bdf71ce1d
EDITOR=ca0edebc-6f54-4a19-b836-4d306e3a3c48
BODY=$(printf '{"companyId":"%s","params":{"issueId":"%s","userId":"local-board"}}' "$CID" "$ISSUE_UUID")

MARK=$(wc -l < "$OUT")
echo "=== polling issue.reader up to ~5min for tldr persistence ==="
STATUS="compiling"; TLDR_SNIP=""
for i in $(seq 1 10); do
  sleep 30
  curl -s -o /tmp/r.json -X POST "http://localhost:3100/api/plugins/$PID/data/issue.reader" \
    -H 'content-type: application/json' --data "$BODY"
  STATUS=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log((j.data&&j.data.tldrStatus)||"?")}catch(e){console.log("ERR")}})' < /tmp/r.json)
  TLDR_SNIP=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const t=j.data&&j.data.tldr;console.log(t?String(t).slice(0,220):"(null)")}catch(e){console.log("ERR")}})' < /tmp/r.json)
  echo "[poll $i @ $(date +%H:%M:%S)] tldrStatus=$STATUS  tldr=$TLDR_SNIP"
  if [ "$STATUS" != "compiling" ] && [ "$TLDR_SNIP" != "(null)" ]; then echo ">>> TL;DR PERSISTED"; break; fi
done

echo
echo "=== dispatch trace for op-issue $OPISSUE / editor $EDITOR (new log) ==="
tail -n +"$MARK" "$OUT" | grep -iE "$OPISSUE|$EDITOR|operation|requestWakeup|suppress|status_only|recovery|normal_model|403|422|documents|tldr" | tail -40

echo
echo "=== storm check: wake/op-issue creations in new window (should be tiny, bounded) ==="
echo -n "operation-issue creations since mark: "; tail -n +"$MARK" "$OUT" | grep -c "created operation issue"
echo -n "wake-suppressed lines since mark: "; tail -n +"$MARK" "$OUT" | grep -c "suppress"
echo "=== worker cpu/mem now ==="
sudo -u beai-agent pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);for(const p of a)console.log(p.name,"cpu="+(p.monit&&p.monit.cpu)+"%","mem="+Math.round((p.monit&&p.monit.memory||0)/1048576)+"MB","restarts="+(p.pm2_env&&p.pm2_env.restart_time))}catch(e){console.log("parsefail")}})'
