#!/usr/bin/env bash
# Workspace isolation + server-side permission proof (F1.5, F1.6, F4.3, Q2) — owner: Musa.
# Usage: BASE=https://<app>.up.railway.app bash server/scripts/isolation-test.sh   (default http://localhost:8080)
# Needs the seed data (node server/db/seed.js --reset). Exit code 1 if any check fails.
set -u
BASE="${BASE:-http://localhost:8080}"; API="$BASE/api/v1"; PW='Demo1234!'
TMP=$(mktemp -d); PASS=0; FAIL=0
login() { curl -s -c "$TMP/$1" -b "$TMP/$1" -X POST "$API/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$2\",\"password\":\"$PW\"}" -o /dev/null -w '%{http_code}'; }
req() { local jar=$1 m=$2 p=$3; shift 3; local cs; cs=$(awk '/bmp_csrf/{print $7}' "$TMP/$jar"); curl -s -b "$TMP/$jar" -X "$m" "$API$p" -H 'content-type: application/json' -H "x-csrf-token: $cs" -o "$TMP/out" -w '%{http_code}' "$@"; }
expect() { local want=$1 got=$2 label=$3; if [ "$got" = "$want" ]; then PASS=$((PASS+1)); echo "  ✅ $label → $got"; else FAIL=$((FAIL+1)); echo "  ❌ $label → got $got, expected $want  $(head -c 160 "$TMP/out")"; fi; }
jget() { python3 -c "import sys,json;d=json.load(open('$TMP/out'));print($1)"; }

echo "Target: $API"
[ "$(login acme owner@acme.test)" = 200 ] || { echo "cannot log in as owner@acme.test — run the seed"; exit 1; }
login rep ahmed@acme.test >/dev/null; login beta owner@beta.test >/dev/null

req acme GET '/contacts?limit=1' >/dev/null; CID=$(jget "d['data'][0]['id']")
req acme GET '/opportunities?limit=1' >/dev/null; OID=$(jget "d['data'][0]['id']")
req acme GET '/companies?limit=1' >/dev/null; COID=$(jget "d['data'][0]['id']")
req acme GET '/users' >/dev/null; UID2=$(jget "d['data'][-1]['id']")

echo "1. Another workspace guessing Acme IDs (must be 404, never data)"
expect 404 "$(req beta GET "/contacts/$CID")" "Beta GET contact"
expect 404 "$(req beta GET "/contacts/$CID/full")" "Beta GET contact full view"
expect 404 "$(req beta PATCH "/contacts/$CID" -d '{"name":"pwned","version":1}')" "Beta PATCH contact"
expect 404 "$(req beta DELETE "/contacts/$CID")" "Beta DELETE contact"
expect 404 "$(req beta GET "/opportunities/$OID")" "Beta GET opportunity"
expect 404 "$(req beta POST "/opportunities/$OID/move" -d '{"stage_id":"00000000-0000-0000-0000-000000000000","version":1}')" "Beta move opportunity"
expect 404 "$(req beta GET "/companies/$COID")" "Beta GET company"
expect 404 "$(req beta PATCH "/users/$UID2" -d '{"name":"pwned"}')" "Beta PATCH Acme user"
req beta GET '/contacts?limit=100' >/dev/null; LEAK=$(jget "sum(1 for c in d['data'] if c['id']=='$CID')")
expect 0 "$LEAK" "Beta contact list contains no Acme rows"
expect 400 "$(req beta POST '/notes' -d "{\"contact_id\":\"$CID\",\"body\":\"x\"}")" "Beta note on Acme contact rejected"

echo "2. Server-side permissions (Sales Rep, direct API calls)"
expect 403 "$(req rep DELETE "/contacts/$CID")" "Rep DELETE contact (no crm.delete)"
expect 403 "$(req rep GET '/export/contacts.csv')" "Rep export (no crm.export)"
expect 403 "$(req rep GET '/audit')" "Rep audit log (no audit.view)"
expect 403 "$(req rep POST '/roles' -d '{"name":"x"}')" "Rep create role (no users.manage)"
expect 403 "$(req rep POST '/custom-fields' -d '{"entity":"contact","label":"x","type":"text"}')" "Rep create field (no pipeline.manage)"
req rep GET "/opportunities/$OID" >/dev/null; expect None "$(jget "d['data']['value_cents']")" "Rep sees opportunity value masked"

echo "3. Audit log is tamper-proof"
expect 404 "$(req acme DELETE '/audit/anything')" "DELETE /audit/:id has no route"
expect 404 "$(req acme PATCH '/audit/anything' -d '{}')" "PATCH /audit/:id has no route"

echo "4. Unauthenticated + forged CSRF"
expect 401 "$(curl -s -o "$TMP/out" -w '%{http_code}' "$API/contacts")" "No session → 401"
CS_BAD=$(curl -s -b "$TMP/acme" -X POST "$API/notes" -H 'content-type: application/json' -H 'x-csrf-token: forged' -d "{\"contact_id\":\"$CID\",\"body\":\"x\"}" -o "$TMP/out" -w '%{http_code}')
expect 403 "$CS_BAD" "Cookie session with forged CSRF token"

echo; echo "Passed: $PASS  Failed: $FAIL"; rm -rf "$TMP"; [ "$FAIL" = 0 ]
