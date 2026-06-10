#!/usr/bin/env bash
set -uo pipefail
PID=a763176a-2f4d-4986-b190-b5151e42cc00
CID=59f8876e-e729-4dda-98f9-1317c2b50492
ISSUE_UUID=fd895c74-8c56-4b55-ac85-b554d127bcd6
OPISSUE=dcf08299-4dc5-4c2f-9e57-db0bdf71ce1d
BODY=$(printf '{"companyId":"%s","params":{"issueId":"%s","userId":"local-board"}}' "$CID" "$ISSUE_UUID")

echo "=== raw issue.reader response (tldr fields) ==="
curl -s -X POST "http://localhost:3100/api/plugins/$PID/data/issue.reader" \
  -H 'content-type: application/json' --data "$BODY" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const x=j.data||j;console.log(JSON.stringify({tldr:x.tldr,tldrStatus:x.tldrStatus,tldrTruncated:x.tldrTruncated,keys:Object.keys(x)},null,1))}catch(e){console.log("ERR",e.message,d.slice(0,300))}})'

echo
echo "=== compile-result document on op-issue (what the Editor actually wrote) ==="
curl -s "http://localhost:3100/api/issues/$OPISSUE/documents/compile-result" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const body=j.body||j.content||j.data||j;let s=typeof body==="string"?body:JSON.stringify(body);console.log("len="+s.length); console.log(s.slice(0,700))}catch(e){console.log("RAWHEAD:",d.slice(0,400))}})'

echo
echo "=== a second issue (BEAAA-260) reader to cross-check persistence generality ==="
B2=$(printf '{"companyId":"%s","params":{"issueId":"5248d124-5b6e-4fb3-8c53-7181033e7665","userId":"local-board"}}' "$CID")
curl -s -X POST "http://localhost:3100/api/plugins/$PID/data/issue.reader" -H 'content-type: application/json' --data "$B2" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const x=j.data||j;console.log("tldrStatus="+x.tldrStatus+" tldr="+(x.tldr?String(x.tldr).slice(0,160):"(null)"))}catch(e){console.log("ERR")}})'
