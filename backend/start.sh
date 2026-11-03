#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -d "$script_dir/backend" ]; then cd "$script_dir/backend"; else cd "$script_dir"; fi

# The administrator URL and testing settings reach only the alembic child, never this shell.
run_migrations() {
    DATABASE_URL="$MIGRATION_DATABASE_URL" ENVIRONMENT=testing DEBUG=false alembic upgrade head
}

if [ "${1:-serve}" = migrate ]; then
    : "${MIGRATION_DATABASE_URL:?An administrator URL is required for explicit migrations}"
    run_migrations
    exit 0
fi
if [ "${1:-serve}" != serve ]; then
    echo "Usage: start.sh [serve|migrate]" >&2
    exit 2
fi
: "${DATABASE_URL:?Runtime database URL is required}"
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
    run_migrations
fi
unset MIGRATION_DATABASE_URL POSTGRES_PASSWORD POSTGRES_RUNTIME_PASSWORD
exec hypercorn app.main:app --bind "0.0.0.0:${PORT:-5000}" --workers 1
