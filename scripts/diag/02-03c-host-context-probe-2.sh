#!/bin/bash
# Plan 02-03c Task 1 Step 2 probe #2 — content + Provider locate.
set +e

echo "=== PROBE 2 START ==="

echo ""
echo "--- A. paperclip version (multiple paths) ---"
for p in /home/eric/paperclip/package.json /home/eric/paperclip/apps/web/package.json /home/eric/paperclip/ui/package.json /home/eric/paperclip/server/package.json; do
  if [ -f "$p" ]; then
    echo "$p: $(grep '"version"' "$p" | head -1)"
  fi
done

echo ""
echo "--- B. server-layout discovery (wider) ---"
ls -la /home/eric/paperclip/ 2>/dev/null | head -30

echo ""
echo "--- C. server-side files referencing PluginHostContext / companyPrefix (no path filter) ---"
find /home/eric/paperclip -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/ui/*' 2>/dev/null \
  | xargs -r grep -lE 'PluginHostContext|companyPrefix' 2>/dev/null | head -15

echo ""
echo "--- D. UI Provider/Context for PluginHostContext (where the value gets PUT into context) ---"
find /home/eric/paperclip/ui -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null \
  | xargs -r grep -lE 'createContext.*PluginHostContext|PluginHostContext.*createContext|HostContext\.Provider|HostContextProvider' 2>/dev/null | head -10

echo ""
echo "--- E. FULL slots.tsx (the slot-mounting infrastructure) ---"
echo "----- BEGIN slots.tsx -----"
cat /home/eric/paperclip/ui/src/plugins/slots.tsx 2>/dev/null
echo "----- END slots.tsx -----"

echo ""
echo "--- F. FULL launchers.tsx ---"
echo "----- BEGIN launchers.tsx -----"
cat /home/eric/paperclip/ui/src/plugins/launchers.tsx 2>/dev/null
echo "----- END launchers.tsx -----"

echo ""
echo "--- G. IssueDetail.tsx — only PluginHostContext / companyPrefix / detailTab / context= related lines ---"
grep -nE 'PluginHostContext|companyPrefix|detailTab|companyId|<HostContext|context=|hostContext=|buildContext|HostContext\.Provider' /home/eric/paperclip/ui/src/pages/IssueDetail.tsx 2>/dev/null | head -50

echo ""
echo "--- H. App.tsx route tree around :companyPrefix (lines 300-360) ---"
sed -n '300,360p' /home/eric/paperclip/ui/src/App.tsx 2>/dev/null

echo ""
echo "--- I. plugin-installed clarity-pack manifest snapshot from DB ---"
DBURL=$(sudo cat /etc/paperclip/db.env 2>/dev/null | grep -E '^DATABASE_URL=' | cut -d= -f2-)
if [ -n "$DBURL" ]; then
  echo "(have DBURL)"
  psql "$DBURL" -c "SELECT id, name, version, status, capabilities FROM plugins WHERE name='clarity-pack' LIMIT 1;" 2>/dev/null
else
  echo "(no DBURL captured — sudo prompt may be cached or denied)"
fi

echo ""
echo "=== PROBE 2 END ==="
