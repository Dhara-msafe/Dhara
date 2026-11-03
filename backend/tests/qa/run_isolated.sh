#!/usr/bin/env bash
# Isolated QA backend suite (Gate 1). Never touches the shared preview DB.
#   bash tests/qa/run_isolated.sh            # full suite
#   bash tests/qa/run_isolated.sh tests/test_x.py   # subset
set -euo pipefail
cd "$(dirname "$0")/../.."
export DB_NAME="${QA_DB_NAME:-dhara_qa_g1}"
case "$DB_NAME" in dhara_qa_*) ;; *) echo "DB_NAME must start with dhara_qa_"; exit 2;; esac
export OUTBOUND_MODE=simulate                       # no real push / email / ops alerts
export QA_PORT="${QA_PORT:-8002}"
export EXPO_BACKEND_URL="http://127.0.0.1:${QA_PORT}"
export EXPO_PUBLIC_BACKEND_URL="$EXPO_BACKEND_URL"
# Isolated secrets for tests that need them (value never printed).
export ADMIN_KEY="$(grep '^ADMIN_KEY=' .env | cut -d= -f2- | tr -d '"')"
export MONGO_URL="$(grep '^MONGO_URL=' .env | cut -d= -f2- | tr -d '"')"

python tests/qa/seed_qa_env.py
if ! curl -sf "$EXPO_BACKEND_URL/api/health" >/dev/null; then
  setsid nohup python -m uvicorn server:app --host 127.0.0.1 --port "$QA_PORT" > /tmp/qa_backend.log 2>&1 < /dev/null &
  for _ in $(seq 1 30); do curl -sf "$EXPO_BACKEND_URL/api/health" >/dev/null && break; sleep 1; done
fi
curl -s "$EXPO_BACKEND_URL/api/health" | grep -q '"outbound_mode":"simulate"' || { echo "QA backend not in simulate mode"; exit 3; }

REG_MD5_BEFORE="$(md5sum data/approval_evidence_registry.json ipc_bns_mapping.json)"
if [ "$#" -gt 0 ]; then FILES=("$@"); else mapfile -t FILES < <(ls tests/test_*.py); fi
set +e
python -m pytest "${FILES[@]}" -q -p no:cacheprovider -rfE --junitxml=/tmp/qa_g1.xml
RC=$?
set -e
[ "$REG_MD5_BEFORE" = "$(md5sum data/approval_evidence_registry.json ipc_bns_mapping.json)" ] \
  && echo "[qa] legal registry + mapping unchanged" || { echo "[qa] LEGAL FILES CHANGED"; exit 4; }
exit $RC
