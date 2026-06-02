#!/usr/bin/env bash
# READ-ONLY: list any [SPIKE 10]-named agents (id, name, status) so the operator
# can confirm/pin the exact sacrificial agent id. No writes.
set -uo pipefail
AUTH=/home/beai-agent/.paperclip/auth.json
COMPANY=59f8876e-e729-4dda-98f9-1317c2b50492
KEY="$(node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=Object.values(a.credentials||{})[0]||{};process.stdout.write(v.token||v.accessToken||v.bearerToken||v.apiKey||Object.values(v).filter(x=>typeof x==="string").sort((p,q)=>q.length-p.length)[0]||"")' "$AUTH")"
curl -s -H "authorization: Bearer $KEY" "http://localhost:3100/api/companies/${COMPANY}/agents" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a;try{a=JSON.parse(s)}catch{a=[]}const arr=Array.isArray(a)?a:(a.items||a.agents||a.data||[]);const m=arr.filter(x=>/spike\s*10/i.test(x&&x.name||""));console.log("matches="+m.length);for(const x of m)console.log(JSON.stringify({id:x.id,name:x.name,status:x.status||x.state||null}));})'
