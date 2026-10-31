# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# =============================================================================
# my-feeds backend image (multi-stage)
#   base  -> Python + uv + production dependencies (cached layer)
#   dev   -> adds dev dependencies; source is bind-mounted by docker compose
#   prod  -> copies source, installs the project, serves with hypercorn
# =============================================================================

# ---- base -------------------------------------------------------------------
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    HOME=/home/app \
    AUDIO_CACHE_DIR=/var/cache/my-feeds/audio \
    UV_CACHE_DIR=/var/cache/my-feeds/uv

# uv: fast Python package/dependency manager
COPY --from=ghcr.io/astral-sh/uv:0.11.26@sha256:3d868e555f8f1dbc324afa005066cd11e1053fc4743b9808ca8025283e65efa5 /uv /uvx /usr/local/bin/

# Runtime libraries (libasound2 is required by the Azure Speech SDK)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /var/cache/my-feeds/audio /var/cache/my-feeds/uv \
    && chown -R app:app /var/cache/my-feeds

# Resolve & install production dependencies first for better layer caching.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/var/cache/my-feeds/uv \
    uv sync --frozen --no-dev --no-install-project

# ---- dev --------------------------------------------------------------------
FROM base AS dev

# Add development dependencies (pytest, ruff, watchfiles, ...) from the `dev`
# optional-dependencies extra. Application source is bind-mounted at runtime via
# docker compose, so it is not copied here.
RUN --mount=type=cache,target=/var/cache/my-feeds/uv \
    uv sync --frozen --extra dev --no-install-project

ENV PYTHONPATH=/app
USER 10001:10001
EXPOSE 5000
CMD quart --app app.main:app run --host 0.0.0.0 --port "${PORT:-5000}" --reload

# ---- prod -------------------------------------------------------------------
FROM base AS prod

# Copy the application source and install the project itself into the venv.
COPY . .
RUN --mount=type=cache,target=/var/cache/my-feeds/uv \
    uv sync --frozen --no-dev

ENV PYTHONPATH=/app \
    ENVIRONMENT=production \
    DEBUG=false \
    EXTERNAL_TTS_ENABLED=false \
    ALLOW_EXTERNAL_IMAGES=false
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh
USER 10001:10001
EXPOSE 5000
CMD ["/app/start.sh"]
