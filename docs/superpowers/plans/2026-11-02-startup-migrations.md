# Startup Migrations (Opt-In) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an installation opt in to the web container applying pending Alembic migrations, as the database administrator, **before** the server starts, so a normal `deploy.yml` run also upgrades the schema. Installations that do not opt in behave exactly as today.

**Architecture:** `backend/start.sh` gets one shared `run_migrations` function that both the existing `migrate` mode and a new serve-mode step call. Serve mode runs it before `exec hypercorn` only when `MIGRATION_DATABASE_URL` is non-empty. Bicep fills that app setting from a new consent parameter `migrateOnStartup` (azd variable `MIGRATE_ON_STARTUP`, default `false`) and always emits the key, so opting out clears a stored URL. README, the threat model and `infra/provision-database.sh` document the opt-in and its trade-off.

**Tech Stack:** POSIX `sh` (dash), Alembic, Bicep (AVM App Service module), Node `node:test`, WSL on Windows for the shell tests.

**Spec:** `docs/superpowers/specs/2026-11-02-startup-migrations-design.md` (approved). Production rollout (`azd provision`, the deploy run) is **not** part of these tasks; it needs the owner's go-ahead and happens after review.

---

## Global Constraints

Copied from the approved spec. Every task must honour them.

- **Opt-in signal:** a non-empty `MIGRATION_DATABASE_URL` in the container environment. Unset or empty means serve mode never calls `alembic`. The Bicep parameter is `migrateOnStartup` (`bool = false`); the azd variable is `MIGRATE_ON_STARTUP`, default `false`.
- **Fail closed:** if `alembic` exits non-zero in serve mode, `start.sh` exits with that status and `hypercorn` is never started.
- **Credential scope:** the administrator URL, `ENVIRONMENT=testing` and `DEBUG=false` apply to the `alembic` child only. They are command-prefix assignments on the external `alembic` command inside `run_migrations`: never `export`s, and never assignments on the function call (dash may persist those). `MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD` and `POSTGRES_RUNTIME_PASSWORD` are still unset before `exec hypercorn`.
- **One shared function:** `migrate` mode and serve mode both call `run_migrations`. The `migrate` contract is unchanged: it requires `MIGRATION_DATABASE_URL`, runs `alembic upgrade head` with that URL as `DATABASE_URL`, `ENVIRONMENT=testing`, `DEBUG=false`, and an unknown argument exits 2 with `Usage: start.sh [serve|migrate]` on stderr.
- **Order in serve mode:** require the runtime `DATABASE_URL` first, then the optional migration, then `unset`, then `exec hypercorn`.
- **Bicep:** the `MIGRATION_DATABASE_URL` key is always emitted in `appsettings`; only its value is gated: `migrateOnStartup ? 'postgresql+asyncpg://${postgresUser}:${postgresPassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require' : ''`. The parameter's `@description` contains no apostrophe (the contract test matches it with `[^'\n]+`).
- **Unchanged on purpose:** `.github/workflows/deploy.yml`, `infra/deploy-runtime.sh`, `Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`, `init-db.sql`, `backend/.env.example`, `backend/app/**`. An existing test asserts the workflow never mentions `azd provision|POSTGRES_PASSWORD|SECRET_KEY|CLIENT_SECRET`.
- **Strict TDD:** every behaviour change has a failing test first, seen failing for the stated reason, then the minimal change, then green. Characterization tests pass before the change; say so in your report.
- **No secrets in output:** the test URLs are synthetic. Never print real connection strings or passwords.
- **Line endings:** `backend/start.sh` and `infra/provision-database.sh` are LF (`.gitattributes`). The other edited files are CRLF in the working tree (`core.autocrlf=true`; git stores LF). Use the editor tools; if a multi-line match fails because of CRLF, match a single line instead.
- **Commits:** one per task, with the trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`. Do not push.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `backend/start.sh` | `run_migrations`; the serve-mode migration step | 1 |
| `scripts/test-security-config.mjs` | `start.sh` behaviour tests (stubbed `alembic`/`hypercorn`, run under WSL on Windows), a Bicep contract test, a docs contract test | 1, 2, 3 |
| `infra/main.bicep` | `migrateOnStartup` parameter; always-present `MIGRATION_DATABASE_URL` app setting | 2 |
| `infra/main.parameters.json` | `MIGRATE_ON_STARTUP` to `migrateOnStartup` | 2 |
| `README.md` | default wording, "Optional: migrate on startup", workflow sentence | 3 |
| `my-feeds-threat-model.md` | TM-008 and TM-009 cells, Rollout paragraph | 3 |
| `infra/provision-database.sh` | header comment and closing message | 3 |

The shell tests run `start.sh` under WSL on Windows (distro `Ubuntu-26.04`, override with `SECURITY_TEST_WSL_DISTRO`) and under `bash` elsewhere. Run them from the repository root with `node --test scripts/test-security-config.mjs`; narrow with `--test-name-pattern`.

---

## Task 1: `start.sh` migrates before serving when opted in

**Files:**
- Modify: `scripts/test-security-config.mjs` (append helpers and 7 tests at the end of the file)
- Modify: `backend/start.sh`

**Interfaces:**
- Consumes: the file's existing imports and constants (`assert`, `test`, `spawnSync`, `root`).
- Produces: the `start.sh` contract: when `MIGRATION_DATABASE_URL` is non-empty, serve mode runs `alembic upgrade head` (administrator `DATABASE_URL`, `ENVIRONMENT=testing`, `DEBUG=false`) before `exec hypercorn`, and exits with alembic's status if it fails. Test helper `runStart(args, env, alembicStatus)` returns `{ status, stderr, calls, alembicEnv, serverEnv }` (used only inside this test file).

**Constraints for this task:** see Global Constraints: credential scope, fail closed, one shared function, order in serve mode. The five characterization tests below pass before any `start.sh` change; only two tests are red first.

**Behaviour note (put it in your report):** in `migrate` mode PID 1 becomes the shell instead of `alembic` (the old code used `exec alembic`). Exit status and alembic's environment are unchanged and pinned by the tests. The only difference is that a one-shot `migrate` container ignores SIGTERM until the platform kills it. This follows from sharing one function (spec decision 6); do not re-add `exec`.

- [ ] **Step 1: Append the helpers and seven tests**

Append this to the end of `scripts/test-security-config.mjs`, after the last existing test. Copy it verbatim; the doubled backslash in `\\n` is intentional (JS turns it into the two characters `\n` that the shell `printf` needs).

```js
const bashRoot = process.platform === "win32"
  ? root.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
  : root;
const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const bash = (script) => process.platform === "win32"
  ? spawnSync("wsl", ["-d", process.env.SECURITY_TEST_WSL_DISTRO || "Ubuntu-26.04", "--", "bash", "-s"], { input: script, encoding: "utf8" })
  : spawnSync("bash", ["-s"], { input: script, encoding: "utf8" });

const RUNTIME_URL = "postgresql+asyncpg://myfeeds_runtime:runtime-secret@db.example:5432/myfeeds?ssl=require";
const ADMIN_URL = "postgresql+asyncpg://myfeeds:admin-secret@db.example:5432/myfeeds?ssl=require";
const SERVE_CALL = "HYPERCORN app.main:app --bind 0.0.0.0:8123 --workers 1";
const SERVER_ENV = { DATABASE_URL: RUNTIME_URL, ENVIRONMENT: "production" };
const WATCHED_ENV = "DATABASE_URL|MIGRATION_DATABASE_URL|POSTGRES_PASSWORD|POSTGRES_RUNTIME_PASSWORD|ENVIRONMENT|DEBUG";

// Stand-ins for alembic and hypercorn: they report argv and the security-relevant environment they receive.
const stubTool = (name, exitLine = "") => `cat > "$stub/${name}" <<'STUB'
#!/bin/sh
printf '${name.toUpperCase()} %s\\n' "$*"
env | grep -E '^(${WATCHED_ENV})=' | sed 's/^/${name.toUpperCase()}_ENV /'
${exitLine}
STUB
chmod +x "$stub/${name}"
`;
const stubTools = `
stub=$(mktemp -d)
trap 'rm -rf "$stub"' EXIT
${stubTool("alembic", 'exit "$STUB_ALEMBIC_STATUS"')}${stubTool("hypercorn")}`;

const runStart = (args, env = {}, alembicStatus = 0) => {
  const assignments = Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const result = bash(`
set -u
cd ${shellQuote(bashRoot)}
${stubTools}
env -i PATH="$stub:/usr/bin:/bin" STUB_ALEMBIC_STATUS=${alembicStatus} ${assignments} sh backend/start.sh ${args} </dev/null
echo "EXIT $?"
`);
  const lines = result.stdout.split(/\r?\n/);
  const section = (tool) => Object.fromEntries(lines
    .filter((line) => line.startsWith(`${tool}_ENV `))
    .map((line) => line.slice(tool.length + 5))
    .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
  const exit = lines.find((line) => line.startsWith("EXIT "));
  return {
    status: exit === undefined ? null : Number(exit.slice(5)),
    stderr: result.stderr,
    calls: lines.filter((line) => /^(ALEMBIC|HYPERCORN) /.test(line)),
    alembicEnv: section("ALEMBIC"),
    serverEnv: section("HYPERCORN"),
  };
};

const servingEnv = (extra = {}) => ({
  DATABASE_URL: RUNTIME_URL,
  ENVIRONMENT: "production",
  PORT: "8123",
  POSTGRES_PASSWORD: "admin-secret",
  POSTGRES_RUNTIME_PASSWORD: "runtime-secret",
  ...extra,
});

test("start.sh migrate runs alembic as the administrator with testing settings", () => {
  const result = runStart("migrate", { MIGRATION_DATABASE_URL: ADMIN_URL, DATABASE_URL: RUNTIME_URL });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["ALEMBIC upgrade head"]);
  assert.equal(result.alembicEnv.DATABASE_URL, ADMIN_URL);
  assert.equal(result.alembicEnv.ENVIRONMENT, "testing");
  assert.equal(result.alembicEnv.DEBUG, "false");
});

test("start.sh migrate requires the administrator URL and returns alembic's status", () => {
  let result = runStart("migrate");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MIGRATION_DATABASE_URL/);
  assert.deepEqual(result.calls, []);
  result = runStart("migrate", { MIGRATION_DATABASE_URL: ADMIN_URL }, 3);
  assert.equal(result.status, 3);
  assert.deepEqual(result.calls, ["ALEMBIC upgrade head"]);
});

test("start.sh rejects unknown modes before running anything", () => {
  const result = runStart("bogus", { MIGRATION_DATABASE_URL: ADMIN_URL, DATABASE_URL: RUNTIME_URL });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: start\.sh \[serve\|migrate\]/);
  assert.deepEqual(result.calls, []);
});

test("start.sh serves without migrating unless the administrator URL is set", () => {
  for (const migrationUrl of [undefined, ""]) {
    const result = runStart("serve", servingEnv({ MIGRATION_DATABASE_URL: migrationUrl }));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, [SERVE_CALL]);
    assert.deepEqual(result.serverEnv, SERVER_ENV);
  }
});

test("start.sh migrates before serving and keeps administrator credentials from the server", () => {
  for (const args of ["", "serve"]) {
    const result = runStart(args, servingEnv({ MIGRATION_DATABASE_URL: ADMIN_URL }));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, ["ALEMBIC upgrade head", SERVE_CALL]);
    assert.equal(result.alembicEnv.DATABASE_URL, ADMIN_URL);
    assert.equal(result.alembicEnv.ENVIRONMENT, "testing");
    assert.equal(result.alembicEnv.DEBUG, "false");
    assert.deepEqual(result.serverEnv, SERVER_ENV);
  }
});

test("start.sh does not serve when the startup migration fails", () => {
  const result = runStart("serve", servingEnv({ MIGRATION_DATABASE_URL: ADMIN_URL }), 7);
  assert.equal(result.status, 7);
  assert.deepEqual(result.calls, ["ALEMBIC upgrade head"]);
});

test("start.sh requires the runtime URL before migrating on startup", () => {
  const result = runStart("serve", servingEnv({ DATABASE_URL: undefined, MIGRATION_DATABASE_URL: ADMIN_URL }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL/);
  assert.deepEqual(result.calls, []);
});
```

- [ ] **Step 2: Run the new tests and confirm exactly two fail**

Run from the repository root:

```powershell
node --test --test-name-pattern="start\.sh" scripts/test-security-config.mjs
```

Expected: 7 tests, **5 pass and 2 fail**.
- Fails: `start.sh migrates before serving and keeps administrator credentials from the server` (calls are `["HYPERCORN ..."]` only, because serve mode ignores the URL today) and `start.sh does not serve when the startup migration fails` (status is `0`, not `7`).
- Passes (characterization of today's behaviour): the other five.

If any of the five characterization tests fails, the test harness is wrong, not `start.sh`: fix the helper (quoting, stub, parsing) before touching `start.sh`.

- [ ] **Step 3: Implement the shared function and the serve-mode step**

Edit `backend/start.sh` (LF file).

First edit. Old:

```sh
if [ -d "$script_dir/backend" ]; then cd "$script_dir/backend"; else cd "$script_dir"; fi

if [ "${1:-serve}" = migrate ]; then
    : "${MIGRATION_DATABASE_URL:?An administrator URL is required for explicit migrations}"
    export DATABASE_URL="$MIGRATION_DATABASE_URL"
    export ENVIRONMENT=testing DEBUG=false
    exec alembic upgrade head
fi
```

New:

```sh
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
```

Second edit. Old:

```sh
: "${DATABASE_URL:?Runtime database URL is required}"
unset MIGRATION_DATABASE_URL POSTGRES_PASSWORD POSTGRES_RUNTIME_PASSWORD
```

New:

```sh
: "${DATABASE_URL:?Runtime database URL is required}"
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
    run_migrations
fi
unset MIGRATION_DATABASE_URL POSTGRES_PASSWORD POSTGRES_RUNTIME_PASSWORD
```

The file must now be exactly:

```sh
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
```

- [ ] **Step 3a: Run the new tests and confirm all pass**

```powershell
node --test --test-name-pattern="start\.sh" scripts/test-security-config.mjs
```

Expected: 7 pass, 0 fail.

- [ ] **Step 4: Run the whole file**

```powershell
node --test scripts/test-security-config.mjs
```

Expected: **17 pass, 0 fail** (the 10 existing tests, including "startup and operator bootstrap fail closed", plus the 7 new ones).

- [ ] **Step 5: Commit**

```powershell
git add backend/start.sh scripts/test-security-config.mjs
git commit -m "feat(backend): opt-in migrate before serve in start.sh" -m "Serve mode runs alembic upgrade head as the administrator, scoped to the alembic child, when MIGRATION_DATABASE_URL is non-empty; a failed migration stops startup. migrate mode now shares the same run_migrations function." -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Bicep parameter and always-present app setting

**Files:**
- Modify: `scripts/test-security-config.mjs` (append one test)
- Modify: `infra/main.bicep`
- Modify: `infra/main.parameters.json`

**Interfaces:**
- Consumes: Task 1's contract (a non-empty `MIGRATION_DATABASE_URL` makes the container migrate). Existing Bicep symbols `postgresUser` (`'myfeeds'`), `postgresDb`, `postgresPassword`, `postgres.outputs.fqdn`.
- Produces: Bicep parameter `migrateOnStartup` (`bool = false`, azd variable `MIGRATE_ON_STARTUP`, default `false`); web app setting `MIGRATION_DATABASE_URL`, non-empty only when opted in, always emitted. Task 3 documents these names.

**Constraints for this task:** see Global Constraints: Bicep. Do not leave `infra/main.json` or any other build output in the repository: compile with `--outfile` to a temporary path.

- [ ] **Step 1: Append the contract test**

Append to the end of `scripts/test-security-config.mjs`:

```js
test("bicep migrate-on-startup is a consent-gated opt-in that always emits the app setting", () => {
  const bicep = read("infra/main.bicep");
  assert.match(bicep, /@description\('[^'\n]+'\)\nparam migrateOnStartup bool = false\n/);
  assert.equal(
    bicep.match(/^\s*MIGRATION_DATABASE_URL: (.+)$/m)?.[1],
    "migrateOnStartup ? 'postgresql+asyncpg://${postgresUser}:${postgresPassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require' : ''",
  );
  assert.match(read("infra/main.parameters.json"), /"migrateOnStartup": \{ "value": "\$\{MIGRATE_ON_STARTUP=false\}" \}/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
node --test --test-name-pattern="migrate-on-startup" scripts/test-security-config.mjs
```

Expected: 1 test, **fails** on the first assertion (`param migrateOnStartup` does not exist yet).

- [ ] **Step 3: Add the parameter**

Edit `infra/main.bicep`. Old:

```bicep
@description('Explicit consent to load remote HTTPS feed images in the browser.')
param allowExternalImages bool = false
```

New:

```bicep
@description('Explicit consent to load remote HTTPS feed images in the browser.')
param allowExternalImages bool = false

@description('Explicit consent to store the database administrator URL in the web app settings so the container applies pending migrations before it starts serving. Off by default.')
param migrateOnStartup bool = false
```

- [ ] **Step 4: Add the app setting**

Edit `infra/main.bicep`, inside the `appsettings` properties block. Old:

```bicep
          DATABASE_URL: 'postgresql+asyncpg://myfeeds_runtime:${postgresRuntimePassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require'
          SECRET_KEY: secretKey
```

New:

```bicep
          DATABASE_URL: 'postgresql+asyncpg://myfeeds_runtime:${postgresRuntimePassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require'
          // Always emitted: the module merges settings, so only an empty value clears a stored URL.
          MIGRATION_DATABASE_URL: migrateOnStartup ? 'postgresql+asyncpg://${postgresUser}:${postgresPassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require' : ''
          SECRET_KEY: secretKey
```

- [ ] **Step 5: Map the azd variable**

Edit `infra/main.parameters.json`. Old:

```json
    "allowExternalImages": { "value": "${ALLOW_EXTERNAL_IMAGES=false}" },
```

New:

```json
    "allowExternalImages": { "value": "${ALLOW_EXTERNAL_IMAGES=false}" },
    "migrateOnStartup": { "value": "${MIGRATE_ON_STARTUP=false}" },
```

- [ ] **Step 6: Run the test, then the whole file**

```powershell
node --test --test-name-pattern="migrate-on-startup" scripts/test-security-config.mjs
node --test scripts/test-security-config.mjs
```

Expected: the first prints 1 pass; the second prints **18 pass, 0 fail**.

- [ ] **Step 7: Compile the template**

```powershell
$out = Join-Path $env:TEMP 'main-check.json'
az bicep build --file infra\main.bicep --outfile $out
"exit=$LASTEXITCODE"
Select-String -Path $out -Pattern 'MIGRATION_DATABASE_URL' | ForEach-Object { $_.Line.Trim() }
Remove-Item $out
git --no-pager status --short
```

Expected: `exit=0` and no `Warning` or `Error` lines (the unchanged template compiled with none, so any new warning comes from this change: report it, do not suppress it). `Select-String` prints exactly one line, an ARM `if(...)` expression that references `migrateOnStartup` and ends in an empty string; it contains parameter references, not secret values. `git status` lists only the three files from this task (`infra/main.bicep`, `infra/main.parameters.json`, `scripts/test-security-config.mjs`).

- [ ] **Step 8: Commit**

```powershell
git add infra/main.bicep infra/main.parameters.json scripts/test-security-config.mjs
git commit -m "feat(infra): migrateOnStartup parameter and MIGRATION_DATABASE_URL app setting" -m "Off by default. The key is always emitted so that opting out overwrites a stored administrator URL with an empty value." -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Document the opt-in and its trade-off

**Files:**
- Modify: `scripts/test-security-config.mjs` (append one test)
- Modify: `README.md`
- Modify: `my-feeds-threat-model.md`
- Modify: `infra/provision-database.sh`

**Interfaces:**
- Consumes: the names from Tasks 1-2: `MIGRATE_ON_STARTUP`, `migrateOnStartup`, the `MIGRATION_DATABASE_URL` app setting, `backend/start.sh`, `infra/provision-database.sh`.
- Produces: nothing consumed by code. The docs state the default (off), the opt-in command sequence, what the container does, compatibility, rollback, the start limit and the residual risk.

**Constraints for this task:** see Global Constraints. Claims must match the spec: the deployment-history exposure is **unverified**, so phrase it conditionally ("may"). `main` is unprotected and `production` has no reviewers today; the docs recommend adding them, they do not claim they exist.

- [ ] **Step 1: Append the docs contract test**

Append to the end of `scripts/test-security-config.mjs`:

```js
test("docs describe the opt-in startup migration instead of claiming it never happens", () => {
  const readme = read("README.md");
  const threatModel = read("my-feeds-threat-model.md");
  assert.match(readme, /MIGRATE_ON_STARTUP/);
  assert.doesNotMatch(readme, /runtime startup never migrates/);
  assert.match(threatModel, /MIGRATE_ON_STARTUP/);
  assert.doesNotMatch(threatModel, /Do not put migration credentials into runtime settings\./);
  assert.match(read("infra/provision-database.sh"), /MIGRATE_ON_STARTUP/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```powershell
node --test --test-name-pattern="opt-in startup migration" scripts/test-security-config.mjs
```

Expected: 1 test, **fails** on the first assertion (README has no `MIGRATE_ON_STARTUP` yet).

- [ ] **Step 3: README: qualify the default**

Edit `README.md`. Old:

```text
through `b8e4a1c7d903` and reapply runtime grants. Only `myfeeds_runtime`
credentials belong in app settings; runtime startup never migrates.
```

New:

```text
through `b8e4a1c7d903` and reapply runtime grants. Only `myfeeds_runtime`
credentials belong in app settings by default, and the container does not migrate
at startup unless you opt in (see "Optional: migrate on startup" below).
```

- [ ] **Step 4: README: add the opt-in section**

Edit `README.md`. Old:

```text
removed duplicates.

Protect `main`, select actual numeric reviewer IDs, and run operator-only
```

New:

```text
removed duplicates.

**Optional: migrate on startup.** When no operator can run
`infra/provision-database.sh` before each release, opt in so the web container applies
pending migrations before it serves: run
`azd env set MIGRATE_ON_STARTUP true --environment my-feeds-prod`, review
`azd provision --preview`, then `azd provision`. Provisioning stores the database
administrator URL in the web app's `MIGRATION_DATABASE_URL` setting; `start.sh` runs
`alembic upgrade head` with it before `hypercorn`, and the server never receives that
URL or either database password. A failed migration, or an unreachable database at
start, stops the container instead of serving. First-time role bootstrap and runtime
regrants stay with `infra/provision-database.sh`.

Keep migrations compatible with the previous image (add first, remove in a later
release): the old container can overlap the new one during a deploy and nothing
downgrades automatically. Run a single instance, because there is no migration lock.
App Service waits about 230 seconds for a container to start, so run long migrations
out of band. To deploy an image older than the applied revision, first run
`azd env set MIGRATE_ON_STARTUP false --environment my-feeds-prod` and
`azd provision`; otherwise the older image fails with `Can't locate revision`.

**Trade-off:** anyone who can deploy an image to the app can read every app setting,
including the administrator URL, and Azure may keep the value in deployment history.
It stays until you opt out and re-provision. Protect `main` and add reviewers to the
`production` environment before opting in.

Protect `main`, select actual numeric reviewer IDs, and run operator-only
```

- [ ] **Step 5: README: correct the workflow sentence**

Edit `README.md`. Old:

```text
outputs, run `azd up`, migrate the database, or change IAM. Azure CLI handles the
```

New:

```text
outputs, run `azd up`, migrate the database (an opted-in container migrates itself
at start), or change IAM. Azure CLI handles the
```

- [ ] **Step 6: Threat model: TM-008 and TM-009 cells**

Edit `my-feeds-threat-model.md`. Each old string is unique (it ends the TM-008 or TM-009 row of the short table).

TM-008. Old:

```text
Check inherited permissions, actual reviewer/branch controls, and live deployment. |
```

New:

```text
Check inherited permissions, actual reviewer/branch controls, and live deployment. If an installation opts in to `MIGRATE_ON_STARTUP`, the database administrator URL is also a web app setting that anyone able to deploy an image can read, so `main` protection and `production` reviewers become load-bearing. |
```

TM-009. Old:

```text
Docker images were not built/run in this environment. |
```

New:

```text
Docker images were not built/run in this environment. Migrations are explicit by default; the `MIGRATE_ON_STARTUP` opt-in runs them in the entrypoint as the administrator (URL and passwords stripped before the server starts, fail closed, single instance). |
```

- [ ] **Step 7: Threat model: Rollout paragraph**

Edit `my-feeds-threat-model.md`. Old:

```text
Do not put migration credentials into runtime settings. Review and revoke legacy
cloud access deliberately; source configuration is not evidence of deployed policy.
```

New:

```text
Keep migration credentials out of runtime settings unless the installation opts in to
`MIGRATE_ON_STARTUP` (see README); if it does, protect `main` and the `production`
environment first. Review and revoke legacy cloud access deliberately; source
configuration is not evidence of deployed policy.
```

- [ ] **Step 8: `provision-database.sh`: header and closing message**

Edit `infra/provision-database.sh` (LF file). Header, old:

```bash
# Privileged operator path. Run from a private-network host with psql + Alembic.
# Never give these credentials or this execution capability to runtime deployment.
set -euo pipefail
```

New:

```bash
# Privileged operator path. Run from a private-network host with psql + Alembic.
# Never give these credentials or this execution capability to runtime deployment;
# the GitHub deploy workflow never receives them. An installation may separately opt
# in to MIGRATE_ON_STARTUP so the web container migrates itself (see README).
set -euo pipefail
```

Closing message, old:

```bash
echo "Migrations and runtime grants applied. Publish only the runtime URL to the web app."
```

New:

```bash
echo "Migrations and runtime grants applied. Publish only the runtime URL to the web app unless you opted in to MIGRATE_ON_STARTUP (see README)."
```

- [ ] **Step 9: Run the test, then the whole file**

```powershell
node --test --test-name-pattern="opt-in startup migration" scripts/test-security-config.mjs
node --test scripts/test-security-config.mjs
```

Expected: the first prints 1 pass; the second prints **19 pass, 0 fail**.

- [ ] **Step 10: Final checks for the whole change**

```powershell
git --no-pager grep -n -e "runtime startup never migrates" -e "Do not put migration credentials into runtime settings" -- README.md my-feeds-threat-model.md
git --no-pager diff --stat 43a54b9..HEAD -- .github infra/deploy-runtime.sh Dockerfile docker-compose.yml docker-compose.override.yml init-db.sql backend/app backend/.env.example
$out = Join-Path $env:TEMP 'main-check.json'; az bicep build --file infra\main.bicep --outfile $out; "bicep exit=$LASTEXITCODE"; Remove-Item $out
git --no-pager status --short
```

Expected: the first two commands print nothing (no stale wording left; none of the "unchanged on purpose" files differ since the spec commit); `bicep exit=0`; `git status` lists only the four files of this task (`README.md`, `my-feeds-threat-model.md`, `infra/provision-database.sh`, `scripts/test-security-config.mjs`) before the commit.

- [ ] **Step 11: Commit**

```powershell
git add README.md my-feeds-threat-model.md infra/provision-database.sh scripts/test-security-config.mjs
git commit -m "docs: document the opt-in startup migration" -m "README, the threat model and provision-database.sh describe the MIGRATE_ON_STARTUP opt-in, its default, compatibility and rollback rules, and the residual risk of keeping the administrator URL in app settings." -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```
