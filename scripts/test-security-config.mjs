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
