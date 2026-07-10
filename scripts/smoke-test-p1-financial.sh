#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://api.tapgolion.id}"
TOKEN="${TAPGO_TEST_TOKEN:-}"
EXPECT_ADMIN_FORBIDDEN="${TAPGO_EXPECT_ADMIN_FORBIDDEN:-0}"
USER_PHONE="${TAPGO_USER_PHONE:-}"
USER_PASSWORD="${TAPGO_USER_PASSWORD:-}"
ADMIN_PHONE="${TAPGO_ADMIN_PHONE:-}"
ADMIN_PASSWORD="${TAPGO_ADMIN_PASSWORD:-}"
SUPER_ADMIN_PHONE="${TAPGO_SUPER_ADMIN_PHONE:-}"
SUPER_ADMIN_PASSWORD="${TAPGO_SUPER_ADMIN_PASSWORD:-}"

API_BASE_URL="${API_BASE_URL%/}"

info() {
  printf '[tapgo-smoke] %s\n' "$1"
}

fail() {
  printf '[tapgo-smoke] FAIL: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require_cmd curl

if command -v node >/dev/null 2>&1; then
  HAS_NODE=1
else
  HAS_NODE=0
fi

info "API base: ${API_BASE_URL}"

login_token() {
  local label="$1"
  local phone="$2"
  local password="$3"
  local output_file="/tmp/tapgo_p1_${label}_login.json"

  if [ -z "$phone" ] || [ -z "$password" ]; then
    info "Skipping ${label} login; phone/password env not provided"
    return 0
  fi

  info "Checking ${label} login"
  local status
  status="$(curl -s -o "$output_file" -w '%{http_code}' \
    -X POST "${API_BASE_URL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"${phone}\",\"password\":\"${password}\"}")"

  if [ "$status" != "200" ]; then
    cat "$output_file" >&2 || true
    fail "${label} login returned HTTP ${status}"
  fi

  if [ "$HAS_NODE" = "1" ]; then
    node - "$output_file" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const token = body?.data?.accessToken ?? body?.data?.token ?? body?.accessToken ?? body?.token;
if (!token) {
  console.error('Login response does not contain access token');
  process.exit(1);
}
console.log(`[tapgo-smoke] Login token present: true`);
NODE
  else
    grep -Eq '"(accessToken|token)"' "$output_file" || fail "${label} login response missing token"
    info "${label} login token present"
  fi
}

extract_token() {
  local file="$1"
  if [ "$HAS_NODE" = "1" ] && [ -f "$file" ]; then
    node - "$file" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const token = body?.data?.accessToken ?? body?.data?.token ?? body?.accessToken ?? body?.token ?? '';
process.stdout.write(token);
NODE
  fi
}

check_admin_endpoint() {
  local label="$1"
  local token="$2"
  local endpoint="$3"
  local expected="$4"
  local body_file="/tmp/tapgo_p1_${label}_$(printf '%s' "$endpoint" | tr '/?' '__').json"

  if [ -z "$token" ]; then
    info "Skipping ${label} ${endpoint}; token not available"
    return 0
  fi

  local status
  status="$(curl -s -o "$body_file" -w '%{http_code}' \
    "${API_BASE_URL}${endpoint}" \
    -H "Authorization: Bearer ${token}")"

  if [ "$status" != "$expected" ]; then
    cat "$body_file" >&2 || true
    fail "${label} ${endpoint} expected HTTP ${expected}, got ${status}"
  fi

  info "${label} ${endpoint} OK (${status})"
}

info "Checking health endpoint"
HEALTH_BODY="$(curl -fsS "${API_BASE_URL}/health")" || fail "Health endpoint failed"
printf '%s\n' "$HEALTH_BODY" | head -c 500
printf '\n'

info "Checking API v1 health if available"
API_HEALTH_STATUS="$(curl -s -o /tmp/tapgo_api_v1_health_body.txt -w '%{http_code}' "${API_BASE_URL}/api/v1/health" || true)"
if [ "$API_HEALTH_STATUS" = "200" ]; then
  info "API v1 health OK"
else
  info "API v1 health returned ${API_HEALTH_STATUS}; continuing because /health is authoritative"
fi

login_token "super-admin" "$SUPER_ADMIN_PHONE" "$SUPER_ADMIN_PASSWORD"
login_token "admin" "$ADMIN_PHONE" "$ADMIN_PASSWORD"
login_token "user" "$USER_PHONE" "$USER_PASSWORD"

SUPER_ADMIN_TOKEN="$(extract_token /tmp/tapgo_p1_super-admin_login.json || true)"
ADMIN_TOKEN="$(extract_token /tmp/tapgo_p1_admin_login.json || true)"
USER_LOGIN_TOKEN="$(extract_token /tmp/tapgo_p1_user_login.json || true)"

if [ -z "$TOKEN" ] && [ -n "$USER_LOGIN_TOKEN" ]; then
  TOKEN="$USER_LOGIN_TOKEN"
fi

check_admin_endpoint "user-guard" "$USER_LOGIN_TOKEN" "/api/v1/admin/dashboard/summary" "403"
check_admin_endpoint "admin" "$ADMIN_TOKEN" "/api/v1/admin/dashboard/summary" "200"
check_admin_endpoint "admin" "$ADMIN_TOKEN" "/api/v1/admin/rewards" "200"
check_admin_endpoint "admin" "$ADMIN_TOKEN" "/api/v1/admin/reports/financial-summary" "200"
check_admin_endpoint "super-admin" "$SUPER_ADMIN_TOKEN" "/api/v1/admin/dashboard/summary" "200"
check_admin_endpoint "super-admin" "$SUPER_ADMIN_TOKEN" "/api/v1/admin/rewards" "200"
check_admin_endpoint "super-admin" "$SUPER_ADMIN_TOKEN" "/api/v1/admin/reports/financial-summary" "200"

if [ -z "$TOKEN" ]; then
  info "TAPGO_TEST_TOKEN not provided; skipping authenticated wallet/admin checks"
  info "Smoke test completed without mutating production data"
  exit 0
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"

info "Checking wallet endpoint"
WALLET_BODY_FILE="/tmp/tapgo_p1_wallet_response.json"
WALLET_STATUS="$(curl -s -o "$WALLET_BODY_FILE" -w '%{http_code}' \
  "${API_BASE_URL}/api/v1/wallet" \
  -H "$AUTH_HEADER")"

if [ "$WALLET_STATUS" != "200" ]; then
  cat "$WALLET_BODY_FILE" >&2 || true
  fail "Wallet endpoint returned HTTP ${WALLET_STATUS}"
fi

if [ "$HAS_NODE" = "1" ]; then
  node - "$WALLET_BODY_FILE" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const body = JSON.parse(fs.readFileSync(path, 'utf8'));
const data = body.data ?? body;
const missing = ['balance', 'cashBalance', 'ppobBalance'].filter((key) => !(key in data));
if (missing.length) {
  console.error(`Missing wallet field(s): ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`[tapgo-smoke] Wallet fields OK: balance=${data.balance}, cashBalance=${data.cashBalance}, ppobBalance=${data.ppobBalance}`);
NODE
else
  grep -q '"balance"' "$WALLET_BODY_FILE" || fail "Wallet response missing balance"
  grep -q '"cashBalance"' "$WALLET_BODY_FILE" || fail "Wallet response missing cashBalance"
  grep -q '"ppobBalance"' "$WALLET_BODY_FILE" || fail "Wallet response missing ppobBalance"
  info "Wallet fields OK"
fi

info "Checking wallet transactions endpoint"
TX_STATUS="$(curl -s -o /tmp/tapgo_p1_wallet_transactions.json -w '%{http_code}' \
  "${API_BASE_URL}/api/v1/wallet/transactions?page=1&pageSize=5" \
  -H "$AUTH_HEADER")"

if [ "$TX_STATUS" != "200" ]; then
  cat /tmp/tapgo_p1_wallet_transactions.json >&2 || true
  fail "Wallet transactions endpoint returned HTTP ${TX_STATUS}"
fi
info "Wallet transactions endpoint OK"

info "Checking admin dashboard guard"
ADMIN_STATUS="$(curl -s -o /tmp/tapgo_p1_admin_summary.json -w '%{http_code}' \
  "${API_BASE_URL}/api/v1/admin/dashboard/summary" \
  -H "$AUTH_HEADER")"

if [ "$EXPECT_ADMIN_FORBIDDEN" = "1" ]; then
  if [ "$ADMIN_STATUS" != "403" ]; then
    cat /tmp/tapgo_p1_admin_summary.json >&2 || true
    fail "Expected admin endpoint to return 403 for user token, got ${ADMIN_STATUS}"
  fi
  info "Admin guard OK: normal user received 403"
else
  info "Admin dashboard status: ${ADMIN_STATUS} (set TAPGO_EXPECT_ADMIN_FORBIDDEN=1 when using a normal user token)"
fi

info "Smoke test completed without mutating production data"
