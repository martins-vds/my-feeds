# syntax=docker/dockerfile:1

# =============================================================================
# my-feeds backend image (multi-stage)
#   base  -> Python + uv + production dependencies (cached layer)
#   dev   -> adds dev dependencies; source is bind-mounted by docker compose
#   prod  -> copies source, installs the project, serves with hypercorn
# =============================================================================

# ---- base -------------------------------------------------------------------
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# uv: fast Python package/dependency manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Runtime libraries (libasound2 is required by the Azure Speech SDK)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Resolve & install production dependencies first for better layer caching.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ---- dev --------------------------------------------------------------------
FROM base AS dev

# Add development dependencies (pytest, ruff, watchfiles, ...) from the `dev`
# optional-dependencies extra. Application source is bind-mounted at runtime via
# docker compose, so it is not copied here.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --extra dev --no-install-project

ENV PYTHONPATH=/app
EXPOSE 5000
CMD quart --app app.main:app run --host 0.0.0.0 --port "${PORT:-5000}" --reload

# ---- prod -------------------------------------------------------------------
FROM base AS prod

# Copy the application source and install the project itself into the venv.
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

ENV PYTHONPATH=/app
EXPOSE 5000
CMD exec hypercorn app.main:app --bind "0.0.0.0:${PORT:-5000}" --workers 4
