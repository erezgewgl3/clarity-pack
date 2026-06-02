#!/usr/bin/env bash
# Launcher for the unblock-resume spike on BEAAA. Reads the bearer token from
# auth.json (never echoed), auto-finds the [SPIKE 10] sacrificial agent by name,
# pins it, and runs the combined probe (dry-confirm A1 + three shapes).
set -uo pipefail

AUTH=/home/beai-agent/.paperclip/auth.json
COMPANY=59f8876e-e729-4dda-98f9-1317c2b50492

KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=Object.values(a.credentials||{})[0]||{};process.stdout.write(v.token||v.accessToken||v.bearerToken||v.apiKey||Object.values(v).filter(x=>typeof x==="string").sort((p,q)=>q.length-p.length)[0]||"")' "$AUTH")"
if [ -z "$KEY" ]; then echo "FATAL: no token in $AUTH"; exit 3; fi

# Prefer an explicitly operator-pinned agent id (passed in the environment);
# only fall back to name-inference if none is provided.
PROBE_AGENT="${SPIKE_PROBE_AGENT_ID:-}"
if [ -z "$PROBE_AGENT" ]; then
  PROBE_AGENT="$(curl -s -H "authorization: Bearer $KEY" "http://localhost:3100/api/companies/${COMPANY}/agents" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a;try{a=JSON.parse(s)}catch{a=[]}const arr=Array.isArray(a)?a:(a.items||a.agents||a.data||[]);const m=arr.find(x=>/spike\s*10/i.test(x&&x.name||""));process.stdout.write(m&&m.id?m.id:"")})')"
fi
echo "probe agent: ${PROBE_AGENT:-NOT FOUND}"
if [ -z "$PROBE_AGENT" ]; then echo "FATAL: no [SPIKE 10] agent found — hire one named with [SPIKE 10] first"; exit 2; fi

echo "=== STARTING COMBINED SPIKE RUN $(date -u +%FT%TZ) ==="
PAPERCLIP_API_URL=http://localhost:3100 \
PAPERCLIP_API_KEY="$KEY" \
PAPERCLIP_COMPANY_ID="$COMPANY" \
SPIKE_PROBE_AGENT_ID="$PROBE_AGENT" \
  node ~/unblock-resume-spike-probe.mjs
echo "=== SPIKE RUN EXIT=$? $(date -u +%FT%TZ) ==="
