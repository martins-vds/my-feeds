#!/bin/sh
set -eu

cd /app/backend
alembic upgrade head
exec hypercorn app.main:app --bind "0.0.0.0:${PORT:-8000}" --workers 1
