#!/bin/bash
# Start the frontend development server

set -e

cd "$(dirname "$0")/../frontend"

echo "🚀 Starting frontend server..."
echo "   URL: http://localhost:5173"
echo ""

pnpm dev
