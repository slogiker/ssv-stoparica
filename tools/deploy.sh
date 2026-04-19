#!/bin/bash
# deploy.sh — pull latest changes and restart the stack
#
# Usage:
#   bash tools/deploy.sh          # normal redeploy (uses Docker cache)
#   bash tools/deploy.sh --clean  # full rebuild, no cache (after major changes)
#
# DB data is in a named Docker volume (sqlite_data) — never touched by this script.

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/docker-compose.yml"
CLEAN=0

for arg in "$@"; do
  [ "$arg" = "--clean" ] && CLEAN=1
done

echo "==> SSV Stoparica deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "    Repo: $REPO_DIR"
[ "$CLEAN" = "1" ] && echo "    Mode: CLEAN REBUILD (no cache)"

echo ""
echo "==> Stopping containers..."
docker compose -f "$COMPOSE_FILE" down

echo "==> Pulling latest changes from git..."
git -C "$REPO_DIR" pull

if [ "$CLEAN" = "1" ]; then
  echo "==> Removing old images..."
  docker compose -f "$COMPOSE_FILE" build --no-cache --pull
else
  echo "==> Rebuilding images (with cache)..."
  docker compose -f "$COMPOSE_FILE" build --pull
fi

echo "==> Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Waiting for backend to become healthy..."
TIMEOUT=60
for i in $(seq 1 $TIMEOUT); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' \
    "$(docker compose -f "$COMPOSE_FILE" ps -q backend 2>/dev/null)" 2>/dev/null || echo "")
  if [ "$STATUS" = "healthy" ]; then
    echo "    Backend healthy after ${i}s."
    break
  fi
  if [ "$i" = "$TIMEOUT" ]; then
    echo "WARNING: Backend not healthy after ${TIMEOUT}s. Showing logs:"
    docker compose -f "$COMPOSE_FILE" logs --tail=30 backend
    exit 1
  fi
  printf "."
  sleep 1
done

echo ""
echo "==> Done. Stack status:"
docker compose -f "$COMPOSE_FILE" ps

if [ "$CLEAN" = "1" ]; then
  echo ""
  echo "==> Pruning unused Docker images..."
  docker image prune -f
fi

echo ""
echo "Stack is up at http://localhost:8742"
