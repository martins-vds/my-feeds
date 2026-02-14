#!/bin/bash
set -e

echo "📦 Installing backend dependencies..."
cd /workspace/backend
~/.local/bin/uv sync

echo "📦 Installing pnpm..."
npm install -g pnpm@8

echo "📦 Installing frontend dependencies..."
cd /workspace/frontend
pnpm install

echo "✅ Post-create setup complete!"
