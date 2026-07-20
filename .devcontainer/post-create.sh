#!/bin/bash
# Install local development tooling for the dev container.
# The application itself (backend, frontend, postgres, migrations) runs via
# `docker compose up` — see the repository README.
set -e

export PATH="$HOME/.local/bin:$PATH"

echo "📦 Installing backend dependencies (uv)..."
(cd backend && uv sync --extra dev)

echo "📦 Installing pnpm..."
npm install -g pnpm@latest-10

echo "📦 Installing frontend dependencies (pnpm)..."
(cd frontend && pnpm install)

echo "🎭 Installing Playwright browsers..."
(cd frontend && npx playwright install --with-deps chromium)

echo "✅ Dev tooling ready."
echo "   Start the full stack with:  docker compose up --build"
