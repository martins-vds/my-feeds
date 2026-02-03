#!/bin/bash
# Install all project dependencies

set -e

SCRIPT_DIR="$(dirname "$0")"
ROOT_DIR="$SCRIPT_DIR/.."

echo "📦 Installing dependencies..."
echo ""

echo "Installing backend dependencies..."
cd "$ROOT_DIR/backend"
uv sync

echo ""
echo "Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
pnpm install

echo ""
echo "✅ All dependencies installed!"
