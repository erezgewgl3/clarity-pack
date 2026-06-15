#!/usr/bin/env bash
set -uo pipefail
PID=a763176a-2f4d-4986-b190-b5151e42cc00
CID=59f8876e-e729-4dda-98f9-1317c2b50492
OUT=/home/beai-agent/.pm2/logs/paperclip-out.log

echo "=== resolve BEAAA-1877 -> uuid ==="
UUID=$(sudo -u beai-agent bash -lc "cd ~ && npx paperclipai issue list --company-id $CID --json 2>/dev/null" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const a=Array.isArray(j)?j:(j.issues||j.data||[]);const m=a.find(i=>(i.key||i.identifier)==="BEAAA-1877");console.log(m?m.id:"NOTFOUND")})')
echo "uuid=$UUID"
[ "$UUID" = "NOTFOUND" ] && exit 0

BODY=$(printf '{"companyId":"%s","params":{"issueId":"%s","userId":"local-board"}}' "$CID" "$UUID")

echo
echo "=== current reader TL;DR for BEAAA-1877 (read 1) ==="
curl -s -X POST "http://localhost:3100/api/plugins/$PID/data/issue.reader" -H 'content-type: application/json' --data "$BODY" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const x=j.data||j;const t=x.tldr;console.log("tldrStatus="+x.tldrStatus);console.log("generated_at="+(t&&t.generated_at));console.log("compiled_by="+(t&&t.compiled_by_agent_id));console.log("body=\n"+(t&&t.body||"(null)"))})'

MARK=$(wc -l < "$OUT")
echo
echo "=== wait 90s for v1.5.1 recompile to replace the stale cache ==="
sleep 90
echo "=== reader TL;DR (read 2, after recompile window) ==="
curl -s -X POST "http://localhost:3100/api/plugins/$PID/data/issue.reader" -H 'content-type: application/json' --data "$BODY" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const x=j.data||j;const t=x.tldr;console.log("tldrStatus="+x.tldrStatus);console.log("generated_at="+(t&&t.generated_at));console.log("body=\n"+(t&&t.body||"(null)"))})'

echo
echo "=== this issue dispatch trace since read 1 ==="
tail -n +"$MARK" "$OUT" | sed -E 's/\x1b\[[0-9;]*m//g' | grep -iE "$UUID|compile-result (201|403|422)|created operation issue|consumed" | tail -20
