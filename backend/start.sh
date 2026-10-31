#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -d "$script_dir/backend" ]; then cd "$script_dir/backend"; else cd "$script_dir"; fi

if [ "${1:-serve}" = migrate ]; then
    : "${MIGRATION_DATABASE_URL:?An administrator URL is required for explicit migrations}"
    export DATABASE_URL="$MIGRATION_DATABASE_URL"
    export ENVIRONMENT=testing DEBUG=false
    exec alembic upgrade head
fi
if [ "${1:-serve}" != serve ]; then
    echo "Usage: start.sh [serve|migrate]" >&2
    exit 2
fi
: "${DATABASE_URL:?Runtime database URL is required}"
unset MIGRATION_DATABASE_URL POSTGRES_PASSWORD POSTGRES_RUNTIME_PASSWORD
exec hypercorn app.main:app --bind "0.0.0.0:${PORT:-5000}" --workers 1
