# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# =============================================================================
# my-feeds frontend image (multi-stage)
#   base  -> Node + pnpm + dependencies
#   dev   -> Vite dev server (source bind-mounted by docker compose)
#   build -> compiles the production static assets
#   prod  -> nginx serving the built assets and proxying /api to the backend
# =============================================================================

# ---- base -------------------------------------------------------------------
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS base

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
ADD https://registry.npmjs.org/pnpm/-/pnpm-8.15.0.tgz /opt/pnpm.tgz
RUN echo "fd1eab68a6d403f35cf3259c53780d70b0f14bd74e39da2f917d201f554d8665  /opt/pnpm.tgz" \
    | sha256sum -c - && npm install --global /opt/pnpm.tgz && rm /opt/pnpm.tgz

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- dev --------------------------------------------------------------------
FROM base AS dev

ENV VITE_API_URL=/api \
    VITE_ALLOW_EXTERNAL_IMAGES=false \
    HOME=/home/node \
    XDG_CACHE_HOME=/home/node/.cache
RUN chown -R node:node /app /pnpm
USER node
EXPOSE 5173
CMD ["pnpm", "dev"]

# ---- build ------------------------------------------------------------------
FROM base AS build

ARG VITE_API_URL=/api
ARG VITE_ALLOW_EXTERNAL_IMAGES=false
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_ALLOW_EXTERNAL_IMAGES=${VITE_ALLOW_EXTERNAL_IMAGES}

COPY . .
RUN pnpm build

# ---- prod -------------------------------------------------------------------
FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS prod

ENV ALLOW_EXTERNAL_IMAGES=false \
    NGINX_ENVSUBST_FILTER=^ALLOW_EXTERNAL_IMAGES$
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
RUN sed -i '/^user /d; s@/var/run/nginx.pid@/var/cache/nginx/nginx.pid@' /etc/nginx/nginx.conf \
    && mkdir -p /var/cache/nginx \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d
USER nginx

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
