#!/bin/bash
# Plan 02-03c Task 1 Step 2 probe — locates host-side PluginHostContext construction.
# Single SSH session, all greps batched, no per-file SSH round-trip (fail2ban guard).
set +e

echo "=== HOST-CONTEXT-CAPTURE START ==="

echo "--- 1. paperclip version ---"
node -p "require('/home/eric/paperclip/package.json').version" 2>/dev/null

echo ""
echo "--- 2. SERVER-side files referencing PluginHostContext / companyPrefix / companyId ---"
find /home/eric/paperclip -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) \
  -path '*/server/*' -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null \
  | xargs -r grep -lE 'PluginHostContext|companyPrefix' 2>/dev/null | head -10

echo ""
echo "--- 3. UI-side files referencing PluginHostContext / HostContextProvider / companyPrefix ---"
find /home/eric/paperclip/ui -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null \
  | xargs -r grep -lE 'PluginHostContext|HostContextProvider|companyPrefix' 2>/dev/null | head -10

echo ""
echo "--- 4. UI files mounting detailTab slots ---"
find /home/eric/paperclip/ui -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null \
  | xargs -r grep -lE 'detailTab|detail-tab|tab=plugin:' 2>/dev/null | head -10

echo ""
echo "--- 5. Routes mentioning :companyPrefix ---"
find /home/eric/paperclip/ui/src -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null \
  | xargs -r grep -nE ':companyPrefix' 2>/dev/null | head -20

echo ""
echo "--- 6. Assignment sites: companyId: / companyPrefix: in plugin-context-related code ---"
find /home/eric/paperclip -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null \
  | xargs -r grep -nE '(companyId|companyPrefix):' 2>/dev/null \
  | grep -E 'PluginHostContext|HostContext|hostContext|host-context|pluginHost|buildPluginContext|plugin-runtime|plugin-ui' | head -30

echo ""
echo "=== HOST-CONTEXT-CAPTURE END ==="
