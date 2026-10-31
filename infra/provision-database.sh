#!/usr/bin/env bash
# Privileged operator path. Run from a private-network host with psql + Alembic.
# Never give these credentials or this execution capability to runtime deployment.
set -euo pipefail
: "${PGHOST:?Set the private PostgreSQL hostname}" "${PGDATABASE:?Set the application database}"
: "${POSTGRES_USER:?Set the migration administrator username}"
: "${POSTGRES_PASSWORD:?Set the migration administrator password}"
: "${POSTGRES_RUNTIME_PASSWORD:?Set a distinct random runtime password}"
: "${MIGRATION_DATABASE_URL:?Set the administrator asyncpg URL with ssl=require}"
[[ "$MIGRATION_DATABASE_URL" =~ [\?\&]ssl=require(\&|$) ]] || {
  echo "Migration database URL must require TLS" >&2; exit 2;
}
[ "$POSTGRES_PASSWORD" != "$POSTGRES_RUNTIME_PASSWORD" ] || {
  echo "Runtime and administrator passwords must differ" >&2; exit 2;
}
command -v psql >/dev/null
command -v alembic >/dev/null
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGSSLMODE=require
psql -X --set=ON_ERROR_STOP=1 --file="$root/init-db.sql"
sh "$root/backend/start.sh" migrate
psql -X --set=ON_ERROR_STOP=1 --file="$root/init-db.sql"
echo "Migrations and runtime grants applied. Publish only the runtime URL to the web app."
