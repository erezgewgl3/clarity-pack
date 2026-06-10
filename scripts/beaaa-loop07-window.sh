#!/usr/bin/env bash
set -uo pipefail
OUT=/home/beai-agent/.pm2/logs/paperclip-out.log
# Line number of the last v1.5.1 worker (re)start
START=$(grep -n "clarity-pack worker started" "$OUT" | tail -1 | cut -d: -f1)
echo "=== last worker-start at log line $START (everything below = current v1.5.1 boot) ==="
echo
echo "compile-result 201 (successful writes) since boot: $(tail -n +"$START" "$OUT" | grep -c 'documents/compile-result 201')"
echo "compile-result 403 (rejected writes)   since boot: $(tail -n +"$START" "$OUT" | grep -c 'documents/compile-result 403')"
echo "compile-result 422 (rejected writes)   since boot: $(tail -n +"$START" "$OUT" | grep -c 'documents/compile-result 422')"
echo "op-issue creations since boot:                     $(tail -n +"$START" "$OUT" | grep -c 'created operation issue')"
echo "wake-suppressed/kill-switch since boot:            $(tail -n +"$START" "$OUT" | grep -ciE 'wake suppressed|kill-switch engaged|ceiling')"
echo
echo "=== any 403/422 doc-write since boot (timestamps only, no bodies) ==="
tail -n +"$START" "$OUT" | grep -oE "documents/compile-result (403|422)" | sort | uniq -c
echo "(empty above = ZERO new write rejections under v1.5.1)"
echo
echo "=== op-issue creations since boot (kind + assignee, ts only) ==="
tail -n +"$START" "$OUT" | grep "created operation issue" | sed -E 's/\x1b\[[0-9;]*m//g' | grep -oE "created operation issue [a-f0-9-]+ kind=[a-z-]+ originId=[^ ]+ assignee=[a-f0-9-]+"
