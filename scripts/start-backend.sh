#!/bin/bash
# Start the backend development server

set -e

cd "$(dirname "$0")/../backend"

echo "🚀 Starting backend server..."
echo "   URL: http://localhost:5000"
echo ""

uv run quart --app app.main:app run --host 0.0.0.0 --port 5000 --reload
