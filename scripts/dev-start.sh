#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== SSV Stoparica — dev start ==="

# 1. Backend deps
cd "$ROOT/backend"
if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install
fi

# 2. Create data dir for SQLite
mkdir -p "$ROOT/backend/data"

# 3. Seed DB if empty
echo "Seeding database..."
node seed.js

# 4. Start backend
echo "Starting backend on :4827..."
node index.js &
BACKEND_PID=$!
sleep 1

# 5. Start dev proxy
echo "Starting dev proxy on :8080..."
python3 "$ROOT/scripts/dev-proxy.py" 8080 &
PROXY_PID=$!
sleep 1

# 6. Open Chrome with a fresh throwaway profile (no cache, no SW state)
DEV_PROFILE="$(mktemp -d /tmp/ssv-dev-chrome-XXXXX)"
echo "Opening Chrome (fresh profile: $DEV_PROFILE)..."
google-chrome \
  --new-window \
  --user-data-dir="$DEV_PROFILE" \
  --disable-application-cache \
  --disk-cache-size=0 \
  "http://localhost:8080" \
  2>/dev/null &

echo ""
echo "Running:"
echo "  Backend  PID $BACKEND_PID  → http://localhost:4827"
echo "  Proxy    PID $PROXY_PID   → http://localhost:8080"
echo "  Profile  $DEV_PROFILE (deleted on exit)"
echo ""
echo "Login: test / test"
echo ""
echo "Press Ctrl+C to stop all."

# Wait and clean up on exit
trap "kill $BACKEND_PID $PROXY_PID 2>/dev/null; rm -rf '$DEV_PROFILE'; echo 'Stopped.'" EXIT INT
wait
