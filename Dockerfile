# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS frontend-build

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
ADD --checksum=sha256:fd1eab68a6d403f35cf3259c53780d70b0f14bd74e39da2f917d201f554d8665 https://registry.npmjs.org/pnpm/-/pnpm-8.15.0.tgz /opt/pnpm.tgz
RUN npm install --global /opt/pnpm.tgz && rm /opt/pnpm.tgz

WORKDIR /build
ARG VITE_ALLOW_EXTERNAL_IMAGES=false
ENV VITE_ALLOW_EXTERNAL_IMAGES=${VITE_ALLOW_EXTERNAL_IMAGES}
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app/backend \
    PORT=8000 \
    ENVIRONMENT=production \
    DEBUG=false \
    EXTERNAL_TTS_ENABLED=false \
    ALLOW_EXTERNAL_IMAGES=false \
    HOME=/home/app \
    AUDIO_CACHE_DIR=/var/cache/my-feeds/audio \
    UV_CACHE_DIR=/var/cache/my-feeds/uv

COPY --from=ghcr.io/astral-sh/uv:0.11.26@sha256:3d868e555f8f1dbc324afa005066cd11e1053fc4743b9808ca8025283e65efa5 /uv /uvx /usr/local/bin/

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./
RUN uv sync --frozen --no-dev

COPY --from=frontend-build /build/dist /app/frontend/dist
COPY backend/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh \
    && chmod +x /app/start.sh \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && mkdir -p /var/cache/my-feeds/audio /var/cache/my-feeds/uv \
    && chown -R app:app /var/cache/my-feeds

USER 10001:10001

EXPOSE 8000
CMD ["/app/start.sh"]
