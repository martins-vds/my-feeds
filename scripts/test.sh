#!/bin/bash
# Run all tests inside the docker compose dev services.
#
# Brings up the dev stack (postgres + migrations + backend + frontend) and runs
# the backend (pytest) and frontend (vitest) suites inside their containers.
# Extra args are forwarded to pytest, e.g.:  ./scripts/test.sh tests/unit -k feed

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "🐳 Starting dev stack (postgres + migrations + backend + frontend)..."
docker compose up -d --build backend frontend

echo ""
echo "=== Backend Tests (pytest) ==="
docker compose exec -T backend pytest "$@"

echo ""
echo "=== Frontend Unit Tests (vitest) ==="
docker compose exec -T frontend pnpm test

echo ""
echo "✅ All tests complete!"
