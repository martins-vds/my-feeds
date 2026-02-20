#!/bin/bash
set -e

echo "🔄 Checking database connection..."
until pg_isready -h db -U postgres; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

echo "✅ Database is ready!"

# Run migrations if they exist
if [ -f "/workspace/backend/migrations/alembic.ini" ]; then
  echo "🔄 Running database migrations..."
  cd /workspace/backend
  ~/.local/bin/uv run alembic upgrade head
  echo "✅ Migrations complete!"
fi
