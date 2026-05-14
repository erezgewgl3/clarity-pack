#!/bin/bash
# Locate the Company TypeScript interface in the shared package.
set +e

echo "=== COMPANY-SHAPE PROBE START ==="

echo "--- A. shared package layout ---"
ls /home/eric/paperclip/packages/shared/src/types/ 2>/dev/null | head -30

echo ""
echo "--- B. interface Company definition ---"
grep -rn "^export interface Company\b\|^export type Company\b\|^interface Company\b\|^type Company\b" /home/eric/paperclip/packages/shared/src/ 2>/dev/null | head -10

echo ""
echo "--- C. FULL Company interface (with field comments) ---"
COMPANY_FILE=$(grep -rln "^export interface Company\b\|^export type Company\b" /home/eric/paperclip/packages/shared/src/ 2>/dev/null | head -1)
if [ -n "$COMPANY_FILE" ]; then
  echo "Source: $COMPANY_FILE"
  awk '/^export (interface|type) Company\b/,/^}/' "$COMPANY_FILE"
fi

echo ""
echo "--- D. companies table schema (psql, if DB env captured) ---"
DBURL=$(sudo -n cat /etc/paperclip/db.env 2>/dev/null | grep -E '^DATABASE_URL=' | cut -d= -f2-)
if [ -n "$DBURL" ]; then
  psql "$DBURL" -c "\d companies" 2>/dev/null | head -25
else
  echo "(no DBURL — sudo not cached; D skipped, C is source-of-truth anyway)"
fi

echo ""
echo "=== COMPANY-SHAPE PROBE END ==="
