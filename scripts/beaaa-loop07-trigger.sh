#!/usr/bin/env bash
# LOOP-07 trigger+observe: kick an on-demand TL;DR compile and watch the governed-wake dispatch.
set -uo pipefail
OUT=/home/beai-agent/.pm2/logs/paperclip-out.log
PID=a763176a-2f4d-4986-b190-b5151e42cc00
CID=59f8876e-e729-4dda-98f9-1317c2b50492
ISSUE_UUID=fd895c74-8c56-4b55-ac85-b554d127bcd6   # BEAAA-143

MARK=$(wc -l < "$OUT")
echo "=== log line mark before trigger: $MARK ==="

echo "=== POST issue.reader data handler (localhost, same-origin) ==="
BODY=$(printf '{"companyId":"%s","params":{"issueId":"%s","userId":"local-board"}}' "$CID" "$ISSUE_UUID")
CODE=$(curl -s -o /tmp/reader-out.json -w '%{http_code}' -X POST \
  "http://localhost:3100/api/plugins/$PID/data/issue.reader" \
  -H 'content-type: application/json' --data "$BODY")
echo "HTTP $CODE"
echo "--- response head (first 600 chars) ---"
head -c 600 /tmp/reader-out.json; echo

echo
echo "=== also POST situation.snapshot (sets active-viewer / warm path) ==="
BODY2=$(printf '{"companyId":"%s","params":{"userId":"local-board"}}' "$CID")
CODE2=$(curl -s -o /tmp/snap-out.json -w '%{http_code}' -X POST \
  "http://localhost:3100/api/plugins/$PID/data/situation.snapshot" \
  -H 'content-type: application/json' --data "$BODY2")
echo "HTTP $CODE2 (situation.snapshot)"

echo
echo "=== waiting 40s for Editor-Agent dispatch ==="
sleep 40

echo "=== NEW log lines since mark, filtered for clarity dispatch ==="
tail -n +"$MARK" "$OUT" | grep -iE "clarity|operation|requestWakeup|wake|governor|suppress|tldr|reader|403|422|status_only|recovery|documents|deliverable|issue-assignment" | tail -50
echo "=== END (if empty: no clarity op-issue created in window) ==="
