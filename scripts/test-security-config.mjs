import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const root = fileURLToPath(new URL("..", import.meta.url));

test("production ACR builds verify pnpm without BuildKit-only ADD flags", () => {
  for (const file of ["Dockerfile", "frontend/Dockerfile"]) {
    const text = read(file);
    assert.doesNotMatch(text, /ADD --checksum=/);
    assert.match(text, /fd1eab68a6d403f35cf3259c53780d70b0f14bd74e39da2f917d201f554d8665  \/opt\/pnpm\.tgz/);
    assert.match(text, /sha256sum -c - && npm install --global \/opt\/pnpm\.tgz/);
  }
});

test("azd consumes the web service and deploys only the published immutable image", () => {
  const script = read("infra/deploy-runtime.sh");
  const workflow = read(".github/workflows/deploy.yml");
  assert.match(script, /az acr build --registry "\$AZURE_CONTAINER_REGISTRY_NAME"/);
  assert.match(script, /azd deploy web --from-package "\$RUNTIME_IMAGE" --no-prompt/);
  assert.doesNotMatch(script, /^(?:azd publish|az rest|azd (?:up|provision)|azd env refresh)\b/m);
  assert.match(script, /azd auth login[\s\S]*--federated-credential-provider github/);
  assert.match(script, /AZD_DEPLOY_WEB_SLOT_NAME production/);
  assert.match(script, /SERVICE_WEB_NAME "\$WEB_APP_NAME"/);
  assert.match(workflow, /azd-linux-amd64\.tar\.gz/);
  assert.match(workflow, /4ad77050ea5f9e465309891b0aa7946cd87f0f590982ff54531c5ecdc1c2efd1/);
  assert.match(workflow, /sha256sum -c -/);
  assert.match(workflow, /--env ACTIONS_ID_TOKEN_REQUEST_URL --env ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  const config = read("azure.yaml");
  assert.match(config, /host: appservice/);
  assert.match(config, /remoteBuild: true/);
  assert.match(config, /- VITE_ALLOW_EXTERNAL_IMAGES=\$\{ALLOW_EXTERNAL_IMAGES=false\}/);
});

test("runtime azd deployment orders publish before digest deploy and stops on failures", () => {
  const shellRoot = process.platform === "win32"
    ? root.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
    : root;
  const digest = `sha256:${"a".repeat(64)}`;
  for (const mode of ["success", "publish-failure", "invalid-digest"]) {
    const script = `
set -eu
cd '${shellRoot.replace(/'/g, "'\\''")}'
export FEDERATED_TOKEN=synthetic AZURE_CLIENT_ID=client AZURE_TENANT_ID=tenant
export AZURE_SUBSCRIPTION_ID=subscription AZURE_RESOURCE_GROUP=existing-rg
export AZURE_CONTAINER_REGISTRY_NAME=existingregistry WEB_APP_NAME=existing-app
export AZURE_ENV_NAME=existing-env AZURE_LOCATION=canadacentral GITHUB_SHA=${"b".repeat(40)}
export MODE=${mode}
az() {
  case "$*" in
    "acr show "*) printf '%s\\n' existingregistry.azurecr.io ;;
    "acr build "*) printf 'BUILD %s\\n' "$*"; if [ "$MODE" = publish-failure ]; then return 9; fi ;;
    "acr repository show "*) if [ "$MODE" = invalid-digest ]; then echo invalid; else echo '${digest}'; fi ;;
    *) return 0 ;;
  esac
}
azd() {
  printf 'AZD %s\\n' "$*"
}
export -f az azd
bash infra/deploy-runtime.sh
`;
    const result = process.platform === "win32"
      ? spawnSync("wsl", ["-d", process.env.SECURITY_TEST_WSL_DISTRO || "Ubuntu-26.04", "--", "bash", "-s"], { input: script, encoding: "utf8" })
      : spawnSync("bash", ["-s"], { input: script, encoding: "utf8" });
    assert.match(result.stdout, /BUILD acr build --registry existingregistry/);
    if (mode === "success") {
      assert.equal(result.status, 0, result.stderr);
      const deploy = `AZD deploy web --from-package existingregistry.azurecr.io/my-feeds@${digest} --no-prompt`;
      assert.ok(result.stdout.indexOf(deploy) > result.stdout.indexOf("BUILD acr build"));
      assert.match(result.stdout, /AZD env set SERVICE_WEB_NAME existing-app --no-prompt/);
      assert.match(result.stdout, /AZD env set AZD_DEPLOY_WEB_SLOT_NAME production --no-prompt/);
    } else {
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /AZD deploy /);
    }
  }
});

test("every external container and action reference is immutable", () => {
  for (const file of ["Dockerfile", "backend/Dockerfile", "frontend/Dockerfile"]) {
    const text = read(file);
    for (const [, image] of text.matchAll(/(?:^FROM\s+|^COPY\s+--from=)(\S+)/gm)) {
      if (image?.includes(":")) assert.match(image, /@sha256:[a-f0-9]{64}$/);
    }
    assert.match(text, /^USER\s+(?!root\b|0\b)\S+/m, `${file} needs a non-root runtime`);
  }
  for (const [, ref] of read(".github/workflows/deploy.yml").matchAll(/uses:\s+\S+@(\S+)/g)) {
    assert.match(ref, /^[a-f0-9]{40}$/);
  }
  for (const [, ref] of read("infra/main.bicep").matchAll(/module\s+\w+\s+'(br\/public:[^']+)'/g)) {
    assert.match(ref, /@sha256:[a-f0-9]{64}$/);
  }
});

test("startup and operator bootstrap fail closed without explicit configuration", () => {
  const shellRoot = process.platform === "win32"
    ? root.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
    : root;
  const prefix = `cd '${shellRoot.replace(/'/g, "'\\''")}' && `;
  const command = `${prefix}env -i PATH=/usr/bin:/bin sh backend/start.sh`;
  const shell = (script) => process.platform === "win32"
    ? spawnSync("wsl", ["-d", process.env.SECURITY_TEST_WSL_DISTRO || "Ubuntu-26.04", "--", "bash", "-lc", script], { encoding: "utf8" })
    : spawnSync("sh", ["-c", script], { encoding: "utf8" });
  let result = shell(command);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL/);
  result = shell(`${command} migrate`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MIGRATION_DATABASE_URL/);
  result = shell(command.replace("sh backend/start.sh", "bash infra/setup-github.sh"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REPO/);
  result = shell(command.replace("sh backend/start.sh", "bash infra/provision-database.sh"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PGHOST/);
});

test("runtime deploy cannot provision infrastructure or access application secrets", () => {
  const workflow = read(".github/workflows/deploy.yml");
  assert.doesNotMatch(workflow, /azd provision|POSTGRES_PASSWORD|SECRET_KEY|CLIENT_SECRET/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  const setup = read("infra/setup-github.sh");
  assert.doesNotMatch(setup, /--scope "\/subscriptions\/\$SUBSCRIPTION_ID"\s/);
  assert.match(setup, /prevent_self_review/);
  assert.match(setup, /REVIEWER_IDS/);
});

test("base compose requires credentials and does not publish the DB or backend", () => {
  const compose = read("docker-compose.yml");
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:-|SECRET_KEY:-/);
  for (const name of ["db", "backend"]) {
    const service = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\w|^volumes:)`, "m"))?.[1];
    assert.ok(service);
    assert.doesNotMatch(service, /^\s+ports:/m);
  }
  assert.match(compose, /myfeeds_runtime/);
  assert.match(read("init-db.sql"), /REVOKE CREATE ON SCHEMA public FROM PUBLIC/i);
});

test("SPA responses have restrictive CSP and explicit image opt-in", () => {
  const nginx = read("frontend/nginx.conf");
  assert.match(nginx, /Content-Security-Policy/);
  assert.match(nginx, /frame-ancestors 'none'/);
  assert.match(nginx, /Referrer-Policy/);
  assert.match(nginx, /ALLOW_EXTERNAL_IMAGES/);
});

test("development migrations do not require executable checkout file modes", () => {
  assert.match(read("docker-compose.override.yml"), /command:\s*\["sh",\s*"\/app\/start\.sh",\s*"migrate"\]/);
  assert.match(read(".gitattributes"), /\*\.sh text eol=lf/);
});

test("only the isolated production proxy is trusted to supply client addresses", () => {
  const compose = read("docker-compose.yml");
  assert.match(compose, /TRUSTED_PROXY_NETWORKS:\s*'\["\$\{FRONTEND_PROXY_IP:[^}]+\}\/32"\]'/);
  assert.match(compose, /ipv4_address:\s*\$\{FRONTEND_PROXY_IP:/);
  assert.match(compose, /subnet:\s*\$\{MYFEEDS_NETWORK_SUBNET:/);
  assert.match(read("frontend/nginx.conf"), /proxy_set_header X-Real-IP \$remote_addr;/);
  assert.match(read("docker-compose.override.yml"), /TRUSTED_PROXY_NETWORKS:\s*"\[\]"/);
});

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

test("bicep migrate-on-startup is a consent-gated opt-in that always emits the app setting", () => {
  const bicep = read("infra/main.bicep");
  assert.match(bicep, /@description\('[^'\n]+'\)\nparam migrateOnStartup bool = false\n/);
  assert.equal(
    bicep.match(/^\s*MIGRATION_DATABASE_URL: (.+)$/m)?.[1],
    "migrateOnStartup ? 'postgresql+asyncpg://${postgresUser}:${postgresPassword}@${postgres.outputs.fqdn!}:5432/${postgresDb}?ssl=require' : ''",
  );
  assert.match(read("infra/main.parameters.json"), /"migrateOnStartup": \{ "value": "\$\{MIGRATE_ON_STARTUP=false\}" \}/);
});
