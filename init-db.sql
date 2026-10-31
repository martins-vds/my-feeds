\set ON_ERROR_STOP on
-- Deliberate SQL errors fail closed: psql's \quit does not set a failure status.
\getenv runtime_password POSTGRES_RUNTIME_PASSWORD
\getenv migration_user POSTGRES_USER
\if :{?runtime_password}
\else
  \echo 'POSTGRES_RUNTIME_PASSWORD must be provided'
  SELECT 1 / 0;
\endif
\if :{?migration_user}
\else
  \echo 'POSTGRES_USER must identify the migration administrator'
  SELECT 1 / 0;
\endif

SELECT length(:'runtime_password') >= 32
  AND :'runtime_password' ~ '^[A-Za-z0-9_-]+$'
  AND :'migration_user' <> 'myfeeds_runtime' AS runtime_config_valid
\gset
\if :runtime_config_valid
\else
  \echo 'Use a distinct migration administrator and a random URL-safe runtime password of at least 32 characters'
  SELECT 1 / 0;
\endif

SELECT 'CREATE ROLE myfeeds_runtime LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myfeeds_runtime')
\gexec
SELECT
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'myfeeds_runtime')
  AND NOT EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = 'myfeeds_runtime')
  AND NOT EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE r.rolname = 'myfeeds_runtime')
  AS runtime_owns_no_objects
\gset
\if :runtime_owns_no_objects
\else
  \echo 'Runtime role must not own database objects; an administrator must reassign ownership before provisioning'
  SELECT 1 / 0;
\endif
SELECT format('ALTER ROLE myfeeds_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'runtime_password')
\gexec
SELECT format('REVOKE %I FROM myfeeds_runtime', role.rolname)
FROM pg_auth_members membership
JOIN pg_roles role ON role.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname = 'myfeeds_runtime'
\gexec
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM myfeeds_runtime;
GRANT CONNECT ON DATABASE :"DBNAME" TO :"migration_user";
GRANT CONNECT ON DATABASE :"DBNAME" TO myfeeds_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM myfeeds_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO :"migration_user";
GRANT USAGE ON SCHEMA public TO myfeeds_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM myfeeds_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO myfeeds_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM myfeeds_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO myfeeds_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  REVOKE ALL ON TABLES FROM myfeeds_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO myfeeds_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM myfeeds_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO myfeeds_runtime;
SELECT 'REVOKE ALL ON public.alembic_version FROM myfeeds_runtime'
WHERE to_regclass('public.alembic_version') IS NOT NULL
\gexec
