# Migrate on Startup (Opt-In) — Design

**Date:** 2026-11-02
**Status:** Design approved in conversation; written spec pending review
**Area:** Backend container entrypoint, Azure infrastructure parameter, operator docs
**Supersedes:** "runtime startup never migrates" (README) and "Do not put migration
credentials into runtime settings" (threat-model rollout) — for installations that
opt in. The default is unchanged.

## Problem

The production deploy (`deploy.yml` → `infra/deploy-runtime.sh`) builds an image and
swaps it into the app. It never touches the database, and the container never
migrates: an operator must run `infra/provision-database.sh` with the administrator
URL from a host that has private network access to PostgreSQL.

The reading-progress release adds migration `b8e4a1c7d903`, and the new backend needs
it (`opened_at`, `read_progress`). Neither GitHub Actions nor a developer machine can
reach the database, so the release cannot ship without a manual step on another host,
and deploying first would put a backend on a schema it does not match. Every future
schema change has the same problem.

## Goal

Let an installation opt in to applying pending Alembic migrations, as the database
administrator, **before** the web server starts, so a normal deploy also upgrades the
schema. Installations that do not opt in behave exactly as today.

## Non-Goals

- No migration step in GitHub Actions; `deploy.yml` and `infra/deploy-runtime.sh` stay
  unchanged and keep receiving no database secrets.
- No DDL rights for `myfeeds_runtime`, and no new database role.
- No role bootstrap or regrant at startup — `infra/provision-database.sh` stays the
  operator path for first install and role changes.
- No automatic downgrade, no advisory lock, no multi-instance support.
- No change to the Python application: migrations never run inside the server process.
- No change to Compose or local development flows.

## Decisions

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Where it runs | In `backend/start.sh` serve mode, as a child `alembic upgrade head` before `exec hypercorn`. | The entrypoint already implements `migrate`, runs inside the private network, and keeps administrator credentials out of the server process. |
| 2 | How to opt in | A non-empty `MIGRATION_DATABASE_URL` in the container environment. Bicep param `migrateOnStartup` (default `false`, azd variable `MIGRATE_ON_STARTUP`) fills it. | Explicit consent for an administrator credential in app settings, like `allowExternalTts`. Compose's `backend` service and `backend/.env.example` do not set it, so local flows are unchanged. |
| 3 | On failure | Fail closed: exit non-zero and never start the server. | A server on a mismatched schema is worse than a restarting one. |
| 4 | Credential scope | The administrator URL, `ENVIRONMENT=testing` and `DEBUG=false` apply to the `alembic` child only. `MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD` and `POSTGRES_RUNTIME_PASSWORD` are still unset before `exec hypercorn`. | The server keeps the runtime URL and production validation. `testing` bypasses the production security validation, as `migrate` mode does today. |
| 5 | Which role | The server administrator `myfeeds`; its password is the existing `postgresPassword`. | It owns the schema. Once `provision-database.sh` has run, `init-db.sql` grants the runtime role DML on tables and sequences the administrator creates later, so ordinary migrations need no regrant. |
| 6 | Shared code | One `run_migrations` function serves both `migrate` and serve mode. | The explicit and startup paths cannot drift. |
| 7 | Concurrency | No lock. Supported topology: one instance, one worker. | Postgres DDL is transactional, so a racing start fails closed, restarts and finds nothing to do. Scaling out needs a lock in `migrations/env.py` first. |
| 8 | Turning it off | Bicep always emits the `MIGRATION_DATABASE_URL` key and gates only its value (`''` when off). | The App Service module merges settings and retains existing keys, so omitting the key would leave the stored URL in place; overwriting it with `''` clears it. |

## Design

### `backend/start.sh`

The `migrate` contract is unchanged: it requires `MIGRATION_DATABASE_URL`, runs
`alembic upgrade head` with it as `DATABASE_URL`, `ENVIRONMENT=testing` and
`DEBUG=false`, and exits 2 on an unknown argument.

```sh
run_migrations() {
    DATABASE_URL="$MIGRATION_DATABASE_URL" ENVIRONMENT=testing DEBUG=false alembic upgrade head
}
# migrate: require MIGRATION_DATABASE_URL; run_migrations; exit 0
# serve:   require DATABASE_URL, then
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
    run_migrations
fi
unset MIGRATION_DATABASE_URL POSTGRES_PASSWORD POSTGRES_RUNTIME_PASSWORD
exec hypercorn app.main:app --bind "0.0.0.0:${PORT:-5000}" --workers 1
```

- The assignments sit on the external `alembic` command, so they cannot leak into the
  shell or into hypercorn. They must not move to the function call: in dash such
  assignments may persist.
- The call is in the `if` body, so `set -e` applies: a failure exits with alembic's
  status and hypercorn never starts. A missing runtime `DATABASE_URL` still fails
  before alembic runs.
- As PID 1 the shell ignores SIGTERM while alembic runs, so a stop during a migration
  waits for the platform kill timeout; Postgres rolls back the open transaction.

### Infrastructure

`infra/main.bicep` gains `param migrateOnStartup bool = false`, with an `@description`
that states the consent and its consequence, beside the other consent parameters, and the
`appsettings` block gains:

```bicep
MIGRATION_DATABASE_URL: migrateOnStartup ? 'postgresql+asyncpg://${postgresUser}:${postgresPassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require' : ''
```

`infra/main.parameters.json` maps `"migrateOnStartup": { "value": "${MIGRATE_ON_STARTUP=false}" }`.
azd generates both database passwords with `noSpecial`, so they are URL-safe, as for the
existing runtime URL. Re-provisioning keeps the running image (`linuxFxVersion` is
preserved when the app exists), so enabling or disabling the option never reverts a
deployment.

### Docs

- **README** (Deploy to Azure): qualify "runtime startup never migrates" as the default;
  add an "Optional: migrate on startup" paragraph (how to enable, what it does and does
  not do, compatibility, rollback, start-time limit, security trade-off); clarify that the
  workflow still does not migrate but an opted-in container does at start.
- **Threat model:** the TM-008 and TM-009 "remaining boundary" cells and the Rollout
  paragraph gain the opt-in exception and its residual risk.
- **`infra/provision-database.sh`:** header comment and closing message note that the
  administrator URL may also reach the app, only through the explicit opt-in.

## Security

With the opt-in, the administrator database URL is stored in the web app's settings and
is present in the container environment at startup. That is a deliberate trade-off, so it
is opt-in, off by default and documented.

**Mitigated:** the entrypoint strips the URL and both passwords before the server starts,
and uses the administrator URL only for the `alembic` child, so a compromise of the
running application process does not yield DDL rights.

**Not mitigated:**

- App Service hands every setting to whatever image runs, so anyone who can deploy an
  image can read the administrator URL. Today that exposure is the runtime URL,
  `SECRET_KEY` and OAuth secrets; the opt-in adds administrator rights. Protection of
  `main` and reviewers on the `production` environment therefore become load-bearing.
  Currently `main` is unprotected and `production` has no reviewers or branch policy.
- The App Service module takes `configs[].properties` as a plain (non-secure) object, so
  ARM may record the value in the nested deployment's parameters. Principals with
  `Microsoft.Resources/deployments/read` on the resource group, or `config/list` on the
  app, could then read it; the deploy identity's custom role has neither. Not verified.
- The stored value stays until the operator opts out and re-provisions.

The administrator is the identity `provision-database.sh` already uses, not a new one.

## Operability

- **Fail closed:** with the opt-in, an unreachable database at start takes the container
  down (App Service restarts it, with back-off after repeated failures). Without it, the
  server starts and `/health` stays green while API calls fail; `/health` does not touch
  the database.
- **Cost:** every start runs Alembic. At head it is a no-op taking a few seconds.
- **Start limit:** App Service waits about 230 s for a custom container
  (`WEBSITES_CONTAINER_START_TIME_LIMIT`, not set here). A long migration should run
  out-of-band, or the limit should be raised.
- **Compatibility:** migrations must work with the previous image (expand/contract): the
  old container may overlap the new one during a deploy, and nothing downgrades
  automatically. Migration `b8e4a1c7d903` is additive for the old code.
- **Rollback:** an image older than the database's applied revision fails closed
  ("Can't locate revision"). Opt out (`MIGRATE_ON_STARTUP=false`, `azd provision`) before
  deploying the older image, or fix forward.

## Alternatives Rejected

- **Migration step in the GitHub workflow:** needs private-network access and the
  administrator secret in GitHub, the opposite of today's least-privilege split.
- **DDL rights for `myfeeds_runtime`:** puts schema-change capability in the process that
  handles untrusted input.
- **Migrating inside the Python app (lifespan):** the server process would hold the
  administrator URL.
- **Setting the variable by hand (`az webapp config appsettings set`):** the next
  `azd provision` overwrites it, because the key is managed in Bicep.
- **WebJob or separate migration job:** extra infrastructure for one command.
- **Entra authentication for the administrator:** Entra auth is disabled on the server.

## Testing

Strict TDD in `scripts/test-security-config.mjs` (`node:test`; runs `start.sh` under WSL on
Windows). Tests put stub `alembic` and `hypercorn` executables first on `PATH`; the stubs
log argv and the environment values under test, and exit with a configurable status.

**Characterization (pass before and after):** `migrate` runs `alembic upgrade head` with the
administrator URL as `DATABASE_URL`, `ENVIRONMENT=testing`, `DEBUG=false`; a missing URL
errors; a failing alembic exits non-zero; an unknown argument exits 2.

**New (seen failing first):**

- Serve with no or empty `MIGRATION_DATABASE_URL` never calls alembic, and hypercorn gets
  `app.main:app --bind 0.0.0.0:<PORT> --workers 1`.
- Serve with a URL runs alembic first (`upgrade head`, administrator `DATABASE_URL`,
  `ENVIRONMENT=testing`, `DEBUG=false`), then hypercorn with only the runtime
  `DATABASE_URL` and none of the three migration/password variables.
- A failing alembic exits non-zero and hypercorn is never called.
- A missing runtime `DATABASE_URL` fails before alembic.
- Bicep contract: `migrateOnStartup` is `bool = false`; the `MIGRATION_DATABASE_URL` key is
  always present, its value gated by the flag and built from `postgresUser` and
  `postgresPassword` with `ssl=require`; `main.parameters.json` maps `MIGRATE_ON_STARTUP`
  with default `false`.

Also: `az bicep build --file infra/main.bicep` compiles, and the file's 10 existing tests
(including the `deploy.yml` secret-free contract) keep passing.

## Rollout

Each prod-affecting step needs the owner's go-ahead.

1. Push the implementation to `main`. Nothing is deployed yet.
2. Opt in: `azd env set MIGRATE_ON_STARTUP true --environment my-feeds-prod`, then
   `azd provision --preview` (confirm only the app setting changes and the image is
   preserved) and `azd provision`. The running old image strips the new setting at start;
   the settings change restarts the app briefly.
3. `gh workflow run deploy.yml --ref main`, then watch the run.
4. The new container applies `b8e4a1c7d903`, then serves. Confirm in the container log. The
   site is IP-restricted, so log access from a developer machine may be blocked; anything
   not verified is reported as such.
5. Fallback if the opt-in is declined or fails: an operator runs
   `infra/provision-database.sh` from a private-network host, then deploys.

An operator who wants the URL in app settings only while a migration is pending can opt in
for that release and opt out afterwards.

## Files Touched

- `backend/start.sh` — `run_migrations`, serve-mode migration.
- `scripts/test-security-config.mjs` — new `start.sh` and Bicep contract tests.
- `infra/main.bicep`, `infra/main.parameters.json` — parameter and app setting.
- `infra/provision-database.sh` — comment and closing message.
- `README.md`, `my-feeds-threat-model.md` — opt-in documentation.
- Unchanged on purpose: `.github/workflows/deploy.yml`, `infra/deploy-runtime.sh`,
  `Dockerfile`, Compose files, `init-db.sql`, `backend/app/**`.

## Open Items

- A dedicated migration role (table owner without role or database administration rights)
  to narrow the stored credential; it needs a table-ownership change.
- An advisory lock in `migrations/env.py` before scaling beyond one instance.
- Protect `main` and add reviewers and a branch policy to the `production` environment.
- Key Vault references for the setting, to keep the value out of plain app-setting storage
  and, possibly, deployment history.
- Verify empirically whether the plain module parameter is recorded in deployment history.

## Done When

- `node --test scripts/test-security-config.mjs` passes; each new test was seen failing
  before its implementation.
- `az bicep build --file infra/main.bicep` succeeds.
- README, threat model and `provision-database.sh` describe the opt-in, its default and its
  residual risks.
- `deploy.yml` and `infra/deploy-runtime.sh` are unchanged.
- The implementation is on `origin/main`.
- Production: the opt-in applied and the deploy run succeeded; the migration's application is
  confirmed from the container log, or reported as unverified.
