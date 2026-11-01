# my-feeds

RSS Feed Reader Progressive Web App with OAuth authentication, category-based feed organization, text-to-speech reading, and PWA offline support.

## Features

- **OAuth Authentication**: Sign in with GitHub, Google, or Microsoft
- **Category Organization**: Group feeds by topic or interest area
- **Unified Post View**: Browse latest posts across all subscribed feeds
- **Read State Tracking**: Auto-track and manually toggle read/unread status
- **Text-to-Speech**: Owner-authenticated audio, enabled only by operator opt-in; generation and playback allow MP3 files up to 20 MiB without reducing audio quality
- **Highlight modes**: Word by word remains the default. Choose Continuous for
  a smooth highlighter stroke through the current word, keeping earlier words
  and spaces highlighted without filling paragraph gaps. Pausing freezes the
  stroke; seeking moves it forward or backward. Completed highlighting remains
  until replay or a mode change. The choice is remembered on this device.
  Continuous mode requires the CSS Custom Highlight API; older browsers keep
  word-by-word highlighting and show an explanation.
- **Silent read-along**: Mute/unmute from the inline or floating player without
  stopping playback, word highlighting, or auto-scroll. The inline volume slider
  adjusts sound from 0-100%; unmuting restores the last nonzero volume. Increasing
  volume unmutes playback. On mobile browsers that restrict volume adjustment,
  use the device volume controls; mute remains available in the player.
  Auto-scroll waits while either playback-speed selector is open and resumes
  when it closes; playback and highlighting continue during speed selection.
- **PWA Support**: Install on mobile; public app assets work offline, private articles/audio do not
- **Privacy Defaults**: Publisher images are blocked until operator permission and per-account consent
  When disabled by the operator, a compact security warning replaces the image
  checkbox; **Learn more** expands the privacy explanation without loading images.

## Tech Stack

### Backend
- **Python 3.12+** with **Quart** async framework
- **SQLAlchemy** with **asyncpg** for PostgreSQL
- **ABC-based dependency injection** (no external DI library)
- **OAuth2** with persisted single-use state, PKCE, and opaque server-side sessions
- **feedparser** for RSS/Atom parsing
- **Azure Cognitive Services** for TTS

### Frontend
- **React** with **TypeScript**
- **Vite** with PWA plugin
- **Material UI** component library
- **React Router** for navigation

### Development
- **Dev Containers** for consistent environment
- **pytest** + **pytest-asyncio** for backend testing
- **Vitest** for frontend unit tests
- **Playwright** for E2E testing

## Quick Start

The application runs entirely on Docker Compose — PostgreSQL, Alembic
migrations, the backend API, and the frontend all start together. A dev
container is available but optional; it only provides local tooling (linters,
language servers, test runners) and is not required to run the app.

### Prerequisites
- Docker Engine (or Docker Desktop) with the Compose plugin
- Git

### Run the stack

1. **Clone**:
   ```bash
   git clone <repository-url>
   cd my-feeds
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   Fill in distinct random `POSTGRES_PASSWORD`, `POSTGRES_RUNTIME_PASSWORD`,
   and `SECRET_KEY` values. Generate each independently with
   `python -c "import secrets; print(secrets.token_hex(32))"`. Keep existing
   administrator names when reusing a database volume. Set `PUBLIC_BASE_URL`
   explicitly and add OAuth client IDs/secrets to the root `.env`.
   Compose refuses missing credentials; application secrets are not embedded
   in images. `backend/.env.example` is for running the backend outside Compose.

3. **Start everything** (development — hot reload):
   ```bash
   docker compose up --build
   ```
   - Frontend (Vite): http://localhost:5174 (`FRONTEND_DEV_PORT` may override)
   - Backend API (Quart): http://localhost:5000
   - PostgreSQL: container network only, not published to the host

   Migrations run automatically via the one-shot `migrate` service before the
   backend starts. Stop with `Ctrl+C`, or `docker compose down` (add `-v` to
   also drop the database volume).

### Production-style run

`docker compose up` auto-applies `docker-compose.override.yml` (dev servers).
To run the production images instead — multi-stage builds, the frontend served
by nginx with an `/api` reverse proxy, and the backend served by hypercorn —
use only the base file:

```bash
docker compose -f docker-compose.yml up --build
```
Nginx listens on loopback port 8080. Production requires a trusted HTTPS
terminator forwarding the configured `PUBLIC_BASE_URL` to that port.
Do not expose raw HTTP, the backend, or PostgreSQL publicly. Configure
production OAuth callbacks on the real HTTPS origin. The development override
explicitly permits local HTTP; it is not a production fallback.

Authenticated request budgets are per account, not shared by every user behind
nginx. Anonymous client addresses are accepted only from the configured trusted
nginx `/32`, which overwrites `X-Real-IP`; other forwarding headers are ignored.
A separate coarse allowance of 1,200 requests per client address per minute runs
before session lookups, bounding authentication work even for nonexistent tokens.
Account limits remain 120 reads and 60 mutations per minute. Shared NAT/ingress
addresses share the coarse allowance; size ingress controls for the actual traffic.
If the Docker subnet conflicts with a local/VPN network, change
`MYFEEDS_NETWORK_SUBNET` and `FRONTEND_PROXY_IP` together. For an additional TLS
proxy, establish a trusted, sanitized real-client-address boundary deliberately;
do not allow arbitrary public clients to supply forwarding headers.

### Dev container (optional)

Open the folder in VS Code and choose "Reopen in Container" for a preconfigured
toolchain (Python 3.12, Node 20, uv, pnpm, Playwright) with Docker available
inside. Run `docker compose up` from the integrated terminal exactly as above.

## Project Structure

```
my-feeds/
├── backend/
│   ├── app/
│   │   ├── domain/           # DDD domain layer
│   │   ├── application/      # Application services
│   │   ├── infrastructure/   # External integrations
│   │   ├── api/              # HTTP routes
│   │   └── config/           # DI container, settings
│   ├── tests/
│   └── migrations/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── services/
│   └── playwright/
├── specs/                    # Feature specifications
└── .devcontainer/
```

## Testing

Run the full suite inside the compose services (the stack is started if needed):

```bash
./scripts/test.sh                      # backend (pytest) + frontend (vitest)
./scripts/test.sh tests/unit -k feed   # extra args are forwarded to pytest
```

Or target a single service directly:

```bash
docker compose exec backend pytest --cov=app
docker compose exec frontend pnpm test
docker compose exec frontend pnpm playwright test
```

Inside the dev container you can also run the underlying tools against your
local install (`cd backend && uv run pytest`, `cd frontend && pnpm test`).

## Development Principles

This project follows the [Constitution](/.specify/memory/constitution.md):

1. **Domain-Driven Design** - Clean bounded contexts
2. **Dependency Injection** - ABC-based loose coupling
3. **Test-Driven Development** - Red-Green-Refactor cycle
4. **Modern Toolchain** - uv, pnpm, Dev Containers
5. **PWA-First** - Single codebase for all platforms
6. **Bounded Resource Generation** - TTS requires operator opt-in; API and periodic work share limits

## License

MIT

## Deploy to Azure (azd)

Infra lives in `infra/` (Bicep + Azure Verified Modules), all in Canada Central:
App Service, private PostgreSQL/Blob endpoints, VNet/private DNS, and ACR.
Speech is provisioned only when `EXTERNAL_TTS_ENABLED=true`; otherwise neither
API calls nor background jobs send articles to a TTS provider.

Network: Storage and Speech have no public access. The web app and Postgres are only reachable from the IPs in `ALLOWED_IPS` (comma-separated, empty = none). ACR stays public but Entra-only so ACR Tasks can build the image remotely.

Speech uses the `account` private endpoint in the existing `private-endpoints`
subnet and the VNet-linked `privatelink.cognitiveservices.azure.com` DNS zone.
App Service stays integrated with its separate delegated `app` subnet; private
traffic uses the VNet without routing public feed/OAuth traffic through it.
Keep `AZURE_SPEECH_ENDPOINT` set to the original custom HTTPS hostname, not a
private IP, regional endpoint, or `privatelink` hostname. Speech SDK 1.52.0 or
newer uses `DefaultAzureCredential` with that endpoint and the app's
`AZURE_CLIENT_ID`; the identity needs **Cognitive Services Speech User** on the
Speech account. Local/key authentication stays disabled.

For an existing production installation, create the Speech private endpoint,
DNS zone/link, and endpoint DNS group first. Verify private DNS and TLS from
App Service before disabling Speech public access, then verify fresh synthesis
and word timings. Do not reprovision unrelated database/OAuth resources merely
to repair Speech networking. Persist approved external processing with
`azd env set EXTERNAL_TTS_ENABLED true --environment my-feeds-prod`, and ensure
the existing App Service setting is also enabled: runtime-only deployment
preserves settings but does not add new operator opt-ins.

Provision infrastructure with a privileged human/operator identity, not the
GitHub deployment identity. Select the application resource group in the azd
environment and supply distinct database passwords, a random session secret,
OAuth credentials, and allowed IPs before provisioning.

From a host with private database access, run `infra/provision-database.sh`
with administrator `MIGRATION_DATABASE_URL` (including `ssl=require`), the
database connection variables, and the runtime password. Apply migrations
through `f7a1b2c3d4e5` and reapply runtime grants. Only `myfeeds_runtime`
credentials belong in app settings; runtime startup never migrates.
Opaque sessions replace legacy cookies, so existing users must sign in again.
The shared-audio-key migration preserves per-post ownership links; downgrading
its index requires first resolving any duplicate content keys.

Protect `main`, select actual numeric reviewer IDs, and run operator-only
`infra/setup-github.sh` to configure the reviewed production environment and a
new resource-group-scoped runtime-deployment identity. The manual
`.github/workflows/deploy.yml` deploys only from `main`, uses checksum-pinned azd
1.37.2 with GitHub OIDC, and consumes the `web` Docker/App Service definition in
`azure.yaml`. Azure CLI performs the remote ACR build with the configured
image-consent build argument; `azd deploy web --from-package` deploys the resolved
immutable digest to the existing production app. The workflow does not provision or
receive database/OAuth/session secrets.

Set `AZURE_ENV_NAME`, `AZURE_LOCATION`, `AZURE_RESOURCE_GROUP`,
`AZURE_CONTAINER_REGISTRY_NAME`, `WEB_APP_NAME`, and the existing Azure OIDC
identity/subscription/tenant variables in the production GitHub environment.
For local commands, the Git-ignored `.azure/config.json` selects `my-feeds-prod`
and `.azure/my-feeds-prod/.env` contains its azd state. Keep that directory private;
do not commit or upload it to CI, because provisioning state can contain secrets.
The runner creates only local azd environment metadata, with explicit existing
resource names and production slot selection; it does not refresh infrastructure
outputs, run `azd up`, migrate the database, or change IAM. Azure CLI handles the
remote build and registry/digest resolution because azd 1.37.2 skips standalone
`azd publish` for App Service. Application settings and registry
pull identity remain operator-provisioned.

**Existing installations need operator cleanup:** inspect/revoke old broad
subscription IAM assignments and federated credentials, remove unused GitHub
application secrets, rotate potentially exposed credentials, and verify that
the new identity has no inherited broad permissions. Repository changes cannot
alter live IAM, retention, firewall rules, or environment approvals.

Publisher images require `ALLOW_EXTERNAL_IMAGES=true` on backend/nginx and a
frontend rebuild with `VITE_ALLOW_EXTERNAL_IMAGES=true`; each account still
starts without consent. External TTS has a separate
`EXTERNAL_TTS_ENABLED=true` decision. Enabling it permits the periodic job as
well as interactive generation: assess provider privacy/retention and budgets.

See [the threat model and remediation status](my-feeds-threat-model.md) for
controls, verification evidence, and residual operator obligations.
