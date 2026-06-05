#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SCRIPT="$ROOT_DIR/setup-computer-b.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$SETUP_SCRIPT" ]] || fail "setup-computer-b.sh is missing"
bash -n "$SETUP_SCRIPT" || fail "setup-computer-b.sh has invalid shell syntax"

grep -q -- '--check' "$SETUP_SCRIPT" || fail "--check mode is missing"
grep -q 'GoogleDrive-' "$SETUP_SCRIPT" || fail "Google Drive mount detection is missing"
grep -q 'batiflow-vault' "$SETUP_SCRIPT" || fail "vault detection is missing"
grep -q 'read -r -s' "$SETUP_SCRIPT" || fail "secret values are not entered silently"
grep -q 'chmod 600' "$SETUP_SCRIPT" || fail "local env permissions are not restricted"
grep -q 'worker:register' "$SETUP_SCRIPT" || fail "daily sync LaunchAgent registration is missing"
grep -q 'gateway start' "$SETUP_SCRIPT" || fail "Hermes Gateway startup is missing"
grep -q 'upsert_env_value' "$SETUP_SCRIPT" || fail "Hermes env values are overwritten instead of merged"
grep -q 'youtube-transcript-api' "$SETUP_SCRIPT" || fail "Python YouTube transcript dependency is missing"

if grep -Eq 'setup/(batiflow|hermes)\.env|cp .*\.env' "$SETUP_SCRIPT"; then
  fail "legacy Google Drive env copying is still present"
fi
if grep -q 'com.batiflow.bot' "$SETUP_SCRIPT"; then
  fail "BatiFlow bot must not run beside Hermes Gateway with the same Telegram token"
fi

printf 'PASS: Computer B bootstrap contract\n'
