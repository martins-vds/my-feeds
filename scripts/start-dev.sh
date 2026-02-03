#!/bin/bash
# Start both backend and frontend development servers

set -e

SCRIPT_DIR="$(dirname "$0")"

echo "🚀 Starting my-feeds development servers..."
echo ""

# Start backend in background
"$SCRIPT_DIR/start-backend.sh" &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend in background
"$SCRIPT_DIR/start-frontend.sh" &
FRONTEND_PID=$!

echo ""
echo "✅ Servers started:"
echo "   Backend:  http://localhost:5000 (PID: $BACKEND_PID)"
echo "   Frontend: http://localhost:5173 (PID: $FRONTEND_PID)"
echo ""
echo "Press Ctrl+C to stop all servers"

# Handle Ctrl+C to stop both servers
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

# Wait for both processes
wait
