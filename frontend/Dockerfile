# syntax=docker/dockerfile:1

# =============================================================================
# my-feeds frontend image (multi-stage)
#   base  -> Node + pnpm + dependencies
#   dev   -> Vite dev server (source bind-mounted by docker compose)
#   build -> compiles the production static assets
#   prod  -> nginx serving the built assets and proxying /api to the backend
# =============================================================================

# ---- base -------------------------------------------------------------------
FROM node:20-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- dev --------------------------------------------------------------------
FROM base AS dev

ENV VITE_API_URL=/api
EXPOSE 5173
CMD ["pnpm", "dev"]

# ---- build ------------------------------------------------------------------
FROM base AS build

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN pnpm build

# ---- prod -------------------------------------------------------------------
FROM nginx:1.27-alpine AS prod

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
