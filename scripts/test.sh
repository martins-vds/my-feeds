#!/bin/bash
# Run all tests

set -e

SCRIPT_DIR="$(dirname "$0")"
ROOT_DIR="$SCRIPT_DIR/.."

echo "🧪 Running tests..."
echo ""

echo "=== Backend Tests ==="
cd "$ROOT_DIR/backend"
uv run pytest "$@"

echo ""
echo "=== Frontend Unit Tests ==="
cd "$ROOT_DIR/frontend"
pnpm test

echo ""
echo "✅ All tests complete!"
