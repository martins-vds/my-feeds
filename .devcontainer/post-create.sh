#!/bin/bash
set -e

echo "📦 Installing backend dependencies..."
cd /workspace/backend
sudo chown vscode:vscode .venv
~/.local/bin/uv sync

echo "📦 Installing pnpm..."
npm install -g pnpm@latest-10

echo "📦 Installing frontend dependencies..."
cd /workspace/frontend
sudo chown vscode:vscode node_modules
pnpm install

echo "✅ Post-create setup complete!"
