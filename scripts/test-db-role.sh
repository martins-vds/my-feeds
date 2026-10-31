#!/usr/bin/env bash
# Runs against its own socket-only, disposable local cluster; never a configured DB.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
bin="${POSTGRES_BIN:-}"
if [ -z "$bin" ]; then
  bin=$(dirname "$(command -v initdb)") || { echo "Set POSTGRES_BIN to local PostgreSQL binaries" >&2; exit 77; }
fi
testdir="${POSTGRES_TEST_DATA_DIR:-$root/.security-tools/db-role-validation}"
[ ! -e "$testdir" ] || { echo "Refusing to overwrite an existing test cluster" >&2; exit 2; }
mkdir -p "$testdir"
cleanup() {
  "$bin/pg_ctl" -D "$testdir/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$testdir"
}
trap cleanup EXIT
"$bin/initdb" -D "$testdir/data" --username=myfeeds_admin --auth=trust --no-locale >/dev/null
"$bin/pg_ctl" -D "$testdir/data" -l "$testdir/server.log" \
  -o "-k $testdir -h '' -p 55433" -w start >/dev/null
export PGHOST="$testdir" PGPORT=55433 PGUSER=myfeeds_admin PGDATABASE=myfeeds
export POSTGRES_USER=myfeeds_admin
export PGPASSWORD=validation_administrator_password_not_for_use
export POSTGRES_RUNTIME_PASSWORD=validation_runtime_password_not_for_use
"$bin/createdb" myfeeds
psql() { "$bin/psql" -X --set=ON_ERROR_STOP=1 "$@"; }
psql -c 'CREATE TABLE before_migration (id serial PRIMARY KEY, value text)' >/dev/null
psql --file="$root/init-db.sql" >/dev/null
psql -c "GRANT CREATE ON SCHEMA public TO myfeeds_runtime; GRANT CREATE,TEMPORARY ON DATABASE myfeeds TO myfeeds_runtime; GRANT TRUNCATE ON before_migration TO myfeeds_runtime; GRANT UPDATE ON SEQUENCE before_migration_id_seq TO myfeeds_runtime" >/dev/null
psql -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO myfeeds_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO myfeeds_runtime" >/dev/null
psql --file="$root/init-db.sql" >/dev/null
psql -c 'CREATE TABLE posts (id serial PRIMARY KEY, value text); CREATE TABLE alembic_version(version_num text)' >/dev/null
psql --file="$root/init-db.sql" >/dev/null
psql -c 'CREATE TABLE future_posts(id serial PRIMARY KEY, value text)' >/dev/null
export PGUSER=myfeeds_runtime
psql -c "INSERT INTO before_migration(value) VALUES('before'); INSERT INTO posts(value) VALUES('after'); UPDATE posts SET value='updated'; SELECT * FROM posts; DELETE FROM posts" >/dev/null
for denied in \
  'CREATE TABLE forbidden(id int)' \
  'CREATE SCHEMA forbidden' \
  'CREATE TEMP TABLE forbidden(id int)' \
  'TRUNCATE before_migration' \
  'TRUNCATE future_posts' \
  "SELECT setval('before_migration_id_seq', 1000)" \
  'DROP TABLE posts' \
  'CREATE DATABASE forbidden' \
  'CREATE ROLE forbidden' \
  'SELECT * FROM alembic_version' \
  "UPDATE alembic_version SET version_num='forged'" \
  'SET ROLE myfeeds_admin'; do
  if psql -c "$denied" >"$testdir/denied.log" 2>&1; then
    echo "Runtime operation unexpectedly allowed: $denied" >&2
    exit 1
  fi
done
flags=$(psql -At -c "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user")
[ "$flags" = 'f|f|f|f|f|f' ] || { echo "Unexpected runtime role flags: $flags" >&2; exit 1; }
export PGUSER=myfeeds_admin
if POSTGRES_RUNTIME_PASSWORD=short psql --file="$root/init-db.sql" >"$testdir/denied.log" 2>&1; then
  echo "Unsafe runtime password accepted" >&2
  exit 1
fi
psql -c 'ALTER TABLE posts OWNER TO myfeeds_runtime' >/dev/null
if psql --file="$root/init-db.sql" >"$testdir/denied.log" 2>&1; then
  echo "Runtime object ownership incorrectly accepted" >&2
  exit 1
fi
echo "PASS: idempotent provisioning, existing/future DML, denied DDL/IAM/migration-table access, fail-closed credentials"
