#!/usr/bin/env bash
# SSV Stoparica API test wrapper.
#
# 1. Checks if the stack is running (HTTP probe against the API base URL).
# 2. Runs the Node.js API test suite.
# 3. Exits with the test runner's exit code.
#
# Usage:
#   tools/test-api.sh [BASE_URL]
#
# Default BASE_URL: http://localhost:8742/api
set -u

BASE_URL="${1:-http://localhost:8742/api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_SCRIPT="${SCRIPT_DIR}/test-api.js"

echo "SSV Stoparica API tests"
echo "  BASE_URL: ${BASE_URL}"
echo

# ── 1. Check if the stack is running ─────────────────────────────────────────

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required but not installed." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required but not installed." >&2
  exit 2
fi

if [ ! -f "${NODE_SCRIPT}" ]; then
  echo "ERROR: cannot find ${NODE_SCRIPT}" >&2
  exit 2
fi

# Probe the API itself: GET /api/runs should return 401 (not 502 / connection refused).
# This confirms nginx is up AND it can talk to the backend.
echo -n "Probing ${BASE_URL}/runs (expect 401 Unauthorized) ... "
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${BASE_URL}/runs" 2>/dev/null || echo "000")"

if [ "${HTTP_CODE}" = "000" ]; then
  echo "FAILED"
  echo
  echo "Cannot reach ${BASE_URL}." >&2
  echo "Start the stack first, e.g.:" >&2
  echo "  docker compose up -d" >&2
  exit 2
elif [ "${HTTP_CODE}" != "401" ]; then
  echo "HTTP ${HTTP_CODE} (unexpected)"
  echo
  echo "WARNING: Got HTTP ${HTTP_CODE} instead of 401 — the stack may not be healthy." >&2
  echo "Continuing anyway, but tests may fail." >&2
else
  echo "HTTP 401 OK"
fi
echo

# ── 2. Run the Node.js tests ─────────────────────────────────────────────────

node "${NODE_SCRIPT}" "${BASE_URL}"
STATUS=$?

# ── 3. Print result banner ────────────────────────────────────────────────────

echo
if [ ${STATUS} -eq 0 ]; then
  echo "All API tests passed."
else
  echo "Some API tests failed (exit code ${STATUS})."
fi

exit ${STATUS}
